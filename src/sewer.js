import { pixelRect, pixelDisc, WORLD_PX } from './sprites.js';
import { isSolidAt } from './map.js';
import { rand } from './utils.js';

// Easter egg de la calle: de vez en cuando una tapa de alcantarilla se desliza, un cocodrilo asoma la cabeza,
// sonríe unos segundos y se vuelve a esconder (y se esconde de golpe si te acercas o suena un disparo).
// Todo es dibujo y sonido: no interviene en la jugabilidad (la cabeza no hace daño ni colisiona).
const FIRST_DELAY = [14, 28];       // s hasta la primera aparición
const NEXT_DELAY = [25, 60];        // s entre apariciones (aleatorio)
const SEE_MIN = 190, SEE_MAX = 480; // se elige una tapa que el jugador pueda ver, pero no pegada a él
const SCARE_DIST = 150;             // si el jugador se acerca a menos de esto, se esconde de inmediato
const SNAP = 0.32;                  // s que dura el chasquido de dientes al acercarte demasiado
const SLIDE = 0.7, RISE = 0.6, GRIN = 3.6, SINK = 0.5, CLOSE = 0.7, PANIC_SINK = 0.18, PANIC_CLOSE = 0.3;
const COVER_SHIFT = 16;             // px internos que se desliza la tapa
const FACES = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // derecha, abajo, izquierda, arriba (índice = c.face)
const SCALE = 1.5;                  // tamaño de la cabeza respecto al diseño base (más visible al pasar corriendo)

export class Sewer {
  constructor(covers) {
    this.covers = covers.map((c) => ({ ...c, phase: 'idle', t: 0, dir: 1, face: 0, slide: 0, rise: 0, panic: false }));
    this.timer = rand(...FIRST_DELAY);
    this.clock = 0;
    this.game = null;
  }

  bind(game) { this.game = game; }

  get active() { return this.covers.find((c) => c.phase !== 'idle') || null; }

  update(dt, game) {
    this.clock += dt;
    const p = game.player;
    const cur = this.active;
    if (!cur) {
      this.timer -= dt;
      if (this.timer > 0) return;
      const near = this.covers.filter((c) => { if (c.entrance) return false; const d = Math.hypot(c.x - p.x, c.y - p.y); return d > SEE_MIN && d < SEE_MAX; });
      if (!near.length) { this.timer = 4; return; } // ninguna a la vista: reintenta pronto
      this.start(near[Math.floor(Math.random() * near.length)], game);
      this.timer = rand(...NEXT_DELAY);
      return;
    }
    cur.t += dt;
    if (!cur.panic && cur.phase !== 'close' && cur.phase !== 'sink' && Math.hypot(cur.x - p.x, cur.y - p.y) < SCARE_DIST) this.scare(cur, game, true);
    // Gira hacia el jugador (solo en los 4 ejes), pero solo hacia lados con sitio y sin chocar con la tapa.
    if (cur.phase === 'rise' || cur.phase === 'grin') {
      const f = this.pickFace(cur, game);
      if (f !== cur.face && !(FACES[f][0] === cur.dir)) cur.face = f;
    }
    const dur = { slide: SLIDE, rise: RISE, grin: GRIN, snap: SNAP, sink: cur.panic ? PANIC_SINK : SINK, close: cur.panic ? PANIC_CLOSE : CLOSE }[cur.phase];
    const k = Math.min(1, cur.t / dur);
    if (cur.phase === 'slide') cur.slide = k;
    else if (cur.phase === 'rise') cur.rise = k;
    else if (cur.phase === 'sink') cur.rise = cur.rise0 * (1 - k);
    else if (cur.phase === 'close') cur.slide = cur.slide0 * (1 - k);
    if (cur.t >= dur) this.next(cur, game);
  }

  // ¿Hay sitio para la cabeza (largo ~34 u y ancho ~28 u) mirando en la dirección f? Nada sólido (valla, mueble, pared).
  roomFor(c, game, f) {
    const [fx, fy] = FACES[f];
    for (const k of [14, 26, 38]) for (const lat of [-14, 0, 14]) {
      if (isSolidAt(game.map, c.x + fx * k - fy * lat, c.y + fy * k + fx * lat)) return false;
    }
    return true;
  }

