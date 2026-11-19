import { drawText, measureText } from './pixelfont.js';
import { COLORS } from './utils.js';
import { bloodyMaskPortrait } from './portraits.js';

// Líneas de comunicación del prólogo (lore). Como la radio del piso 10 son MODALES: el mundo se congela (Game.update sale antes de simular mientras hay una línea),
// la caja sale ABAJO y se pasa con CLIC / ESPACIO / ENTER (en táctil, tocar en cualquier punto: sin joysticks mientras dura). Un clic con el texto a medias lo completa;
// con el texto completo, pasa a la siguiente línea o cierra. Solo EMPIEZAN con calma (sin enemigos en chase/alert, sin panel, forcejeo, vómito ni ejecución), nunca en
// pleno combate. Cada `id` sale una vez por partida (R no las repite).
// Quien habla se anima mientras se teclea el texto: las máscaras mueven la mandíbula según la letra (vocal abierta, m/b/p cerrada) y cabecean; CENTRAL, un walkie
// con ondas de señal y un ecualizador.
const TYPE_CPS = 30, GAP = 0.45, GUARD = 0.3;   // 30 car./s (igual que la caja de radio del piso 10); 0,3 s antes de aceptar un clic (el del ataque que se acaba)
const SPEAKERS = { central: { name: 'CENTRAL', color: '#ffbe0b' } };
const VOWELS = 'aeiouáéíóúüAEIOUÁÉÍÓÚ';

export class Comms {
  constructor(game) {
    this.game = game;
    this.seen = new Set();
    this.queue = [];
    this.cur = null;        // línea en pantalla: { who, color, text, portrait, t, age, open }
    this.gap = 0;
  }

  forget() { this.seen.clear(); this.clear(); }   // partida o piso nuevo
  clear() { this.queue.length = 0; this.cur = null; this.gap = 0; }   // reintento con R: se queda `seen`

