import { isSolidAt } from './map.js';
import { drawSprite, pixelRect } from './sprites.js';
import { seededRandom, rand } from './utils.js';

// AMBIENTE del túnel de la alcantarilla (piso 3): todo es puramente visual. Ni cuerpos, ni ratas, ni goteras, ni haces de luz entran en la cuadrícula de colisiones ni en la visión
// del cocodrilo: no estorban el paso, la huida a la escalera ni el lanzamiento de la palanca.
//   · cuerpos que la mafia ha tirado por las rejillas: flotan en el canal y dejan un RASTRO ROJO que la corriente (hacia el este) arrastra; uno de ellos lo está devorando el cocodrilo;
//   · rejillas y tapas de desagüe, manchas de humedad y moho, bolsas negras rotas en las orillas (capas estáticas: `paintStatics`);
//   · haces de luz tenue que caen por las rejillas del techo, con motas de polvo; goteras de las válvulas oxidadas; ratas que huyen si te acercas.
const FLOW_SPEED = 15;                      // u/s a la que baja el rastro rojo
const TAU = Math.PI * 2;

// Cuerpos (x, y en unidades del mundo, ángulo y sprite); `feed` = el que devora el cocodrilo (se coloca delante de su hocico).
export function makeBodies(crocStart) {
  return [
    { x: 11.5 * 32, y: 6 * 32 + 6, a: 0.25, kind: 'enemyCorpse', trail: 200 },
    { x: 31.5 * 32, y: 5.5 * 32 + 12, a: -0.5, kind: 'armedCorpse', trail: 240 },
    { x: 37.6 * 32, y: 6.4 * 32, a: 0.9, kind: 'runnerCorpse', trail: 150 },
    { x: crocStart.x, y: crocStart.y - 30, a: 0.1, kind: 'enemyCorpse', trail: 260, feed: true },
  ];
}

const DRAINS = [[4, 9], [14, 3], [20, 10], [26, 2], [34, 9], [41, 3]];      // rejillas de desagüe en el suelo (1 casilla)
const LIDS = [[11, 2], [38, 10]];                                          // tapas redondas de registro
const BAGS = [[6, 4], [14, 8], [25, 4], [33, 8], [40, 4]];                 // bolsas negras rotas en las orillas del canal
const LIGHTS = [[6, 2], [19, 9], [28, 2], [40, 9]];                        // rejillas del techo: parches de luz 2×2 casillas
const RAT_SPOTS = [[6, 3], [15, 9], [27, 3], [38, 9], [12, 4], [33, 10], [20, 3]];

