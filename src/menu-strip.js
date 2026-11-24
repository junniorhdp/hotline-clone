import { clamp } from './utils.js';

// Franja animada de la pantalla del título (SOLO `menu.screen === 'title'`): micro-escenas con personajes del juego que cruzan la calle de abajo, por DETRÁS del panel
// de opciones y de los textos. Decorado puro: no recibe ni bloquea clics ni toques. Este archivo es la BASE TÉCNICA (área útil, director con ritmo y memoria, esqueleto de
// `MicroScene`); los sprites definitivos de cada escena llegarán después: los dibujos de abajo son siluetas de relleno (`placeholder`) para poder probar tiempos y reglas.

export const STRIP = {
  WAIT_MIN: 8, WAIT_MAX: 14,   // segundos entre una escena y la siguiente (al azar)
  GAP_MIN: 6,                  // mínimo absoluto sin actores en pantalla tras acabar una escena
  MEMORY: 3,                   // las últimas N escenas no se repiten
  MIN_SIDE: 40,                // ancho mínimo de un lateral libre
  MIN_H: 20,                   // alto mínimo útil
  FOOT: 22,                    // reserva inferior para la ayuda y el récord (h - 22)
  COMMON: 5, RARE: 1,          // pesos del sorteo
};

// Área útil de la franja o `null` si no cabe. Usa la colocación REAL del título (`L = menu.titleLayout()`) y las zonas seguras (`safe`).
//  - modo 'under': hay hueco entre la base del panel de opciones y la reserva del pie → carril a todo lo ancho, por debajo del panel.
//  - modo 'sides': no lo hay → solo los laterales libres a cada lado del panel (≥ MIN_SIDE de ancho), desde la calle (`gy`) hasta el pie.
// `extraFoot`: reserva extra del pie (el aviso del modo silencio en iPhone).
export function stripArea(w, h, L, safe = { t: 0, r: 0, b: 0, l: 0 }, extraFoot = 0) {
  const o = L && L.options;
  if (!o || !o.length) return null;
  const first = o[0], last = o[o.length - 1];
  const px = first.x - 4, pr = first.x + first.w + 4, pb = last.y + last.h + 3;
  const left = safe.l, right = w - safe.r;
  const y1 = h - STRIP.FOOT - extraFoot - safe.b;
  const underY0 = pb + 2;
  if (y1 - underY0 >= STRIP.MIN_H) return { mode: 'under', lanes: [{ x0: left, x1: right }], y0: underY0, y1, feetY: y1 - 1 };
  const y0 = Math.round(h * 0.68) + 4;   // la calle empieza en `gy` (buildScene)
  if (y1 - y0 < STRIP.MIN_H) return null;
  const lanes = [];
  if (px - 4 - left >= STRIP.MIN_SIDE) lanes.push({ x0: left, x1: px - 4 });
  if (right - (pr + 4) >= STRIP.MIN_SIDE) lanes.push({ x0: pr + 4, x1: right });
  return lanes.length ? { mode: 'sides', lanes, y0, y1, feetY: y1 - 1 } : null;
}

// --- Dibujo de relleno (siluetas con contorno; sustituir por los sprites horneados de cada personaje) -------------------------------------------------------------------------------------
const OUT = '#05010f';
function figure(ctx, x, feetY, dir, color, t, env) {
  x = Math.round(x);
  const y = feetY - 12, step = Math.floor(t * 8) % 2;
  if (!env.lite) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.12; ctx.fillStyle = color; ctx.fillRect(x - 6, y - 2, 12, 15); ctx.restore(); }
  ctx.fillStyle = OUT; ctx.fillRect(x - 4, y - 1, 8, 14);
  ctx.fillStyle = color; ctx.fillRect(x - 3, y, 6, 8);
  ctx.fillStyle = '#f2e6ff'; ctx.fillRect(x + (dir > 0 ? 1 : -3), y + 1, 2, 2);
  ctx.fillStyle = color;
  ctx.fillRect(x - 3, y + 8, 2, step ? 3 : 2); ctx.fillRect(x + 1, y + 8, 2, step ? 2 : 3);
}