  // Lado al que asoma: el más alineado con el jugador de los que tienen sitio (si ninguno, el que tenga más espacio libre).
  pickFace(c, game) {
    const p = game.player, dx = p.x - c.x, dy = p.y - c.y, len = Math.hypot(dx, dy) || 1;
    const order = [0, 1, 2, 3].sort((a, b) => (FACES[b][0] * dx + FACES[b][1] * dy) / len - (FACES[a][0] * dx + FACES[a][1] * dy) / len);
    return order.find((f) => this.roomFor(c, game, f)) ?? order[0];
  }

  // Lado al que se desliza la tapa: izquierda o derecha con sitio libre, mejor el opuesto al jugador y nunca hacia donde mira.
  pickDir(c, game) {
    const away = game.player.x > c.x ? -1 : 1;
    const ok = (d) => FACES[c.face][0] !== d && ![14, 28, 44].some((k) => isSolidAt(game.map, c.x + d * k, c.y));
    return [away, -away].find(ok) ?? (FACES[c.face][0] === away ? -away : away);
  }

  start(c, game) {
    c.phase = 'slide'; c.t = 0; c.panic = false; c.slide = 0; c.rise = 0;
    c.face = this.pickFace(c, game);
    c.dir = this.pickDir(c, game);
    game.playAt('manholeScrape', c.x, c.y, 0.9);
  }

  next(c, game) {
    if (c.phase === 'slide') { c.phase = 'rise'; game.playAt('crocUp', c.x, c.y, 0.8); }
    else if (c.phase === 'rise') c.phase = 'grin';
    else if (c.phase === 'grin') { c.phase = 'sink'; c.rise0 = 1; game.playAt('crocDown', c.x, c.y, 0.7); }
    else if (c.phase === 'snap') { c.phase = 'sink'; c.rise0 = c.rise; }
    else if (c.phase === 'sink') { c.phase = 'close'; c.slide0 = 1; c.rise = 0; game.playAt('manholeScrape', c.x, c.y, 0.7); }
    else { c.phase = 'idle'; c.slide = 0; }
    c.t = 0;
  }

  // Se esconde ya (aunque estuviera a medio salir): hunde la cabeza y cierra la tapa con tiempos recortados.
  // `near` = el jugador se ha acercado demasiado: si tiene la cabeza fuera, CHASQUEA los dientes (ver snap) antes de esconderse.
  scare(c, game, near = false) {
    if (c.phase === 'close' || c.phase === 'sink' || c.phase === 'snap') return;
    c.panic = true;
    if (c.phase === 'slide') { c.phase = 'close'; c.slide0 = c.slide; c.t = 0; return; }
    if (near && (c.phase === 'grin' || (c.phase === 'rise' && c.rise > 0.5))) { this.snap(c, game); return; }
    c.phase = 'sink'; c.rise0 = c.rise; c.t = 0;
    game.playAt('crocDown', c.x, c.y, 0.9);
  }

  // Chasquido: la cabeza se lanza hacia delante y cierra las mandíbulas de golpe (¡CLAC!); luego se esconde. De propina deja una moneda
  // en el suelo (50 %) o +250 puntos (50 %).
  snap(c, game) {
    c.phase = 'snap'; c.t = 0; c.rise0 = c.rise;
    game.playAt('crocSnap', c.x, c.y, 1);
    game.addFloat(c.x, c.y - 26, '¡CLAC!', '#ffffff', 2, 0.9);
    game.camera.addShake(5);
    game.fx.kick(0.3);
    if (Math.random() < 0.5) {
      const [fx, fy] = FACES[c.face];
      game.street.dropCoin(c.x + fx * 30, c.y + fy * 30);
      game.addFloat(c.x, c.y - 14, '¡SUELTA UNA MONEDA!', '#ffbe0b', 1, 1.6);
    } else {
      game.score.addBonus(250);
      game.addFloat(c.x, c.y - 14, '+250 PROPINA', '#ffbe0b', 1, 1.6);
    }
  }