// Capas estáticas sobre el suelo y las paredes (coordenadas de capa: 1 px = 2 u, casilla = 16 px).
export function paintStatics(fc, wc, m, bodies) {
  const PX = 16, rnd = seededRandom(4242);
  const disc = (c, cx, cy, r) => { for (let dy = -r; dy <= r; dy++) { const h = Math.floor(Math.sqrt(r * r - dy * dy)); c.fillRect(Math.round(cx) - h, Math.round(cy) + dy, h * 2 + 1, 1); } };
  // Manchas de humedad y moho en los dos paseos y en las paredes.
  fc.globalAlpha = 0.3; fc.fillStyle = '#0b2a10';
  for (let i = 0; i < 46; i++) {
    const north = rnd() < 0.5, y = (north ? 2 + rnd() * 3 : 8 + rnd() * 3) * PX, x = (2 + rnd() * (m.w - 4)) * PX;
    disc(fc, x, y, 2 + Math.floor(rnd() * 4));
  }
  fc.globalAlpha = 0.5; fc.fillStyle = '#1f4a1a';
  for (let i = 0; i < 28; i++) disc(fc, (2 + rnd() * (m.w - 4)) * PX, (rnd() < 0.5 ? 2 + rnd() * 1.2 : 9.8 + rnd() * 1.2) * PX, 1 + Math.floor(rnd() * 2));
  fc.globalAlpha = 1;
  wc.globalAlpha = 0.55; wc.fillStyle = '#0a2a10';
  for (let i = 0; i < 40; i++) { const top = rnd() < 0.5; disc(wc, (2 + rnd() * (m.w - 4)) * PX, (top ? 1.1 + rnd() * 0.8 : m.h - 2 + rnd() * 0.8) * PX, 2 + Math.floor(rnd() * 3)); }
  wc.globalAlpha = 1;
  // Rejillas de desagüe: marco, barras y limo.
  for (const [tx, ty] of DRAINS) {
    const x0 = tx * PX, y0 = ty * PX;
    fc.fillStyle = '#0a0f0c'; fc.fillRect(x0 + 1, y0 + 1, 14, 14);
    fc.fillStyle = '#2a3a30'; fc.fillRect(x0 + 1, y0 + 1, 14, 1); fc.fillRect(x0 + 1, y0 + 14, 14, 1); fc.fillRect(x0 + 1, y0 + 1, 1, 14); fc.fillRect(x0 + 14, y0 + 1, 1, 14);
    fc.fillStyle = '#4a5a52'; for (let k = 0; k < 5; k++) fc.fillRect(x0 + 3 + k * 2 + (k > 1 ? 1 : 0), y0 + 2, 1, 12);
    fc.fillStyle = '#04140a'; fc.fillRect(x0 + 2, y0 + 7, 12, 2);
    fc.fillStyle = '#3f9a2a'; fc.fillRect(x0 + 2, y0 + 13, 4, 1); fc.fillRect(x0 + 10, y0 + 2, 3, 1);
  }
  // Tapas redondas de registro.
  for (const [tx, ty] of LIDS) {
    const cx = tx * PX + 8, cy = ty * PX + 8;
    fc.fillStyle = '#05030a'; disc(fc, cx + 1, cy + 1, 7);
    fc.fillStyle = '#3a4a42'; disc(fc, cx, cy, 6);
    fc.fillStyle = '#26332c'; disc(fc, cx, cy, 4);
    fc.fillStyle = '#4a5a52'; for (let k = -3; k <= 3; k += 3) fc.fillRect(cx + k, cy - 3, 1, 7);
    fc.fillStyle = '#6a3a22'; fc.fillRect(cx + 2, cy + 3, 3, 1);
  }
  // Bolsas negras rotas en las orillas, con la basura desparramada.
  for (const [tx, ty] of BAGS) {
    const cx = tx * PX + 8, cy = ty * PX + 8;
    fc.fillStyle = '#05050a'; disc(fc, cx, cy, 5); disc(fc, cx + 5, cy + 2, 3);
    fc.fillStyle = '#16161e'; disc(fc, cx - 1, cy - 1, 3);
    fc.fillStyle = '#34343f'; fc.fillRect(cx - 3, cy - 3, 2, 1); fc.fillRect(cx + 4, cy + 1, 1, 1);
    fc.fillStyle = '#c9c3e6'; for (let k = 0; k < 6; k++) fc.fillRect(cx + 5 + Math.floor(rnd() * 8), cy - 2 + Math.floor(rnd() * 8), 1 + (k % 2), 1);
    fc.fillStyle = '#6a3a22'; fc.fillRect(cx + 7, cy + 4, 2, 1);
  }
  // Rastros rojos: una cinta que baja con la corriente (hacia el este) desde cada cuerpo, más intensa junto a él.
  for (const b of bodies) {
    const bx = b.x / 2, by = b.y / 2, len = b.trail / 2;
    for (let i = 0; i < len; i++) {
      const k = 1 - i / len, y = Math.max(5 * PX + 3, Math.min(8 * PX - 3, by + Math.sin(i * 0.13 + b.x) * 1.6 + i * 0.012));
      fc.globalAlpha = 0.55 * Math.pow(k, 1.3); fc.fillStyle = '#4a0610'; fc.fillRect(Math.round(bx + i), Math.round(y) - 1, 1, 3);
      fc.globalAlpha = 0.5 * Math.pow(k, 1.6); fc.fillStyle = '#9a0a24'; fc.fillRect(Math.round(bx + i), Math.round(y), 1, 1 + (rnd() < 0.35 ? 1 : 0));
    }
    fc.globalAlpha = 0.65; fc.fillStyle = '#6a0818'; disc(fc, bx, by + 1, 7);   // mancha densa bajo el cuerpo
    fc.globalAlpha = 1;
  }
}

