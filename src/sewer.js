import { pixelRect, pixelDisc, WORLD_PX } from './sprites.js';
import { rand } from './utils.js';

// Easter egg de la calle: de vez en cuando una tapa de alcantarilla se desliza, un cocodrilo asoma la cabeza,
// sonríe unos segundos y se vuelve a esconder (y se esconde de golpe si te acercas o suena un disparo).
// Todo es dibujo y sonido: no interviene en la jugabilidad (la cabeza no hace daño ni colisiona).
const FIRST_DELAY = [14, 28];       // s hasta la primera aparición
const NEXT_DELAY = [25, 60];        // s entre apariciones (aleatorio)
const SEE_MIN = 190, SEE_MAX = 480; // se elige una tapa que el jugador pueda ver, pero no pegada a él
const SCARE_DIST = 150;             // si el jugador se acerca a menos de esto, se esconde de inmediato
const SLIDE = 0.7, RISE = 0.6, GRIN = 3.6, SINK = 0.5, CLOSE = 0.7, PANIC_SINK = 0.18, PANIC_CLOSE = 0.3;
const COVER_SHIFT = 11;             // px internos que se desliza la tapa

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
      const near = this.covers.filter((c) => { const d = Math.hypot(c.x - p.x, c.y - p.y); return d > SEE_MIN && d < SEE_MAX; });
      if (!near.length) { this.timer = 4; return; } // ninguna a la vista: reintenta pronto
      this.start(near[Math.floor(Math.random() * near.length)], game);
      this.timer = rand(...NEXT_DELAY);
      return;
    }
    cur.t += dt;
    if (!cur.panic && cur.phase !== 'close' && cur.phase !== 'sink' && Math.hypot(cur.x - p.x, cur.y - p.y) < SCARE_DIST) this.scare(cur, game);
    // Mira hacia el jugador (solo en los 4 ejes: se dibuja alineado a la rejilla).
    const dx = p.x - cur.x, dy = p.y - cur.y;
    if (cur.phase === 'rise' || cur.phase === 'grin') {
      cur.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      if (cur.face === (cur.dir > 0 ? 0 : 2)) cur.face = dy > 0 ? 1 : 3; // nunca mira hacia donde está la tapa
    }
    const dur = { slide: SLIDE, rise: RISE, grin: GRIN, sink: cur.panic ? PANIC_SINK : SINK, close: cur.panic ? PANIC_CLOSE : CLOSE }[cur.phase];
    const k = Math.min(1, cur.t / dur);
    if (cur.phase === 'slide') cur.slide = k;
    else if (cur.phase === 'rise') cur.rise = k;
    else if (cur.phase === 'sink') cur.rise = cur.rise0 * (1 - k);
    else if (cur.phase === 'close') cur.slide = cur.slide0 * (1 - k);
    if (cur.t >= dur) this.next(cur, game);
  }

  start(c, game) {
    c.phase = 'slide'; c.t = 0; c.panic = false; c.slide = 0; c.rise = 0;
    c.dir = game.player.x > c.x ? -1 : 1; // la tapa se desliza al lado opuesto al jugador (la cabeza mira hacia él)
    game.playAt('manholeScrape', c.x, c.y, 0.9);
  }

  next(c, game) {
    if (c.phase === 'slide') { c.phase = 'rise'; game.playAt('crocUp', c.x, c.y, 0.8); }
    else if (c.phase === 'rise') c.phase = 'grin';
    else if (c.phase === 'grin') { c.phase = 'sink'; c.rise0 = 1; game.playAt('crocDown', c.x, c.y, 0.7); }
    else if (c.phase === 'sink') { c.phase = 'close'; c.slide0 = 1; c.rise = 0; game.playAt('manholeScrape', c.x, c.y, 0.7); }
    else { c.phase = 'idle'; c.slide = 0; }
    c.t = 0;
  }

  // Se esconde ya (aunque estuviera a medio salir): hunde la cabeza y cierra la tapa con tiempos recortados.
  scare(c, game) {
    if (c.phase === 'close' || c.phase === 'sink') return;
    c.panic = true;
    if (c.phase === 'slide') { c.phase = 'close'; c.slide0 = c.slide; c.t = 0; return; }
    c.phase = 'sink'; c.rise0 = c.rise; c.t = 0;
    game.playAt('crocDown', c.x, c.y, 0.9);
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
    ctx.fillStyle = '#05030a'; pixelDisc(ctx, cx + 1, cy + 1, 7, WORLD_PX);
    ctx.fillStyle = '#14101f'; pixelDisc(ctx, cx, cy, 7, WORLD_PX);
    ctx.fillStyle = '#4a4566'; pixelDisc(ctx, cx, cy, 6, WORLD_PX);
    ctx.fillStyle = '#322e4a'; pixelDisc(ctx, cx, cy, 5, WORLD_PX);
    for (let i = -4; i <= 4; i += 2) px(cx + i, cy - 3, 1, 7, '#26223a');
    px(cx - 4, cy - 5, 4, 1, '#5d5880');
    px(cx + 2, cy + 2, 2, 1, '#6a3a22');
  }

  // Cabeza de cocodrilo vista desde arriba, asomando de la boca del agujero en la dirección `face`.
  drawHead(ctx, c) {
    const cx = c.x / WORLD_PX, cy = c.y / WORLD_PX; // en píxeles internos
    const fx = [1, 0, -1, 0][c.face], fy = [0, 1, 0, -1][c.face];
    const base = -20 + c.rise * 16; // origen local de la cabeza respecto al centro del agujero
    // Recorte: solo se ve lo que está sobre el agujero o delante de él (la cabeza sale de dentro).
    ctx.save();
    ctx.beginPath();
    const x0 = Math.min(-8, 8 + fx * 22), x1 = Math.max(-8, 8 + fx * 22), y0 = Math.min(-8, 8 + fy * 22), y1 = Math.max(-8, 8 + fy * 22);
    ctx.rect((cx + x0) * WORLD_PX, (cy + y0) * WORLD_PX, (x1 - x0) * WORLD_PX, (y1 - y0) * WORLD_PX);
    ctx.clip();
    // Rectángulo en coordenadas locales (u hacia donde mira, v lateral), en píxeles internos.
    const R = (u, v, du, dv, col) => {
      const ax = cx + fx * u - fy * v, ay = cy + fy * u + fx * v;
      const bx = cx + fx * (u + du) - fy * (v + dv), by = cy + fy * (u + du) + fx * (v + dv);
      ctx.fillStyle = col;
      pixelRect(ctx, Math.min(ax, bx) * WORLD_PX, Math.min(ay, by) * WORLD_PX, Math.max(1, Math.abs(bx - ax)), Math.max(1, Math.abs(by - ay)));
    };
    const u0 = base;
    const grin = c.phase === 'grin' ? Math.min(1, c.t / 0.25) : (c.phase === 'sink' ? 1 : 0);
    // sombra bajo la cabeza, contorno, cráneo y hocico
    R(u0 - 3, -6, 19, 12, '#07120a');
    R(u0 - 4, -6, 9, 12, '#14310f'); R(u0 - 3, -5, 7, 10, '#3f9a3a'); R(u0 - 2, -4, 4, 8, '#56b84a');
    R(u0 + 5, -4, 9, 8, '#14310f'); R(u0 + 5, -3, 8, 6, '#3f9a3a'); R(u0 + 6, -2, 6, 4, '#56b84a');
    for (let i = 0; i < 3; i++) R(u0 - 2 + i * 2, -1 + (i % 2), 1, 1, '#2a6a28'); // escamas del lomo
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
      R(u0 + 6, -4, 7, 1, jaw); R(u0 + 6, 3, 7, 1, jaw);
      R(u0 + 5, -5, 1, 1, jaw); R(u0 + 5, 4, 1, 1, jaw); // comisuras en alto: sonríe
      for (let i = 0; i < 4; i++) { R(u0 + 7 + i * 2, -3, 1, 1, '#ffffff'); R(u0 + 7 + i * 2, 2, 1, 1, '#ffffff'); }
      R(u0 + 7 + (Math.floor(this.clock * 6) % 4) * 2, -3, 1, 1, '#fffbd0'); // destello en un diente
    }
    ctx.restore();
  }
}