// Escenas. `weight`: COMMON o RARE. `dur`: segundos. `draw(ctx, S, env, p)`: `p` = progreso 0..1 a lo largo del carril ya orientado (`S.at(p)` da la x).
export const SCENES = [
  { id: 'persecucion', weight: STRIP.COMMON, dur: 5, // un corredor persigue a un agente a través de la calle (guiño arcade)
    draw(ctx, S, env, p) { figure(ctx, S.at(p), S.feetY, S.dir, '#05d9e8', S.t, env); figure(ctx, S.at(p - 0.16), S.feetY, S.dir, '#ff4d8d', S.t + 0.3, env); } },
  { id: 'patrulla', weight: STRIP.COMMON, dur: 6.5, // un mafioso patrulla de un lado a otro con una pausa en medio
    draw(ctx, S, env, p) { const q = p < 0.4 ? p / 0.4 * 0.5 : p < 0.6 ? 0.5 : 0.5 + (p - 0.6) / 0.4 * 0.5; figure(ctx, S.at(q), S.feetY, S.dir, '#ffbe0b', p > 0.4 && p < 0.6 ? 0 : S.t, env); } },
  { id: 'cruce', weight: STRIP.COMMON, dur: 5.5, // dos agentes se cruzan en sentidos opuestos
    draw(ctx, S, env, p) { figure(ctx, S.at(p), S.feetY, S.dir, '#05d9e8', S.t, env); figure(ctx, S.at(1 - p), S.feetY, -S.dir, '#ff2a85', S.t + 0.4, env); } },
  { id: 'alcantarilla', weight: STRIP.RARE, dur: 4, // rara: una tapa se desliza y asoman dos ojos (el cocodrilo de la calle)
    draw(ctx, S, env, p) { const x = Math.round(S.at(0.5)), k = Math.sin(Math.PI * p); ctx.fillStyle = OUT; ctx.fillRect(x - 6 + Math.round(k * 6), S.feetY - 2, 12, 3); ctx.fillStyle = '#5a4f78'; ctx.fillRect(x - 5 + Math.round(k * 6), S.feetY - 2, 10, 2); if (k > 0.5) { ctx.fillStyle = '#ffe44d'; ctx.fillRect(x - 3, S.feetY - 4, 2, 2); ctx.fillRect(x + 1, S.feetY - 4, 2, 2); } } },
  { id: 'moneda', weight: STRIP.RARE, dur: 4, // rara: una moneda brilla en el suelo y un agente pasa de largo
    draw(ctx, S, env, p) { const x = Math.round(S.at(0.5)); ctx.fillStyle = OUT; ctx.fillRect(x - 3, S.feetY - 4, 6, 5); ctx.fillStyle = Math.floor(S.t * 6) % 2 ? '#ffe44d' : '#d9a400'; ctx.fillRect(x - 2, S.feetY - 3, 4, 3); figure(ctx, S.at(p), S.feetY, S.dir, '#05d9e8', S.t, env); } },
];

// Escena en curso: carril elegido, sentido y reloj propio. `at(p)` = x a lo largo del carril (entra por un borde y sale por el otro; p fuera de 0..1 queda fuera del carril, recortado).
export class MicroScene {
  constructor(def, area, rnd = Math.random) {
    this.def = def; this.t = 0; this.dur = def.dur;
    const lane = area.lanes[Math.floor(rnd() * area.lanes.length)];
    this.lane = lane; this.dir = rnd() < 0.5 ? 1 : -1; this.feetY = area.feetY; this.area = area;
  }
  at(p) { const { x0, x1 } = this.lane, span = x1 - x0 + 24; const q = this.dir > 0 ? p : 1 - p; return x0 - 12 + span * q; }
  update(dt) { this.t += dt; }
  get done() { return this.t >= this.dur; }
  draw(ctx, env, off = 0) {
    const { x0, x1 } = this.lane, A = this.area;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, A.y0 - 20, x1 - x0, A.y1 - A.y0 + 22); ctx.clip();   // nunca fuera del carril (ni sobre el panel)
    ctx.translate(off, 0);                                                              // parallax de la calle (par * 0.9)
    this.def.draw(ctx, this, env, clamp(this.t / this.dur, 0, 1));
    ctx.restore();
  }
}

// Director: una sola escena a la vez, espera 8-14 s entre escenas (mínimo 6 s sin actores) y memoria de las últimas 3 (sorteo ponderado). Reloj propio: no avanza si no se dibuja
// (otra pantalla, panel de opciones, `area` nula), así que nunca «recupera» tiempo perdido de golpe.
export class StripDirector {
  constructor(rnd = Math.random) { this.rnd = rnd; this.reset(); }

  reset() {
    this.clock = 0; this.last = null; this.scene = null; this.recent = [];
    this.nextAt = this.wait();
  }

  wait() { return Math.max(STRIP.GAP_MIN, STRIP.WAIT_MIN + this.rnd() * (STRIP.WAIT_MAX - STRIP.WAIT_MIN)); }

  hold() { this.last = null; }   // pausa el reloj (panel abierto, fundido…)

  pick() {
    let pool = SCENES.filter((s) => !this.recent.includes(s.id));
    if (!pool.length) pool = SCENES.filter((s) => s.id !== this.recent[this.recent.length - 1]);
    let r = this.rnd() * pool.reduce((a, s) => a + s.weight, 0);
    for (const s of pool) { r -= s.weight; if (r <= 0) return s; }
    return pool[pool.length - 1];
  }

  // `area` = stripArea(...) o null; `env` = { lite, strobe, off }. Dibuja la escena activa (si la hay) y avanza el reloj.
  draw(ctx, now, area, env) {
    const dt = this.last == null ? 0 : clamp(now - this.last, 0, 0.1);
    this.last = now;
    if (!area) { this.scene = null; return; }        // no cabe: nada en pantalla y el reloj no corre
    this.clock += dt;
    if (!this.scene && this.clock >= this.nextAt) {
      const def = this.pick();
      this.scene = new MicroScene(def, area, this.rnd);
      this.recent.push(def.id); if (this.recent.length > STRIP.MEMORY) this.recent.shift();
    }
    const s = this.scene;
    if (!s) return;
    s.area = area; s.feetY = area.feetY;
    s.update(dt);
    if (s.done) { this.scene = null; this.nextAt = this.clock + this.wait(); return; }
    s.draw(ctx, env, env.off || 0);
  }
}