class Rat {
  constructor(spot) { this.spot = spot; this.place(spot); this.state = 'idle'; this.timer = rand(0.3, 1.5); this.speed = 0; this.angle = rand(0, TAU); this.alpha = 1; }
  place(spot) { this.x = spot[0] * 32 + 16 + rand(-6, 6); this.y = spot[1] * 32 + 16 + rand(-6, 6); }
  update(dt, map, p, spots) {
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (this.state === 'hide') {
      this.timer -= dt;
      if (this.timer <= 0) {                      // reaparece en otro rincón lejos del jugador
        const far = spots.filter((s) => Math.hypot(s[0] * 32 + 16 - p.x, s[1] * 32 + 16 - p.y) > 220);
        this.place(far.length ? far[Math.floor(Math.random() * far.length)] : this.spot);
        this.state = 'idle'; this.alpha = 0; this.speed = 0; this.timer = rand(0.5, 1.5);
      }
      return;
    }
    if (this.alpha < 1) this.alpha = Math.min(1, this.alpha + dt * 2);
    if (this.state === 'idle' && d < 95) { this.state = 'flee'; this.angle = Math.atan2(this.y - p.y, this.x - p.x) + rand(-0.5, 0.5); this.speed = 190; this.timer = 1.6; }
    if (this.state === 'flee') {
      this.timer -= dt;
      if (this.timer <= 0 || this.y < 2.6 * 32 || this.y > 10.4 * 32) { this.state = 'hide'; this.timer = rand(6, 11); this.alpha = 0; return; } // se mete por un desagüe
    } else {
      this.timer -= dt;
      if (this.timer <= 0) { this.timer = rand(0.5, 2); if (Math.random() < 0.5) { this.angle = rand(0, TAU); this.speed = rand(10, 40); } else this.speed = 0; }
    }
    const nx = this.x + Math.cos(this.angle) * this.speed * dt, ny = this.y + Math.sin(this.angle) * this.speed * dt;
    const water = ny > 5 * 32 && ny < 8 * 32;
    if (isSolidAt(map, nx, ny) || (water && this.state === 'idle')) this.angle += Math.PI * (0.5 + Math.random() * 0.5);   // las ratas no pisan los pilares ni el canal
    else { this.x = nx; this.y = ny; }
  }
  draw(ctx) { if (this.state !== 'hide' && this.alpha > 0) drawSprite(ctx, 'rat', this.x, this.y, this.angle, { alpha: this.alpha }); }
}

export class Ambience {
  constructor(map, crocStart) {
    this.map = map; this.t = 0;
    this.bodies = makeBodies(crocStart);
    this.flecks = [];                                         // motas rojas que la corriente arrastra a lo largo de cada rastro
    this.bodies.forEach((b, i) => { for (let k = 0; k < 12; k++) this.flecks.push({ b, k: Math.random(), dy: rand(-5, 5), ph: Math.random() * 6 }); });
    this.rats = RAT_SPOTS.slice(0, 5).map((s) => new Rat(s));
    this.drips = []; this.drops = []; this.ripples = []; this.specks = [];
    for (let tx = 2; tx < map.w - 2; tx++) if (tx % 6 === 2) this.drips.push({ x: tx * 32 + 15, t: rand(0, 2.5) });   // una gotera bajo cada válvula de la pared norte
    this.motes = [];
    LIGHTS.forEach(([tx, ty], i) => { for (let k = 0; k < 5; k++) this.motes.push({ x: tx * 32 + rand(4, 60), y: ty * 32 + rand(0, 60), ph: Math.random() * 9, i }); });
  }

  // Salpicaduras de sangre que lanza el cocodrilo al desgarrar el cuerpo.
  splat(x, y, a) { for (let k = 0; k < 3; k++) this.specks.push({ x, y, vx: Math.cos(a + rand(-1.2, 1.2)) * rand(20, 60), vy: Math.sin(a + rand(-1.2, 1.2)) * rand(20, 60), life: rand(0.35, 0.7) }); }

