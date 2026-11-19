import { drawText, measureText } from './pixelfont.js';
import { COLORS } from './utils.js';

// Líneas cortas de comunicación (lore del prólogo). NO modales: el juego sigue corriendo y la caja solo se muestra con calma (sin enemigos persiguiendo o alerta,
// sin panel, forcejeo, vómito ni ejecución); si surge pelea se oculta y su cuenta atrás se detiene. Cada `id` sale una vez por partida (R no las repite).
// Saltar: Espacio, clic o tocar la caja en móvil (Game.updatePrologue consume la pulsación para que no dispare ni patee; en táctil la caja captura el toque).
const FADE = 0.18, GAP = 0.45;
const SPEAKERS = { central: { name: 'CENTRAL', color: '#ffbe0b' } };

export class Comms {
  constructor(game) {
    this.game = game;
    this.seen = new Set();
    this.queue = [];
    this.cur = null;        // { who, color, text, t, life }
    this.shown = false;     // ¿se está mostrando ahora (calma)? Solo entonces se puede saltar
    this.rect = null;       // caja dibujada (coordenadas internas), para el toque
    this.gap = 0;
  }

  forget() { this.seen.clear(); this.clear(); }   // partida o piso nuevo
  clear() { this.queue.length = 0; this.cur = null; this.shown = false; this.rect = null; this.gap = 0; }   // reintento con R: se queda `seen`

  // Encola una secuencia de líneas con un id (una sola vez por partida). `entries`: [{ speaker: 'central' | { name, color }, text }].
  say(id, entries) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    for (const e of entries) {
      const sp = typeof e.speaker === 'string' ? SPEAKERS[e.speaker] : e.speaker;
      this.queue.push({ who: sp.name, color: sp.color, text: e.text, t: 0, life: Math.min(6, 2.4 + e.text.length * 0.05) });
    }
    return true;
  }

  calm() {
    const g = this.game, p = g.player;
    if (g.state !== 'playing' && g.state !== 'cleared') return false;
    if (g.panel || g.fade || !p.alive || p.vomit || p.exec || g.hitstop > 0) return false;
    return !g.enemies.some((e) => e.alive && (e.state === 'chase' || e.state === 'alert'));
  }

  update(dt) {
    const calm = this.calm();
    if (!this.cur) {
      this.shown = false;
      this.gap = Math.max(0, this.gap - dt);
      if (this.queue.length && calm && this.gap <= 0) this.cur = this.queue.shift();
      return;
    }
    this.shown = calm;
    if (!calm) return;
    this.cur.t += dt;
    if (this.cur.t >= this.cur.life) { this.cur = null; this.shown = false; this.gap = GAP; }
  }

  // Salta la línea visible. Devuelve true si había una (el que llama consume la pulsación).
  skip() {
    if (!this.cur || !this.shown) return false;
    this.cur = null; this.shown = false; this.gap = 0.3;
    return true;
  }

  hit(p) {
    const r = this.rect;
    return !!(this.cur && this.shown && r && p.x >= r.x - 4 && p.x <= r.x + r.w + 4 && p.y >= r.y - 4 && p.y <= r.y + r.h + 4);
  }

  // Parte el texto en filas que quepan en `maxW` píxeles.
  wrap(text, maxW) {
    const rows = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && measureText(next) > maxW) { rows.push(line); line = word; } else line = next;
    }
    if (line) rows.push(line);
    return rows;
  }

  draw(ctx, w) {
    this.rect = null;
    const c = this.cur, g = this.game;
    if (!c || !this.shown) return;
    const s = g.safe;
    const left = 8 + s.l, right = g.input.touchMode ? Math.max(left + 120, g.touch.rightColumn().x - 8) : w - 8 - s.r;
    const maxW = Math.max(110, Math.min(230, right - left));
    const rows = this.wrap(c.text, maxW - 10);
    const bw = Math.min(maxW, Math.max(...rows.map((r) => measureText(r)), measureText(c.who) + 60) + 10), bh = 13 + rows.length * 9 + 3;
    const bx = Math.round((left + right) / 2 - bw / 2), by = 70 + s.t;
    const a = Math.min(1, c.t / FADE, (c.life - c.t) / FADE);
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = 'rgba(13, 2, 33, 0.9)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = c.color;
    ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
    drawText(ctx, c.who, bx + 5, by + 3, { color: c.color, shadow: null });
    drawText(ctx, g.hint('ESPACIO', 'TOCA'), bx + bw - 5, by + 3, { color: '#7d6f98', align: 'right', shadow: null });
    rows.forEach((r, i) => drawText(ctx, r, bx + 5, by + 13 + i * 9, { color: COLORS.text, shadow: null }));
    ctx.restore();
    this.rect = { x: bx, y: by, w: bw, h: bh };
  }
}