  // Un disparo o un golpe fuerte (Game.makeNoise) a menos de `radius`: se esconde.
  heard(x, y, radius) {
    const c = this.active;
    if (!c || c.panic || c.phase === 'sink' || c.phase === 'close') return;
    if (Math.hypot(c.x - x, c.y - y) < Math.min(radius, 520)) this.scare(c, this.game);
  }

  draw(ctx) {
    for (const c of this.covers) {
      if (c.rise > 0.001 && c.phase !== 'idle') this.drawHead(ctx, c);
      this.drawCover(ctx, c);
    }
  }

  drawCover(ctx, c) {
    const off = Math.round(c.slide * COVER_SHIFT) * c.dir;
    const cx = Math.round(c.x / WORLD_PX) + off, cy = Math.round(c.y / WORLD_PX);
    const px = (x, y, w, h, col) => { ctx.fillStyle = col; pixelRect(ctx, x * WORLD_PX, y * WORLD_PX, w, h); };
    // sombra y disco de hierro con anillo, ranuras y óxido
    ctx.fillStyle = '#05030a'; pixelDisc(ctx, cx + 1, cy + 1, 11, WORLD_PX);
    ctx.fillStyle = '#14101f'; pixelDisc(ctx, cx, cy, 11, WORLD_PX);
    ctx.fillStyle = '#4a4566'; pixelDisc(ctx, cx, cy, 10, WORLD_PX);
    ctx.fillStyle = '#322e4a'; pixelDisc(ctx, cx, cy, 8, WORLD_PX);
    for (let k = -6; k <= 6; k += 3) px(cx + k, cy - 5, 1, 11, '#26223a');
    px(cx - 6, cy - 8, 6, 1, '#5d5880');
    px(cx + 3, cy + 3, 3, 1, '#6a3a22');
  }

