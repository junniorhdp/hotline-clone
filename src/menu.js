import { LEVELS, loadLevel, isWallTile } from './map.js';
import { drawText, measureText, CELL_H } from './pixelfont.js';
import { pixelLine } from './sprites.js';
import { COLORS, clamp } from './utils.js';

// Menú principal estilo arcade. Vive en `game.state === 'menu'` con tres subpantallas:
//   'title'   logo + JUGAR / SELECCIONAR PISO / RÉCORDS
//   'floors'  tarjetas de pisos con miniatura, récord y rango (bloqueados hasta completar el anterior)
//   'records' Top 5 histórico
// Los cambios de pantalla pasan por `game.transition()` (fundido).
const TITLE_OPTIONS = [
  { label: 'JUGAR', action: (g) => g.transition(() => g.startRunAt(0)) },
  { label: 'SELECCIONAR PISO', action: (g) => g.transition(() => g.menu.open('floors'), 0.15) },
  { label: 'RÉCORDS', action: (g) => g.transition(() => g.menu.open('records'), 0.15) },
];
const RANK_COLORS = { S: COLORS.player, A: COLORS.weapon, B: COLORS.enemy, C: COLORS.blood };
const DIM = '#7d6f98';

// Miniatura de un piso: 1 píxel por casilla (paredes neón, puertas, salida y enemigos).
const thumbs = new Map();
function floorThumb(index) {
  if (thumbs.has(index)) return thumbs.get(index);
  const L = loadLevel(index);
  const { map } = L;
  const c = document.createElement('canvas');
  c.width = map.w;
  c.height = map.h;
  const ctx = c.getContext('2d');
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      ctx.fillStyle = isWallTile(map, tx, ty) ? COLORS.wall : '#1c0c33';
      ctx.fillRect(tx, ty, 1, 1);
    }
  }
  const dot = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(Math.floor(x / 32), Math.floor(y / 32), 1, 1); };
  for (const d of L.doors) { ctx.fillStyle = COLORS.door; ctx.fillRect(d.tx, d.ty, 1, 1); }
  for (const e of L.enemies) dot(e.x, e.y, COLORS.enemy);
  dot(L.player.x, L.player.y, COLORS.player);
  dot(L.exit.x, L.exit.y, COLORS.debug);
  const info = { canvas: c, enemies: L.enemies.length, armed: L.enemies.filter((e) => e.armed).length };
  thumbs.set(index, info);
  return info;
}

export class Menu {
  constructor(game) {
    this.game = game;
    this.screen = 'title';
    this.index = 0;
    this.floorIndex = 0;
    this.mouse = { x: 0, y: 0 };
  }

  open(screen = 'title') {
    this.screen = screen;
    if (screen === 'title') this.index = 0;
    if (screen === 'floors') this.floorIndex = 0;
    // Solo un movimiento real del ratón cambia la selección.
    this.mouse = this.game.mouseInternal();
  }

  // --- Entrada ---------------------------------------------------------------------------