  update(dt, game) {
    this.t += dt;
    const p = game.player;
    for (const r of this.rats) r.update(dt, this.map, p, RAT_SPOTS);
    for (const e of this.drips) { e.t -= dt; if (e.t <= 0) { e.t = rand(1.3, 3.2); this.drops.push({ x: e.x, y: 62, vy: 0, land: 3 * 32 + rand(0, 36) }); } }
    for (const d of this.drops) { d.vy += 520 * dt; d.y += d.vy * dt; if (d.y >= d.land) { d.dead = true; this.ripples.push({ x: d.x, y: d.land, a: 0 }); } }
    this.drops = this.drops.filter((d) => !d.dead);
    for (const r of this.ripples) r.a += dt;
    this.ripples = this.ripples.filter((r) => r.a < 0.45);
    for (const s of this.specks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
    this.specks = this.specks.filter((s) => s.life > 0);
    for (const f of this.flecks) { f.k += (FLOW_SPEED / f.b.trail) * dt; if (f.k > 1) { f.k = 0; f.dy = rand(-5, 5); } }
  }

  // Cuerpos flotando, motas del rastro, gotas, salpicaduras y ratas (bajo el cocodrilo y el jugador).
  drawBelow(ctx, croc) {
    const t = this.t;
    ctx.fillStyle = '#b01030';
    for (const f of this.flecks) {
      const x = f.b.x + f.k * f.b.trail, y = Math.max(5 * 32 + 6, Math.min(8 * 32 - 6, f.b.y + f.dy + Math.sin(x * 0.04 + f.ph) * 4));
      ctx.globalAlpha = 0.75 * (1 - f.k); pixelRect(ctx, x, y, 2, 1);
    }
    ctx.globalAlpha = 1;
    this.bodies.forEach((b, i) => {
      const tug = b.feed && croc.mode === 'feed' ? Math.sin(t * 9) * 1.4 : 0;               // el que se está comiendo, a tirones
      drawSprite(ctx, b.kind, b.x + tug + Math.sin(t * 0.7 + i) * 1.2, b.y + Math.sin(t * 1.3 + i * 2) * 1.5, b.a + Math.sin(t * 0.5 + i) * 0.06, { alpha: 0.95 });
      if (b.feed && Math.sin(t * 0.8) > 0.985) { ctx.fillStyle = '#ffe9a0'; ctx.globalAlpha = 0.8; pixelRect(ctx, b.x + 4, b.y - 5, 1, 1); } // un destello dorado muy leve (la máscara)
      ctx.fillStyle = '#9bff5a'; ctx.globalAlpha = 0.35;                                    // espuma pegada al cuerpo
      pixelRect(ctx, b.x - 12 + Math.sin(t * 1.1 + i) * 2, b.y + 11, 3, 1); pixelRect(ctx, b.x + 8, b.y - 12 + Math.sin(t + i) * 2, 2, 1);
      ctx.globalAlpha = 1;
    });
    ctx.fillStyle = '#9bff5a';
    for (const d of this.drops) pixelRect(ctx, d.x, d.y, 1, 2);
    ctx.fillStyle = '#bfff8a';
    for (const r of this.ripples) { const k = r.a / 0.45, rad = 2 + k * 9; ctx.globalAlpha = 0.7 * (1 - k); pixelRect(ctx, r.x - rad, r.y, 2, 1); pixelRect(ctx, r.x + rad - 2, r.y, 2, 1); pixelRect(ctx, r.x - 2, r.y - rad * 0.5, 4, 1); pixelRect(ctx, r.x - 2, r.y + rad * 0.5, 4, 1); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#c01030';
    for (const s of this.specks) { ctx.globalAlpha = Math.min(1, s.life * 3); pixelRect(ctx, s.x, s.y, 1, 1); }
    ctx.globalAlpha = 1;
    for (const r of this.rats) r.draw(ctx);
  }

  // Haces de luz que caen por las rejillas del techo (sobre todo, con la cuadrícula de barras y motas de polvo). Aditivos y muy tenues.
  drawLight(ctx) {
    const t = this.t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#cdebb0';
    LIGHTS.forEach(([tx, ty], i) => { ctx.globalAlpha = 0.05 + 0.012 * Math.sin(t * 1.7 + i * 2); pixelRect(ctx, tx * 32, ty * 32, 32, 32); });
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 12, 4, 0.30)';
    LIGHTS.forEach(([tx, ty]) => { for (let k = 0; k < 6; k++) { ctx.globalAlpha = 1; pixelRect(ctx, tx * 32 + 4 + k * 11, ty * 32, 1, 32); } for (let k = 0; k < 2; k++) pixelRect(ctx, tx * 32, ty * 32 + 20 + k * 20 - 12, 32, 1); });
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#e8ffd0';
    for (const m of this.motes) { const k = (t * 0.12 + m.ph) % 1; ctx.globalAlpha = 0.5 * Math.sin(k * Math.PI); pixelRect(ctx, m.x + Math.sin(t + m.ph) * 4, m.y + 30 - k * 60, 1, 1); }
    ctx.restore();
  }
}
