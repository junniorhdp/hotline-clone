import { drawText, measureText } from './pixelfont.js';
import { COLORS } from './utils.js';
import { bloodyMaskPortrait } from './portraits.js';

// Líneas cortas de comunicación (lore del prólogo). NO modales: el juego sigue corriendo y la caja solo se muestra con calma (sin enemigos persiguiendo o alerta,
// sin panel, forcejeo, vómito ni ejecución); si surge pelea se oculta y su cuenta atrás se detiene. Cada `id` sale una vez por partida (R no las repite).
// Saltar: Espacio, clic o tocar la caja en móvil (Game.updatePrologue consume la pulsación para que no dispare ni patee; en táctil la caja captura el toque).
const FADE = 0.18, GAP = 0.45, TYPE_CPS = 30;   // letras por segundo (igual que la caja de radio del piso 10)
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
      this.queue.push({ who: sp.name, color: sp.color, text: e.text, t: 0, life: Math.min(7, 2.6 + e.text.length / TYPE_CPS), portrait: sp.portrait || null });
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

  // Mismo estilo que la caja de radio del piso 10 (Game.drawRadioBox): marco del color del que habla, retrato enmarcado de 32×32 (su máscara; CENTRAL, un walkie),
  // nombre · RADIO, texto tecleado a 30 car./s y el walkie con la antena parpadeando. Pero NO modal: va bajo el HUD y no congela nada.
  draw(ctx, w) {
    this.rect = null;
    const c = this.cur, g = this.game;
    if (!c || !this.shown) return;
    const s = g.safe;
    const left = 8 + s.l, right = g.input.touchMode ? Math.max(left + 150, g.touch.rightColumn().x - 8) : w - 8 - s.r;
    const bw = Math.max(150, Math.min(330, right - left)), textW = bw - 44 - 20;
    const rows = this.wrap(c.text, textW);
    const bh = 46 + Math.max(0, rows.length - 2) * 10;
    const bx = Math.round((left + right) / 2 - bw / 2), by = 70 + s.t;
    const a = Math.max(0, Math.min(1, c.t / FADE, (c.life - c.t) / FADE));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(5, 0, 15, 0.92)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = c.color;
    ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
    // retrato (o walkie grande para CENTRAL) con su marco
    if (c.portrait) ctx.drawImage(bloodyMaskPortrait(c.portrait.mask, 0, c.portrait.gender, []), bx + 5, by + 6, 32, 32);
    else {
      ctx.fillStyle = '#1a1030'; ctx.fillRect(bx + 5, by + 6, 32, 32);
      ctx.fillStyle = '#14141e'; ctx.fillRect(bx + 14, by + 16, 14, 20);
      ctx.fillStyle = '#6b6b85'; ctx.fillRect(bx + 15, by + 17, 12, 18);
      ctx.fillStyle = '#14141e'; ctx.fillRect(bx + 24, by + 8, 2, 9);
      ctx.fillStyle = c.color; ctx.fillRect(bx + 17, by + 20, 8, 2); ctx.fillRect(bx + 17, by + 25, 8, 2); ctx.fillRect(bx + 17, by + 30, 8, 2);
      ctx.fillStyle = Math.floor(c.t * 6) % 2 ? '#ff2a4a' : '#7d3a4a'; ctx.fillRect(bx + 23, by + 6, 4, 3);
    }
    ctx.fillStyle = c.color; ctx.fillRect(bx + 4, by + 5, 34, 1); ctx.fillRect(bx + 4, by + 38, 34, 1); ctx.fillRect(bx + 4, by + 5, 1, 34); ctx.fillRect(bx + 37, by + 5, 1, 34);
    drawText(ctx, `${c.who} · RADIO`, bx + 44, by + 5, { color: c.color });
    let typed = Math.floor(c.t * TYPE_CPS);                       // texto tecleado
    rows.forEach((r, i) => {
      const part = r.slice(0, Math.max(0, typed));
      typed -= r.length + 1;
      if (part) drawText(ctx, part, bx + 44, by + 17 + i * 10, { color: COLORS.text, shadow: null });
    });
    const wx = bx + bw - 14, wy = by + 6;                          // walkie: cuerpo, antena y piloto que parpadea
    ctx.fillStyle = '#14141e'; ctx.fillRect(wx, wy + 5, 8, 14);
    ctx.fillStyle = '#6b6b85'; ctx.fillRect(wx + 1, wy + 6, 6, 12);
    ctx.fillStyle = '#14141e'; ctx.fillRect(wx + 5, wy, 1, 6);
    ctx.fillStyle = Math.floor(c.t * 6) % 2 ? '#ff2a4a' : '#7d3a4a'; ctx.fillRect(wx + 4, wy - 1, 3, 2);
    if (c.t > 0.8) drawText(ctx, g.hint('ESPACIO: SALTAR', 'TOCA: SALTAR'), bx + bw - 6, by + bh - 11, { color: '#7d6f98', align: 'right' });
    ctx.restore();
    this.rect = { x: bx, y: by, w: bw, h: bh };
  }
}