  update() {
    const g = this.game, input = g.input;
    const confirm = input.wasPressed('Enter') || input.wasPressed('Space') || input.wasPressed('NumpadEnter');
    const back = input.wasPressed('Escape') || input.wasPressed('Backspace');
    const m = g.mouseInternal();
    const moved = Math.hypot(m.x - this.mouse.x, m.y - this.mouse.y) > 0.5;
    this.mouse = m;
    const inside = (r) => r && m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h;

    if (this.screen === 'title') {
      const n = TITLE_OPTIONS.length, prev = this.index;
      if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.index = (this.index + n - 1) % n;
      if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.index = (this.index + 1) % n;
      const rects = this.titleLayout().options;
      const hovered = rects.findIndex(inside);
      if (hovered >= 0 && moved) this.index = hovered;
      if (this.index !== prev) g.sfx.play('empty');
      if (confirm || (input.mousePressed.left && hovered >= 0)) {
        if (input.mousePressed.left && hovered >= 0) this.index = hovered;
        g.sfx.play('pickup');
        TITLE_OPTIONS[this.index].action(g);
      }
      return;
    }

    if (back) {
      g.sfx.play('empty');
      g.transition(() => this.open('title'), 0.15);
      return;
    }

    if (this.screen === 'floors') {
      const n = LEVELS.length, prev = this.floorIndex;
      if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) this.floorIndex = (this.floorIndex + n - 1) % n;
      if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) this.floorIndex = (this.floorIndex + 1) % n;
      const cards = this.floorsLayout().cards;
      const hovered = cards.findIndex(inside);
      if (hovered >= 0 && moved) this.floorIndex = hovered;
      if (this.floorIndex !== prev) g.sfx.play('empty');
      if (confirm || (input.mousePressed.left && hovered >= 0)) {
        if (input.mousePressed.left && hovered >= 0) this.floorIndex = hovered;
        if (g.floorStats.isUnlocked(this.floorIndex + 1)) {
          g.sfx.play('pickup');
          const index = this.floorIndex;
          g.transition(() => g.startRunAt(index));
        } else {
          g.sfx.play('empty');
          g.camera.addShake(2);
        }
      }
      return;
    }

    if (this.screen === 'records' && confirm) g.transition(() => this.open('title'), 0.15);
  }

  // --- Layouts compartidos por dibujo y ratón -------------------------------------------

  titleLayout() {
    const { width: w, height: h } = this.game.scene;
    const horizon = Math.round(h * 0.55);
    const options = TITLE_OPTIONS.map((o, i) => {
      const tw = measureText(o.label) * 2;
      return { x: Math.round(w / 2 - tw / 2) - 14, y: horizon + 8 + i * 20, w: tw + 28, h: 18 };
    });
    return { horizon, options };
  }

  floorsLayout() {
    const { width: w } = this.game.scene;
    const n = LEVELS.length, gap = 8;
    const cardW = clamp(Math.floor((w - 16 - gap * (n - 1)) / n), 70, 150);
    const maxMapW = Math.max(...LEVELS.map((l) => l.rows[0].length));
    const maxMapH = Math.max(...LEVELS.map((l) => l.rows.length));
    const thumbScale = clamp(Math.floor((cardW - 10) / maxMapW), 1, 3);
    const cardH = 8 + maxMapH * thumbScale + 6 + 5 * 11; // 5 líneas: piso, sala, enemigos, rango, puntos
    const x0 = Math.round((w - (n * cardW + (n - 1) * gap)) / 2);
    const cards = LEVELS.map((_, i) => ({ x: x0 + i * (cardW + gap), y: 30, w: cardW, h: cardH }));
    return { cards, thumbScale, bottom: 30 + cardH };
  }

  // --- Dibujo ------------------------------------------------------------------------------

  draw(ctx, w, h) {
    const now = performance.now() / 1000;
    this.drawSynthwave(ctx, w, h, now);
    if (this.screen === 'title') this.drawTitle(ctx, w, h, now);
    else if (this.screen === 'floors') this.drawFloors(ctx, w, h);
    else this.drawRecords(ctx, w, h);
  }

  // Fondo: cielo en bandas, sol rayado poniéndose y rejilla en perspectiva que avanza.
  drawSynthwave(ctx, w, h, now) {
    const horizon = Math.round(h * 0.55), cx = Math.round(w / 2);
    const sky = ['#0d0221', '#13042b', '#1a0636', '#240942', '#330c4f', '#4a0f5c'];
    const band = Math.ceil(horizon / sky.length);
    sky.forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(0, i * band, w, band); });

    // Sol: filas con degradado amarillo → rosa y franjas cada vez más anchas hacia abajo.
    const R = Math.round(Math.min(h * 0.18, w * 0.12)); // deja sitio al lema bajo el logo
    const sunY = horizon - 2;
    for (let dy = -R; dy <= 0; dy++) {
      const t = (dy + R) / R; // 0 arriba, 1 en el horizonte
      if (t > 0.45) {
        const stripe = Math.floor((t - 0.45) * 12);
        if ((dy + Math.floor(now * 6)) % (6 - Math.min(stripe, 4)) === 0) continue;
      }
      const half = Math.floor(Math.sqrt(R * R - dy * dy));
      ctx.fillStyle = t < 0.33 ? '#ffd166' : t < 0.55 ? '#ffbe0b' : t < 0.75 ? '#ff8a3d' : COLORS.wall;
      ctx.fillRect(cx - half, sunY + dy, half * 2 + 1, 1);
    }

    // Suelo con rejilla en perspectiva.
    ctx.fillStyle = '#0d0221';
    ctx.fillRect(0, horizon, w, h - horizon);
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(0, horizon, w, 1);
    const depth = h - horizon;
    const scroll = (now * 0.6) % 1;
    for (let k = 0; k < 9; k++) {
      const z = (k + scroll) / 9;          // 0 en el horizonte, 1 abajo
      const y = horizon + Math.round(z * z * depth);
      ctx.globalAlpha = 0.25 + z * 0.6;
      ctx.fillRect(0, y, w, 1);
    }
    ctx.globalAlpha = 0.5;
    for (let i = -10; i <= 10; i++) pixelLine(ctx, cx + i * 6, horizon, cx + i * w * 0.11, h);
    ctx.globalAlpha = 1;
  }

  drawTitle(ctx, w, h, now) {
    const { horizon, options } = this.titleLayout();
    const cx = Math.round(w / 2);
    // Logo con aberración cromática y parpadeo de neón: de vez en cuando "NEON" se apaga.
    const logo = 'NEON RUSH';
    const scale = this.game.fitScale(logo, w - 16, 5);
    const ly = Math.max(6, Math.round(horizon * 0.18));
    const flickerOff = Math.sin(now * 13) > 0.97 || (Math.floor(now * 10) % 37 === 0);
    drawText(ctx, logo, cx - 1, ly, { color: COLORS.player, scale, align: 'center', shadow: null });
    drawText(ctx, logo, cx + 1, ly + 1, { color: COLORS.wall, scale, align: 'center', shadow: null });
    ctx.save();
    ctx.shadowColor = COLORS.wall;
    ctx.shadowBlur = 14;
    drawText(ctx, logo, cx, ly, { color: '#ffe6f2', scale, align: 'center', shadow: null });
    ctx.restore();
    if (flickerOff) {
      // Apaga momentáneamente la palabra NEON (tubo que falla).
      const neonW = measureText('NEON') * scale;
      const lx = Math.round(cx - (measureText(logo) * scale) / 2);
      ctx.fillStyle = 'rgba(13, 2, 33, 0.75)';
      ctx.fillRect(lx - 2, ly, neonW + 3, CELL_H * scale + 2);
    }
    const tag = 'ACCIÓN CENITAL · UN SOLO GOLPE · NEÓN';
    drawText(ctx, tag, cx, ly + CELL_H * scale + 4, { color: COLORS.enemy, align: 'center' });

    // Opciones sobre la rejilla, con panel oscuro para que se lean.
    const panel = { x: Math.min(...options.map((o) => o.x)) - 8, y: options[0].y - 4 };
    panel.w = Math.max(...options.map((o) => o.x + o.w)) + 8 - panel.x;
    panel.h = options[options.length - 1].y + 22 - panel.y;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.78)';
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.fillStyle = '#3a2a55';
    ctx.fillRect(panel.x, panel.y, panel.w, 1);
    ctx.fillRect(panel.x, panel.y + panel.h - 1, panel.w, 1);
    const blink = Math.floor(now * 3) % 2 === 0;
    TITLE_OPTIONS.forEach((o, i) => {
      const r = options[i];
      const sel = i === this.index;
      if (sel) {
        ctx.save();
        ctx.shadowColor = COLORS.wall;
        ctx.shadowBlur = 8;
        drawText(ctx, o.label, cx, r.y, { color: COLORS.text, scale: 2, align: 'center', shadow: COLORS.wall });
        ctx.restore();
        if (blink) {
          drawText(ctx, '>', r.x, r.y, { color: COLORS.wall, scale: 2 });
          drawText(ctx, '<', r.x + r.w - 10, r.y, { color: COLORS.wall, scale: 2 });
        }
      } else {
        drawText(ctx, o.label, cx, r.y, { color: DIM, scale: 2, align: 'center' });
      }
    });

    drawText(ctx, 'FLECHAS / RATÓN: ELEGIR · ENTER: ACEPTAR', 6, h - 12, { color: DIM });
    const best = this.game.history.best();
    if (best) drawText(ctx, `RÉCORD ${best.toLocaleString('es')}`, w - 6, h - 12, { color: COLORS.enemy, align: 'right' });
  }

  drawFloors(ctx, w, h) {
    const g = this.game;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.7)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2);
    const title = 'SELECCIONAR PISO';
    drawText(ctx, title, cx, 6, { color: COLORS.wall, scale: g.fitScale(title, w - 12), align: 'center' });

    const { cards, thumbScale, bottom } = this.floorsLayout();
    const bob = Math.floor(performance.now() / 300) % 2;
    LEVELS.forEach((level, i) => {
      const c = cards[i];
      const n = i + 1;
      const sel = i === this.floorIndex;
      const unlocked = g.floorStats.isUnlocked(n);
      const stats = g.floorStats.get(n);
      const y = c.y - (sel ? bob : 0);
      ctx.save();
      if (sel) { ctx.shadowColor = COLORS.wall; ctx.shadowBlur = 10; }
      ctx.fillStyle = sel ? COLORS.wall : '#3a2a55';
      ctx.fillRect(c.x, y, c.w, c.h);
      ctx.restore();
      ctx.fillStyle = sel ? '#2a0d3a' : '#1a0d2e';
      ctx.fillRect(c.x + 1, y + 1, c.w - 2, c.h - 2);

      const info = floorThumb(i);
      const tw = info.canvas.width * thumbScale, th = info.canvas.height * thumbScale;
      const tx = Math.round(c.x + (c.w - tw) / 2);
      ctx.globalAlpha = unlocked ? 1 : 0.25;
      ctx.drawImage(info.canvas, tx, y + 6, tw, th);
      ctx.globalAlpha = 1;
      const [floorLabel, roomLabel] = level.name.split(' · ');
      let ty = y + 8 + th + 4;
      const mid = c.x + c.w / 2;
      drawText(ctx, floorLabel, mid, ty, { color: sel ? COLORS.text : DIM, align: 'center' });
      drawText(ctx, roomLabel, mid, ty + 11, { color: sel ? COLORS.player : DIM, align: 'center' });
      ty += 22;
      if (!unlocked) {
        drawText(ctx, 'BLOQUEADO', mid, ty + 5, { color: COLORS.blood, align: 'center' });
        return;
      }
      drawText(ctx, `${info.enemies} ENEM. · ${info.armed} ARM.`, mid, ty, { color: DIM, align: 'center' });
      if (stats.bestRank) {
        drawText(ctx, `RANGO ${stats.bestRank}`, mid, ty + 11, { color: RANK_COLORS[stats.bestRank], align: 'center' });
        drawText(ctx, `${stats.bestScore.toLocaleString('es')} PTS`, mid, ty + 22, { color: COLORS.text, align: 'center' });
      } else {
        drawText(ctx, 'SIN COMPLETAR', mid, ty + 11, { color: DIM, align: 'center' });
      }
    });

    const n = this.floorIndex + 1;
    const msg = g.floorStats.isUnlocked(n)
      ? `ENTER: EMPEZAR EN EL ${LEVELS[this.floorIndex].name.split(' · ')[0]}`
      : `COMPLETA EL PISO ${n - 1} PARA DESBLOQUEARLO`;
    drawText(ctx, msg, cx, Math.min(bottom + 8, h - 26), { color: g.floorStats.isUnlocked(n) ? COLORS.player : COLORS.blood, align: 'center' });
    drawText(ctx, 'FLECHAS / RATÓN: ELEGIR · ESC: VOLVER', cx, h - 12, { color: DIM, align: 'center' });
  }

  drawRecords(ctx, w, h) {
    const g = this.game;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.8)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2);
    const top = Math.max(8, Math.round(h / 2 - 66));
    drawText(ctx, 'MEJORES PARTIDAS', cx, top, { color: COLORS.wall, scale: 2, align: 'center' });
    if (!g.history.entries.length) drawText(ctx, 'TODAVÍA NO HAY PARTIDAS GUARDADAS', cx, top + 24, { color: DIM, align: 'center' });
    g.drawRecordsTable(ctx, w, top + 38, null);
    drawText(ctx, 'ESC / ENTER: VOLVER', cx, h - 12, { color: COLORS.player, align: 'center' });
  }
}