  // Encola una secuencia de líneas con un id (una sola vez por partida). `entries`: [{ speaker: 'central' | { name, color, portrait }, text }].
  // `opts.urgent`: pasan delante de las que esperan y empiezan aunque haya enemigos en alerta (el mundo se congela mientras hablan): el compañero recién liberado habla justo después.
  say(id, entries, opts = {}) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    const lines = entries.map((e) => {
      const sp = typeof e.speaker === 'string' ? SPEAKERS[e.speaker] : e.speaker;
      return { who: sp.name, color: sp.color, text: e.text, portrait: sp.portrait || null, t: 0, age: 0, open: 0, urgent: !!opts.urgent };
    });
    if (opts.urgent) this.queue.unshift(...lines); else this.queue.push(...lines);
    return true;
  }

  // ¿Se puede hablar? (sin panel, fundido, forcejeo, vómito, ejecución ni puerta en animación...). Las urgentes no exigen que no haya enemigos en alerta.
  idle() {
    const g = this.game, p = g.player;
    if (g.state !== 'playing' && g.state !== 'cleared') return false;
    return !(g.panel || g.fade || !p.alive || p.vomit || p.exec || p.doorAnim || g.hitstop > 0);
  }

  calm() {
    return this.idle() && !this.game.enemies.some((e) => e.alive && (e.state === 'chase' || e.state === 'alert'));
  }

  // Fuera de una conversación: empieza la siguiente línea en cola si hay calma.
  update(dt) {
    if (this.cur) return;
    this.gap = Math.max(0, this.gap - dt);
    const q = this.queue[0];
    if (q && this.gap <= 0 && (q.urgent ? this.idle() : this.calm())) this.begin(this.queue.shift());
  }

  begin(line) {
    this.cur = line;
    line.t = 0; line.age = 0;
    const g = this.game;
    g.sfx.play('empty'); g.sfx.play('pickup', 0.6);   // chasquido de radio al empezar cada línea
  }

  // Dentro de una conversación (el mundo está congelado): avanza el tecleo y atiende el clic.
  step(dt, click) {
    const c = this.cur;
    if (!c) return;
    c.t += dt; c.age += dt;
    if (!click || c.age < GUARD) return;   // un clic / Espacio / toque pasa DIRECTAMENTE a la siguiente línea (o cierra), aunque el texto no haya acabado de teclearse
    if (this.queue.length) this.begin(this.queue.shift());
    else { this.cur = null; this.gap = GAP; this.game.player.cooldown = Math.max(this.game.player.cooldown, 0.3); }
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

  // Abajo, como la caja de radio del piso 10 (Game.drawRadioBox): marco del color del que habla, retrato enmarcado de 32×32 animado al hablar, `NOMBRE · RADIO`, texto
  // tecleado y el walkie con la antena parpadeando.
  draw(ctx, w, h) {
    const c = this.cur, g = this.game;
    if (!c) return;
    const s = g.safe;
    ctx.fillStyle = 'rgba(5, 0, 15, 0.35)'; ctx.fillRect(0, 0, w, h);   // el mundo queda congelado y atenuado
    const bw = Math.min(w - 20, 330), textW = bw - 44 - 20;
    const rows = this.wrap(c.text, textW);
    const bh = 46 + Math.max(0, rows.length - 2) * 10;
    const bx = Math.round((w - bw) / 2), by = h - bh - 6 - s.b;
    const typed = Math.min(c.text.length, Math.floor(c.t * TYPE_CPS)), talking = typed < c.text.length;
    ctx.fillStyle = 'rgba(5, 0, 15, 0.94)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = c.color;
    ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
    // retrato animado y su marco
    const px = bx + 5, py = by + 6;
    if (c.portrait) this.drawMaskTalking(ctx, c, px, py, typed, talking);
    else this.drawRadioTalking(ctx, c, px, py, talking);
    ctx.fillStyle = c.color; ctx.fillRect(bx + 4, by + 5, 34, 1); ctx.fillRect(bx + 4, by + 38, 34, 1); ctx.fillRect(bx + 4, by + 5, 1, 34); ctx.fillRect(bx + 37, by + 5, 1, 34);
    drawText(ctx, `${c.who} · RADIO`, bx + 44, by + 5, { color: c.color });
    let left = typed;
    rows.forEach((r, i) => {
      const part = r.slice(0, Math.max(0, left));
      left -= r.length + 1;
      if (part) drawText(ctx, part, bx + 44, by + 17 + i * 10, { color: COLORS.text, shadow: null });
    });
    const wx = bx + bw - 14, wy = by + 6;                          // walkie: cuerpo, antena y piloto que parpadea (más rápido al hablar)
    ctx.fillStyle = '#14141e'; ctx.fillRect(wx, wy + 5, 8, 14);
    ctx.fillStyle = '#6b6b85'; ctx.fillRect(wx + 1, wy + 6, 6, 12);
    ctx.fillStyle = '#14141e'; ctx.fillRect(wx + 5, wy, 1, 6);
    ctx.fillStyle = Math.floor(c.t * (talking ? 10 : 4)) % 2 ? '#ff2a4a' : '#7d3a4a'; ctx.fillRect(wx + 4, wy - 1, 3, 2);
    if (c.age > 0.8) {
      const txt = g.hint('CLIC / ESPACIO ▼', 'TOCA ▼');
      if (Math.floor(c.age * 2.5) % 2) drawText(ctx, txt.replace('▼', 'v'), bx + bw - 6, by + bh - 11, { color: '#7d6f98', align: 'right' });
    }
  }

  // Máscara que habla: se dibuja entera y, si tiene `jaw` (región de la cuadrícula 12×12 que baja: ver masks.js), esa región se borra y se vuelve a pintar desplazada hacia abajo
  // según la letra que se está tecleando (vocal: abierta; m, b, p y pausas: cerrada; el resto: media), con el hueco oscuro detrás (la boca). Cabecea 1 px en las vocales.
  // Al acabar de teclear cierra la boca. Cada máscara anima solo SU boca (el pico del gallo y del búho, el hocico y el mentón del oso...), no la nariz.
  drawMaskTalking(ctx, c, x, y, typed, talking) { drawTalkingMask(ctx, c, x, y, typed, talking); }

  // CENTRAL: un walkie grande con ondas de señal que salen de la antena y un ecualizador en la rejilla mientras habla.
  drawRadioTalking(ctx, c, x, y, talking) {
    const tt = c.t;
    ctx.fillStyle = '#1a1030'; ctx.fillRect(x, y, 32, 32);
    ctx.fillStyle = '#14141e'; ctx.fillRect(x + 9, y + 12, 14, 20);        // cuerpo
    ctx.fillStyle = '#6b6b85'; ctx.fillRect(x + 10, y + 13, 12, 18);
    ctx.fillStyle = '#14141e'; ctx.fillRect(x + 19, y + 4, 2, 9);          // antena
    ctx.fillStyle = Math.floor(tt * (talking ? 12 : 4)) % 2 ? '#ff2a4a' : '#7d3a4a'; ctx.fillRect(x + 18, y + 2, 4, 3);
    const bars = [0, 1, 2, 3];                                              // ecualizador: 4 barras que suben y bajan al hablar
    bars.forEach((i) => {
      const hgt = talking ? 2 + Math.round((Math.sin(tt * (14 + i * 3) + i * 2) * 0.5 + 0.5) * 8) : 2;
      ctx.fillStyle = c.color; ctx.fillRect(x + 12 + i * 3, y + 29 - hgt, 2, hgt);
    });
    if (talking) {                                                          // ondas de señal: tres arcos de píxeles que se expanden y se apagan
      for (let k = 0; k < 3; k++) {
        const ph = (tt * 2.2 + k / 3) % 1, r = 3 + ph * 9;
        ctx.globalAlpha = 1 - ph;
        ctx.fillStyle = c.color;
        for (let a = -0.9; a <= 0.9; a += 0.3) {
          ctx.fillRect(Math.round(x + 20 + Math.cos(a - Math.PI / 4) * r), Math.round(y + 3 - Math.sin(a - Math.PI / 4) * r), 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    }
  }
}

// Retrato de una máscara que habla (compartido con la caja de radio del piso 10): `c = { text, open, portrait: { mask, gender, level, bits } }`; se dibuja en (x, y) a 32×32.
export function drawTalkingMask(ctx, c, x, y, typed, talking) {
  c.open = c.open || 0;
  const ch = talking ? c.text[typed - 1] || ' ' : ' ';
  const target = !talking ? 0 : VOWELS.includes(ch) ? 2 : /[mbpMBP .,:;¡!¿?]/.test(ch) ? 0 : 1;
  c.open += (target - c.open) * 0.5;
  const bob = talking && c.open > 1.2 ? -1 : 0;
  const mask = c.portrait.mask, cv = bloodyMaskPortrait(mask, c.portrait.level || 0, c.portrait.gender, c.portrait.bits || []); // con la sangre (roja / verde) que lleva encima
  const k = 32 / cv.width, jaw = Math.round(c.open), J = mask.jaw;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, 32, 32); ctx.clip();
  ctx.fillStyle = '#14091f'; ctx.fillRect(x, y, 32, 32);
  ctx.drawImage(cv, x, y + bob, 32, 32);
  if (J && jaw > 0) {
    const PAD = 2, cell = 2;                                        // el retrato tiene 2 px de margen y cada celda del 12×12 mide 2 px
    const sx = PAD + J.x0 * cell, sw = (J.x1 - J.x0) * cell, sy = PAD + J.y0 * cell, sh = ((J.y1 ?? 12) - J.y0) * cell;
    const dx = x + sx * k, dy = y + bob + sy * k, dw = sw * k, dh = sh * k;
    ctx.fillStyle = '#14091f'; ctx.fillRect(dx, dy, dw, dh);          // se borra la región original
    const inset = (J.x1 - J.x0) > 6 ? 3 * cell * k : 0;
    ctx.fillStyle = '#05000f'; ctx.fillRect(dx + inset, dy, dw - inset * 2, jaw);   // la boca abierta se ve oscura
    ctx.drawImage(cv, sx, sy, sw, sh, dx, dy + jaw, dw, dh);          // región desplazada
  }
  ctx.restore();
}