  // Cabeza de cocodrilo vista desde arriba (a escala SCALE respecto al diseño base), asomando de la boca del agujero
  // en la dirección `face`. Al sonreír, los dientes destellan: halo aditivo pulsante y destellos en cruz.
  drawHead(ctx, c) {
    const S = SCALE;
    const cx = c.x / WORLD_PX, cy = c.y / WORLD_PX; // en píxeles internos
    const fx = [1, 0, -1, 0][c.face], fy = [0, 1, 0, -1][c.face];
    const snapK = c.phase === 'snap' ? Math.min(1, c.t / SNAP) : 0; // 0..1 durante el chasquido
    const base = -20 + c.rise * 16 + 4 * Math.sin(snapK * Math.PI); // origen local de la cabeza (diseño base); se lanza hacia delante al chasquear
    // Recorte: solo se ve lo que está sobre el agujero o delante de él (la cabeza sale de dentro).
    ctx.save();
    ctx.beginPath();
    const r0 = Math.round(12 * S / 1.5), far = Math.round(34 * S / 1.5);
    // La zona visible = el agujero (±r0) + el tramo hacia donde mira. (Antes, mirando a la izquierda o arriba, el rectángulo no incluía el agujero y la cabeza salía cortada.)
    const x0 = Math.min(-r0, fx * far), x1 = Math.max(r0, fx * far), y0 = Math.min(-r0, fy * far), y1 = Math.max(r0, fy * far);
    ctx.rect((cx + x0) * WORLD_PX, (cy + y0) * WORLD_PX, (x1 - x0) * WORLD_PX, (y1 - y0) * WORLD_PX);
    ctx.clip();
    // Rectángulo en coordenadas locales del diseño base (u hacia donde mira, v lateral), escalado y alineado a píxeles.
    const R = (u, v, du, dv, col) => {
      const ax = cx + Math.round((fx * u - fy * v) * S), ay = cy + Math.round((fy * u + fx * v) * S);
      const bx = cx + Math.round((fx * (u + du) - fy * (v + dv)) * S), by = cy + Math.round((fy * (u + du) + fx * (v + dv)) * S);
      ctx.fillStyle = col;
      pixelRect(ctx, Math.min(ax, bx) * WORLD_PX, Math.min(ay, by) * WORLD_PX, Math.max(1, Math.abs(bx - ax)), Math.max(1, Math.abs(by - ay)));
    };
    const u0 = base;
    const grin = c.phase === 'grin' ? Math.min(1, c.t / 0.25) : (c.phase === 'sink' || c.phase === 'snap' ? 1 : 0);
    // sombra bajo la cabeza, contorno, cráneo y hocico
    R(u0 - 3, -6, 19, 12, '#07120a');
    R(u0 - 4, -6, 9, 12, '#14310f'); R(u0 - 3, -5, 7, 10, '#3f9a3a'); R(u0 - 2, -4, 4, 8, '#56b84a');
    R(u0 + 5, -4, 9, 8, '#14310f'); R(u0 + 5, -3, 8, 6, '#3f9a3a'); R(u0 + 6, -2, 6, 4, '#56b84a');
    for (let k = 0; k < 3; k++) R(u0 - 2 + k * 2, -1 + (k % 2), 1, 1, '#2a6a28'); // escamas del lomo
    R(u0 + 11, -2, 1, 1, '#0b1a0b'); R(u0 + 11, 1, 1, 1, '#0b1a0b');              // fosas nasales
    // ojos saltones; parpadean de vez en cuando
    const blink = (this.clock * 1.3 + c.tx * 0.37) % 3 < 0.18;
    for (const v of [-6, 4]) {
      R(u0 + 1, v, 3, 3, '#14310f');
      R(u0 + 1, v + 1, 2, 2, blink ? '#3f9a3a' : '#ffe45a');
      if (!blink) R(u0 + 2, v + 1, 1, 1, '#0b0b0b');
    }
    // sonrisa: línea clara a cada lado del hocico con las comisuras hacia arriba, y dientes que brillan
    if (grin > 0) {
      const jaw = '#e8f4d0';
      const jv = Math.round(4 - 2.5 * snapK); // semiapertura de la boca: al chasquear se cierra de golpe
      R(u0 + 6, -jv, 7, 1, jaw); R(u0 + 6, jv - 1, 7, 1, jaw);
      R(u0 + 5, -jv - 1, 1, 1, jaw); R(u0 + 5, jv, 1, 1, jaw); // comisuras en alto: sonríe
      for (let k = 0; k < 4; k++) { R(u0 + 7 + k * 2, -(jv - 1), 1, 1, '#ffffff'); R(u0 + 7 + k * 2, jv - 2, 1, 1, '#ffffff'); }
      if (snapK > 0.55) { // fogonazo blanco de los dientes al cerrarse
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.9;
        R(u0 + 5, -jv - 1, 9, 2 * jv + 1, '#ffffff');
        ctx.restore();
      }
      // Destello: halo aditivo que late sobre toda la dentadura y una chispa en cruz que salta de diente en diente.
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 9);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.25 + 0.35 * pulse) * grin;
      R(u0 + 6, -4, 7, 2, '#fff6c8'); R(u0 + 6, 2, 7, 2, '#fff6c8');
      ctx.restore();
      const step = Math.floor(this.clock * 5) % 4, side = Math.floor(this.clock * 2.5) % 2 ? -(jv - 1) : jv - 2;
      const sx = u0 + 7 + step * 2;
      R(sx, side, 1, 1, '#ffffff');
      R(sx - 1, side, 1, 1, '#fffbd0'); R(sx + 1, side, 1, 1, '#fffbd0'); // brazos de la cruz (en el eje del hocico)
      R(sx, side - 1, 1, 1, '#fffbd0'); R(sx, side + 1, 1, 1, '#fffbd0');
      R(sx - 2, side, 1, 1, '#ffffff'); R(sx + 2, side, 1, 1, '#ffffff');
    }
    ctx.restore();
  }
}
