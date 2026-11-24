import { clamp } from './utils.js';
import { buildSprite } from './sprites.js';

// Franja animada de la pantalla del título (SOLO `menu.screen === 'title'`): micro-escenas con personajes y elementos propios de NEON RUSH (JACK, VEX, mafiosos, corredores, pesados, blindados, la
// moto, el cocodrilo, la rata y la moneda con el ave) que cruzan la calle de abajo, por DETRÁS del panel de opciones y los textos. Decorado puro: no recibe ni bloquea clics ni toques.
//  - `stripArea`: área útil según la colocación real del título. `StripDirector`: ritmo, memoria y sorteo. `MicroScene` + `SCENES`: las 6 escenas.
//  - Sprites LATERALES de cuerpo entero (los del juego son cenitales) generados como cuadrículas de texto con contorno de 1 px y horneados UNA vez con `buildSprite` (sprites.js).
//  - Dibujar no asigna objetos por fotograma: solo `drawImage`, `fillRect` y cuentas. Con `fx.lite` no hay reflejos, halos, haz del faro ni humo; con `strobeEnabled` apagado el golpe del escudo no destella en blanco.

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

// --- Sprites laterales -----------------------------------------------------------------------------------------------------------------------------------------------------------------
// Cuadrícula de texto → contorno oscuro automático → `buildSprite`. Todos miran a +X (a la derecha); a la izquierda se voltean al dibujar. La fila inferior es el contorno bajo los pies (= el suelo).
const FW = 20, FH = 16;
const mk = (w = FW, h = FH) => Array.from({ length: h }, () => Array(w).fill('.'));
const put = (G, x, y, c) => { if (y >= 0 && y < G.length && x >= 0 && x < G[0].length) G[y][x] = c; };
const box = (G, x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(G, x + i, y + j, c); };
function finish(G) {
  const H = G.length, W = G[0].length, out = G.map((r) => r.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (G[y][x] !== '.') continue;
    if ((y > 0 && G[y - 1][x] !== '.') || (y < H - 1 && G[y + 1][x] !== '.') || (x > 0 && G[y][x - 1] !== '.') || (x < W - 1 && G[y][x + 1] !== '.')) out[y][x] = 'k';
  }
  return out.map((r) => r.join(''));
}

const BASE = { k: '#05010f', s: '#f1b48a', S: '#c27a5a', e: '#140a24', w: '#fff6d6', z: '#c9c3e6', Z: '#7a7499', y: '#ffbe0b', W: '#a8723a', f: '#12101c', a: '#2b2f4a', A: '#1a1c30', q: '#ff4fa3', p: '#7a2f8f', P: '#4d1a63', x: '#ff2e55', X: '#ffbe0b', t: '#05d9e8', T: '#037f8c', l: '#9ff6ff', h: '#efe6d0', H: '#b9ad90', g: '#fff8e6', n: '#6a5a4a', N: '#4a3c30', m: '#6a1a2a', G: '#2a7a3a', r: '#ffe44d' };
const KINDS = {
  jack:   { head: 'mask', tw: 6, bx: 7, sleeve: 't', pal: {} },
  vex:    { head: 'mask', tw: 6, bx: 7, sleeve: 't', vex: true, pal: {} },
  grunt:  { head: 'cap', tw: 6, bx: 7, sleeve: 't', pal: { t: '#ffbe0b', T: '#b38600', l: '#ffe08a', h: '#4b2a7a', H: '#2e1850', g: '#6a45a3', a: '#3a2f4a', A: '#241c30' } },
  runner: { head: 'cap', tw: 5, bx: 7, sleeve: 't', pal: { t: '#ff4fa3', T: '#a31f66', l: '#ffc2e0', h: '#05d9e8', H: '#037f8c', g: '#9ff6ff', a: '#2a2a45' } },
  heavy:  { head: 'bald', tw: 8, bx: 6, sleeve: 'z', gun: true, pal: { t: '#8a1c2b', T: '#4a0f18', l: '#b8344a', h: '#3a2a2a', H: '#241818', a: '#2a2a3a', A: '#1a1a26' } },
  shield: { head: 'helm', tw: 6, bx: 7, sleeve: 'z', plate: true, pal: { t: '#3d4f66', T: '#202b38', l: '#8fa3ba', h: '#3d4f66', H: '#202b38', g: '#8fa3ba', z: '#8fa3ba', Z: '#566a82', a: '#202b38', A: '#10161d' } },
};
const POSES = {
  stand: { lean: 0, bob: 0, legs: 'stand', near: 'idle', far: 'idle' },
  walk0: { lean: 0, bob: 0, legs: 'walk0', near: 'swingF', far: 'swingB' },
  walk1: { lean: 0, bob: 0, legs: 'walk1', near: 'swingB', far: 'swingF' },
  run0:  { lean: 2, bob: 0, legs: 'run0', near: 'run', far: 'runB' },
  run1:  { lean: 2, bob: -1, legs: 'run1', near: 'runB', far: 'run' },
  punch: { lean: 1, bob: 0, legs: 'stand', near: 'punch', far: 'guard' },
  fist:  { lean: 0, bob: 0, legs: 'stand', near: 'fist', far: 'idle' },
  hit:   { lean: -2, bob: 0, legs: 'stand', near: 'recoil', far: 'recoilF' },
  down:  { lying: true },
  sit0:  { sit: true, sway: -1 },
  sit1:  { sit: true, sway: 1 },
};
const ARMS = {
  idle: [[0, 1], [0, 2], [0, 3]], swingF: [[1, 1], [2, 2], [3, 2]], swingB: [[-1, 1], [-2, 2], [-3, 3]],
  run: [[1, 0], [2, -1], [3, -1]], runB: [[-1, 1], [-2, 2], [-3, 1]],
  punch: [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [5, 1]], guard: [[0, 1], [1, 2], [2, 2]],
  fist: [[1, -1], [2, -2], [2, -3], [2, -4], [3, -4]], recoil: [[-1, -1], [-2, -2], [-3, -2]], recoilF: [[0, -1], [-1, -2], [-1, -3]],
};
const LEGS = (tw) => ({
  stand: [[1, 3, [0, 0, 0]], [tw - 3, 3, [0, 0, 0]]], walk0: [[1, 3, [0, -1, -1]], [tw - 3, 3, [0, 1, 1]]], walk1: [[1, 3, [0, 1, 1]], [tw - 3, 3, [0, -1, -1]]],
  run0: [[1, 2, [-1, -2]], [tw - 3, 3, [1, 2, 3]]], run1: [[1, 3, [0, 0, 0]], [tw - 3, 2, [1, 2]]],
});

function arm(G, cells, ax, ay, sleeve) {
  const hands = cells.length >= 5 ? 2 : 1;
  cells.forEach(([dx, dy], i) => put(G, ax + dx, ay + dy, i >= cells.length - hands ? 's' : sleeve));
}
function head(G, k, x0, y0, vex) {
  if (k.head === 'mask') {                                  // máscara de gallo: cresta roja, ojo, pico ámbar
    box(G, x0 + 1, y0, 3, 1, 'x'); box(G, x0, y0 + 1, 5, 2, 'h'); put(G, x0 + 3, y0 + 1, 'e'); put(G, x0 + 1, y0 + 1, 'g');
    put(G, x0 + 4, y0 + 2, 'X'); put(G, x0 + 5, y0 + 2, 'X'); box(G, x0 + 1, y0 + 3, 4, 1, 'H');
    if (vex) { put(G, x0 - 1, y0 + 1, 'q'); put(G, x0 - 2, y0 + 2, 'p'); put(G, x0 - 2, y0 + 3, 'P'); put(G, x0 - 3, y0 + 3, 'P'); }
  } else if (k.head === 'cap') {                            // gorra con visera
    box(G, x0 + 1, y0, 4, 1, 'h'); put(G, x0 + 2, y0, 'g'); box(G, x0, y0 + 1, 5, 1, 'h'); put(G, x0 + 5, y0 + 1, 'H');
    box(G, x0 + 1, y0 + 2, 4, 1, 's'); put(G, x0 + 3, y0 + 2, 'e'); box(G, x0 + 1, y0 + 3, 4, 1, 'S');
  } else if (k.head === 'bald') {                           // pesado: cabeza rapada, ceño y barba
    box(G, x0 + 1, y0, 4, 1, 's'); box(G, x0, y0 + 1, 5, 1, 's'); put(G, x0 + 3, y0 + 1, 'h'); put(G, x0 + 4, y0 + 1, 'h');
    box(G, x0, y0 + 2, 5, 1, 's'); put(G, x0 + 3, y0 + 2, 'e'); box(G, x0, y0 + 3, 5, 1, 'h');
  } else {                                                  // blindado: casco de acero con visor ámbar
    box(G, x0 + 1, y0, 4, 1, 'h'); box(G, x0, y0 + 1, 6, 1, 'h'); put(G, x0 + 2, y0 + 1, 'g');
    box(G, x0, y0 + 2, 3, 1, 'h'); box(G, x0 + 3, y0 + 2, 3, 1, 'X'); box(G, x0 + 1, y0 + 3, 4, 1, 'H');
  }
}
function figure(k, pose) {
  const G = mk(), P = POSES[pose], tw = k.tw, bx = k.bx;
  if (P.lying) {                                            // tumbado de lado, la cabeza a la derecha
    box(G, 2, 13, 5, 2, 'a'); box(G, 1, 13, 2, 2, 'f'); box(G, 7, 12, 5, 3, 't'); box(G, 7, 14, 5, 1, 'T'); box(G, 8, 12, 3, 1, 'l');
    if (k.head === 'mask') { box(G, 12, 12, 4, 3, 'h'); put(G, 15, 13, 'X'); put(G, 14, 12, 'e'); box(G, 12, 12, 2, 1, 'x'); if (k.vex) { put(G, 11, 13, 'p'); put(G, 10, 14, 'P'); } }
    else if (k.head === 'cap') { box(G, 12, 12, 4, 3, 's'); box(G, 12, 12, 3, 1, 'h'); put(G, 15, 12, 'H'); put(G, 14, 13, 'e'); }
    else if (k.head === 'bald') { box(G, 12, 12, 4, 3, 's'); put(G, 14, 13, 'e'); box(G, 12, 14, 4, 1, 'h'); }
    else { box(G, 12, 12, 4, 3, 'h'); box(G, 14, 13, 2, 1, 'X'); box(G, 12, 14, 4, 1, 'H'); }
    if (k.plate) { box(G, 14, 13, 6, 2, 'z'); box(G, 14, 14, 6, 1, 'Z'); put(G, 16, 13, 'y'); put(G, 17, 13, 'y'); }
    if (k.gun) { box(G, 11, 11, 7, 1, 'W'); box(G, 14, 11, 5, 1, 'z'); }
    return finish(G);
  }
  if (P.sit) {                                              // sentado, aturdido: piernas estiradas, una mano a la cabeza
    box(G, bx, 8, tw, 4, 't'); box(G, bx, 8, 1, 4, 'T'); box(G, bx, 8, tw, 1, 'l');
    box(G, bx + 2, 12, tw + 4, 1, 'a'); box(G, bx + 2, 13, tw + 4, 1, 'A'); box(G, bx + tw + 3, 12, 3, 2, 'f');
    head(G, k, bx + 1 + P.sway, 4, k.vex);
    arm(G, [[1, 1], [2, 2], [3, 2]], bx + tw - 2, 9, k.sleeve); arm(G, [[-1, -1], [-1, -2]], bx + 1, 9, k.sleeve);
    return finish(G);
  }
  const lean = P.lean, bob = P.bob, sh = (y) => Math.round(lean * (10 - y) / 5);
  if (!k.plate) arm(G, ARMS[P.far], bx + sh(6) + 1, 6 + bob, k.sleeve);            // brazo lejano (detrás del torso)
  const lg = LEGS(tw)[P.legs];
  lg.forEach(([dx, len, off], i) => {
    for (let r = 0; r < len; r++) box(G, bx + dx + off[r], 11 + r, 2, 1, i === 0 ? 'A' : 'a');
    box(G, bx + dx + off[len - 1], 11 + len, 3, 1, 'f');
  });
  for (let y = 5 + bob; y <= 9; y++) {                                              // torso (más inclinado cuanto más arriba)
    const x = bx + sh(y);
    box(G, x, y, tw, 1, 't'); put(G, x, y, 'T'); if (y === 5 + bob) box(G, x + 1, y, tw - 1, 1, 'l');
    if (k.vex && y === 8) box(G, x + 1, y, tw - 2, 1, 'q');
  }
  box(G, bx + sh(10), 10, tw, 1, 'a');
  head(G, k, bx + 1 + lean, 1 + bob, k.vex);
  if (k.plate) {                                                                   // escudo frontal de acero con franja amarilla
    const px = bx + tw + 1 + Math.min(0, lean);
    box(G, px, 3, 3, 11, 'z'); box(G, px, 3, 1, 11, 'l'); box(G, px + 2, 3, 1, 11, 'Z'); box(G, px, 7, 3, 2, 'y'); box(G, px, 3, 3, 1, 'Z');
  } else {
    arm(G, ARMS[P.near], bx + sh(6) + tw - 2, 6 + bob, k.sleeve);                  // brazo cercano (delante)
    if (k.gun && (pose === 'stand' || pose === 'walk0' || pose === 'walk1')) { const gx = bx + tw - 3, gy = 8; box(G, gx, gy, 3, 2, 'W'); box(G, gx + 3, gy, 7, 1, 'z'); box(G, gx + 3, gy + 1, 7, 1, 'Z'); }
  }
  return finish(G);
}

function bikeRows(spin) {                                                           // moto de lado con su piloto agachado; 32×16
  const G = mk(32, 16);
  const wheel = (x0) => ['..fff..', '.fNNNf.', 'fNNzNNf', spin ? 'fNzZzNf' : 'fNzzzNf', spin ? 'fNNzNNf' : 'fNNNNNf', '.fNNNf.', '..fff..'].forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') put(G, x0 + i, 8 + j, c); }));
  wheel(1); wheel(24);
  box(G, 8, 11, 9, 2, 'Z'); box(G, 10, 9, 6, 3, 'z'); box(G, 10, 11, 6, 1, 'Z'); box(G, 7, 13, 7, 1, 'z');   // chasis, motor y escape
  box(G, 6, 8, 8, 2, 'A');                                                                                   // asiento
  box(G, 13, 6, 6, 3, 't'); box(G, 13, 6, 6, 1, 'l'); box(G, 19, 7, 5, 3, 't'); box(G, 19, 7, 5, 1, 'l');   // depósito y carenado neón
  for (let i = 0; i < 6; i++) put(G, 21 + i, 6 + i, 'Z');                                                    // horquilla
  box(G, 24, 8, 2, 2, 'w'); put(G, 26, 8, 'y');                                                              // faro
  box(G, 8, 7, 4, 1, 't'); box(G, 9, 6, 4, 1, 't'); box(G, 10, 5, 4, 1, 't'); box(G, 11, 4, 4, 1, 't'); box(G, 11, 7, 1, 1, 'T');   // torso inclinado
  box(G, 14, 5, 8, 1, 'T'); put(G, 22, 5, 's');                                                              // brazo al manillar
  box(G, 9, 8, 2, 1, 'a'); box(G, 10, 9, 2, 1, 'a'); box(G, 11, 10, 2, 1, 'a'); box(G, 12, 11, 2, 1, 'f');  // pierna
  box(G, 15, 1, 5, 1, 'h'); box(G, 15, 2, 5, 2, 'h'); box(G, 16, 0, 3, 1, 'x'); put(G, 18, 2, 'e'); put(G, 20, 3, 'X'); put(G, 19, 3, 'X'); box(G, 16, 4, 4, 1, 'H'); // cabeza enmascarada
  return finish(G);
}
function lampRows() {
  const G = mk(12, 30);
  box(G, 5, 6, 2, 22, 'Z'); box(G, 5, 6, 1, 22, 'z'); box(G, 3, 28, 6, 1, 'Z');
  box(G, 5, 4, 6, 2, 'Z'); box(G, 7, 6, 4, 1, 'Z'); box(G, 8, 7, 3, 1, 'w'); box(G, 8, 5, 3, 1, 'z');
  return finish(G);
}
function crocRows(open) {                                                           // cabeza de cocodrilo de lado asomando de la alcantarilla; 20×12
  const G = mk(20, 11), o = open ? 0 : 2;                                         // cerrada: todo 2 filas más abajo, para que la mandíbula apoye siempre en el suelo
  box(G, 4, 3 + o, 13, 3, 'g'); box(G, 17, 4 + o, 2, 2, 'g'); box(G, 4, 3 + o, 13, 1, 'l');
  box(G, 5, 1 + o, 3, 2, 'g'); box(G, 10, 1 + o, 3, 2, 'g'); put(G, 6, 2 + o, 'r'); put(G, 11, 2 + o, 'r'); put(G, 7, 2 + o, 'e'); put(G, 12, 2 + o, 'e');
  if (!open) { box(G, 4, 6 + o, 14, 2, 'G'); for (let x = 7; x <= 16; x += 3) put(G, x, 6 + o, 'w'); put(G, 18, 6 + o, 'e'); }
  else { box(G, 5, 6, 13, 2, 'm'); box(G, 4, 8, 14, 2, 'G'); for (let x = 7; x <= 16; x += 3) { put(G, x, 6, 'w'); put(G, x + 1, 7, 'w'); } }
  return finish(G);
}
const RAT = (frame) => { const G = mk(12, 8); box(G, 2, 3, 6, 3, 'n'); box(G, 2, 5, 6, 1, 'N'); box(G, frame === 2 ? 8 : 8, frame === 2 ? 5 : 3, 3, 2, 'n'); put(G, frame === 2 ? 10 : 10, frame === 2 ? 6 : 4, 'q'); put(G, 7, frame === 2 ? 3 : 2, 'q'); put(G, 0, 4, 'q'); put(G, 1, 5, 'q'); put(G, 3, frame === 1 ? 7 : 6, 'N'); put(G, 6, frame === 1 ? 6 : 7, 'N'); put(G, 9, frame === 2 ? 5 : 3, 'e'); return finish(G); };
const COIN = ['..kkk..', '.kyyyk.', 'kyeyeyk', 'kyyeyyk', 'kyyyyyk', '.kyyyk.', '..kkk..'].map((r) => r.replace(/e/g, 'W'));   // moneda con la «v» del ave
const LID = ['.kkkkkkkkkkkk.', 'kzzZzzzZzzzZzk', '.kZZZZZZZZZZk.'];

let SPR = null;
export function buildStripSprites() {
  const S = {};
  for (const [name, k] of Object.entries(KINDS)) {
    const pal = { ...BASE, ...k.pal }; S[name] = {};
    for (const pose of Object.keys(POSES)) S[name][pose] = buildSprite(figure(k, pose), pal);
  }
  S.bike = [buildSprite(bikeRows(false), BASE), buildSprite(bikeRows(true), BASE)];
  S.lamp = buildSprite(lampRows(), BASE);
  const CROC = { ...BASE, g: '#4fbf4a', l: '#a8f08a' };   // verde de cocodrilo (en BASE `g` es el crema de la máscara)
  S.croc = [buildSprite(crocRows(false), CROC), buildSprite(crocRows(true), CROC)];
  S.rat = [buildSprite(RAT(0), BASE), buildSprite(RAT(1), BASE), buildSprite(RAT(2), BASE)];
  S.coin = buildSprite(COIN, BASE);
  S.lid = buildSprite(LID, BASE);
  return S;
}
const spr = () => SPR || (SPR = buildStripSprites());
// Hoja con todos los sprites (para revisarlos a ojo en desarrollo).
export function spriteSheet(scale = 3) {
  const S = spr(), items = [];
  for (const k of Object.keys(KINDS)) for (const p of Object.keys(POSES)) items.push(S[k][p]);
  items.push(...S.bike, S.lamp, ...S.croc, ...S.rat, S.coin, S.lid);
  const cols = 11, cw = 36, ch = 20, c = document.createElement('canvas');
  c.width = cols * cw * scale; c.height = Math.ceil(items.length / cols) * ch * scale;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.fillStyle = '#2a1850'; x.fillRect(0, 0, c.width, c.height);
  items.forEach((im, i) => x.drawImage(im, (i % cols) * cw * scale, Math.floor(i / cols) * ch * scale, im.width * scale, im.height * scale));
  return c;
}

// --- Dibujo ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Sprite con el pie en (cx, feetY), mirando a `face`, con su reflejo en el suelo mojado (sin él con `fx.lite`).
function blit(ctx, img, cx, feetY, face, env, alpha = 1) {
  const w = img.width, h = img.height;
  ctx.save();
  try {
    ctx.translate(Math.round(cx), Math.round(feetY));
    if (face < 0) ctx.scale(-1, 1);
    if (alpha !== 1) ctx.globalAlpha *= alpha;
    ctx.drawImage(img, -(w >> 1), -(h - 1));
    if (!env.lite) { ctx.globalAlpha *= 0.16; ctx.scale(1, -1); ctx.drawImage(img, -(w >> 1), -(h + 1)); }
  } finally { ctx.restore(); }   // siempre equilibrado, aunque `drawImage` lance (p. ej. un bitmap roto)
}
const NOREF = { lite: true };   // sin reflejo (la cabeza del cocodrilo sale recortada por el borde de la alcantarilla)
const fr = (t, rate) => Math.floor(t * rate) & 1;
const runP = (t, rate = 11) => (fr(t, rate) ? 'run1' : 'run0');
const walkP = (t, rate = 5) => (fr(t, rate) ? 'walk1' : 'walk0');
// Chispas del golpe: cuatro píxeles que salen en cruz. Blancas SOLO con las luces estroboscópicas activadas; si no, ámbar.
function burst(ctx, env, x, y, age, c) {
  if (age < 0 || age > 0.3) return;
  ctx.fillStyle = c || (env.strobe ? '#ffffff' : '#ffbe0b');
  ctx.globalAlpha = 1 - age / 0.3;
  const r = 2 + age * 36;
  for (let i = 0; i < 4; i++) { const a = i * 1.5708 + 0.6; ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 2, 2); }
  ctx.globalAlpha = 1;
}
function dust(ctx, env, x, y, age) {
  if (env.lite || age < 0 || age > 0.5) return;
  ctx.fillStyle = '#8a7aa8'; ctx.globalAlpha = 0.5 * (1 - age / 0.5);
  for (let i = 0; i < 3; i++) ctx.fillRect(Math.round(x - 3 - i * 4 - age * 10), Math.round(y - 2 - i - age * 4), 2, 2);
  ctx.globalAlpha = 1;
}
function stars(ctx, x, y, t) {                                                         // estrellitas de aturdimiento sobre la cabeza
  ctx.fillStyle = '#ffe44d';
  for (let i = 0; i < 3; i++) ctx.fillRect(Math.round(x + Math.cos(t * 6 + i * 2.1) * 6), Math.round(y + Math.sin(t * 6 + i * 2.1) * 2), 1, 1);
}
function lamp(ctx, x, feetY, env) {
  if (!env.lite) {
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#9ff6ff';
      ctx.globalAlpha = 0.05; ctx.fillRect(Math.round(x) - 14, feetY - 30, 28, 10); ctx.globalAlpha = 0.04; ctx.fillRect(Math.round(x) - 9, feetY - 26, 18, 24);
      ctx.globalAlpha = 0.09; ctx.fillRect(Math.round(x) - 18, feetY - 1, 36, 2);
    } finally { ctx.restore(); }
  }
  blit(ctx, spr().lamp, x + 2, feetY, 1, env);
}

// Escenas. Cada `init(S, rnd)` fija `S.dur` y sus tiempos a partir del ancho del carril; `draw(ctx, S, env)` pinta según `S.t`. `s` = distancia recorrida desde el borde de entrada (0..W); `S.X(s)` la pasa a pantalla.
export const SCENES = [
  { id: 'persecucion', weight: STRIP.COMMON, minW: 100, // un corredor persigue a un agente, pasan junto a una farola; el agente se gira y levanta el puño y el corredor huye
    init(S, rnd) {
      const W = S.W, vr = 118 * S.k;
      S.ag = rnd() < 0.5 ? 'jack' : 'vex'; S.vr = vr; S.sp = 0.64 * W; S.lampS = 0.32 * W;
      S.tA = S.sp / vr; S.tR = (S.sp + 4) / vr; S.flee = 1.15 * vr; S.tF = S.tR + 0.6; S.tB = S.tA + 1.6;
      S.dur = Math.max(S.tB + (W + 12 - S.sp) / vr, S.tF + (S.sp - 16) / S.flee) + 0.2;
    },
    draw(ctx, S, env) {
      const t = S.t, fy = S.feetY, d = S.dir, A = spr()[S.ag], R = spr().runner;
      lamp(ctx, S.X(S.lampS), fy, env);
      if (t < S.tR) blit(ctx, R[runP(t)], S.X(S.vr * t - 34), fy, d, env);
      else if (t < S.tF) { const x = S.X(S.sp - 30 + (t - S.tR > 0.2 && fr(t, 28) ? 1 : 0)); dust(ctx, env, x, fy, t - S.tR); blit(ctx, R.stand, x, fy, d, env); }
      else blit(ctx, R[runP(t, 13)], S.X(S.sp - 30 - S.flee * (t - S.tF)), fy, -d, env);
      if (t < S.tA) blit(ctx, A[runP(t)], S.X(S.vr * t), fy, d, env);
      else if (t < S.tA + 0.18) blit(ctx, A.stand, S.X(S.sp), fy, d, env);
      else if (t < S.tA + 0.3) blit(ctx, A.stand, S.X(S.sp), fy, -d, env);
      else if (t < S.tB) blit(ctx, A.fist, S.X(S.sp), fy, -d, env);
      else blit(ctx, A[runP(t)], S.X(S.sp + S.vr * (t - S.tB)), fy, d, env);
    } },

  { id: 'patrulla', weight: STRIP.COMMON, minW: 100, fade: true, // un mafioso patrulla; un agente llega por detrás, lo deja tumbado y sigue andando mientras el otro se levanta aturdido
    init(S, rnd) {
      const W = S.W, ve = 40 * S.k, va = 125 * S.k;
      S.ag = rnd() < 0.5 ? 'jack' : 'vex'; S.vic = rnd() < 0.5 ? 'grunt' : 'heavy'; S.ve = ve; S.va = va; S.sh = 0.38 * W;
      S.tk = (S.sh + 8) / ve; S.t0 = Math.max(0, S.tk - (S.sh - 16 + 30) / va); S.wk = 60 * S.k;
      S.dur = S.tk + 0.4 + (W + 12 - (S.sh - 16)) / S.wk + 0.3;
    },
    draw(ctx, S, env) {
      const t = S.t, fy = S.feetY, d = S.dir, A = spr()[S.ag], V = spr()[S.vic], sh = S.sh, tk = S.tk, dt = t - tk;
      // víctima
      if (dt < 0) blit(ctx, V[walkP(t, 4)], S.X(-8 + S.ve * t), fy, d, env);
      else if (dt < 0.06) blit(ctx, V.walk0, S.X(sh), fy, d, env);
      else if (dt < 0.2) blit(ctx, V.hit, S.X(sh + 2), fy, d, env);
      else if (dt < 1.6) blit(ctx, V.down, S.X(sh + 6), fy, d, env);
      else if (dt < 3.2) { const x = S.X(sh + 6); blit(ctx, V[fr(t, 2) ? 'sit1' : 'sit0'], x, fy, d, env); stars(ctx, x, fy - 19, t); }
      else blit(ctx, V.stand, S.X(sh + 6), fy, d, env);
      if (dt > 0 && dt < 0.3) burst(ctx, env, S.X(sh - 4), fy - 9, dt, '#ffe08a');
      // agente
      if (t < S.t0) return;
      if (dt < 0) blit(ctx, A[runP(t)], S.X(-30 + S.va * (t - S.t0)), fy, d, env);
      else if (dt < 0.4) blit(ctx, A.punch, S.X(sh - 16), fy, d, env);
      else blit(ctx, A[walkP(t, 7)], S.X(sh - 16 + S.wk * (dt - 0.4)), fy, d, env);
    } },

  { id: 'moto', weight: STRIP.COMMON, minW: 70, // la moto cruza el carril con el faro encendido y su reflejo en el asfalto
    init(S) { S.vm = 190 * S.k; S.dur = (S.W + 40) / S.vm + 0.2; },
    draw(ctx, S, env) {
      const t = S.t, fy = S.feetY, d = S.dir, s = S.vm * t - 18, x = S.X(s);
      if (!env.lite) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#ffe9a8';
        for (let i = 0; i < 6; i++) { ctx.globalAlpha = 0.1 * (1 - i / 6); ctx.fillRect(Math.round(x + d * (18 + i * 9)) - (d < 0 ? 9 : 0), fy - 8 - i, 9, 2 + i * 2); }
        ctx.restore();
        ctx.fillStyle = '#8a7aa8';                                                  // humo del escape
        for (let i = 0; i < 4; i++) { ctx.globalAlpha = 0.35 * (1 - i / 4); ctx.fillRect(Math.round(x - d * (16 + i * 7)), Math.round(fy - 5 - Math.sin(t * 9 + i) * 1.5 - i * 0.6), 2, 2); }
        ctx.globalAlpha = 1;
      } else { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(Math.round(x + d * 18) - (d < 0 ? 3 : 0), fy - 8, 3, 1); }
      blit(ctx, spr().bike[fr(t, 14)], x, fy, d, env);
    } },

  { id: 'escudo', weight: STRIP.COMMON, minW: 110, fade: true, // un blindado avanza; un agente le pega de frente (rebota), lo rodea por detrás y lo derriba
    init(S, rnd) {
      const W = S.W, vb = 22 * S.k, va = 120 * S.k;
      S.ag = rnd() < 0.5 ? 'jack' : 'vex'; S.vb = vb; S.va = va;
      S.tc = (W + 4) / (va + vb); S.sb = -16 + vb * S.tc;                         // choque: el blindado se para en `sb`
      S.tr = S.tc + 0.9; S.tCirc = 64 / (va * 1.05);                               // rodeo por la fila de atrás
      S.tk = S.tr + S.tCirc + 0.2; S.wk = 100 * S.k;                               // golpe por la espalda
      S.dur = S.tk + 0.45 + (W + 12 - (S.sb - 22)) / S.wk + 0.3;
    },
    draw(ctx, S, env) {
      const t = S.t, fy = S.feetY, d = S.dir, A = spr()[S.ag], B = spr().shield, tc = S.tc, sb = S.sb;
      const back = t >= S.tr && t < S.tk + 0.45 ? -5 : 0, dc = t - tc;
      // agente en la fila de atrás (se dibuja antes que el blindado)
      if (t >= S.tr && t < S.tr + S.tCirc) { const u = (t - S.tr) / S.tCirc; blit(ctx, A[runP(t, 13)], S.X(sb + 38 - 64 * u), fy + back, -d, env); }
      else if (t >= S.tk + 0.45) blit(ctx, A[walkP(t, 8)], S.X(sb - 22 + S.wk * (t - S.tk - 0.45)), fy - 4, d, env);
      // blindado
      if (t < tc) blit(ctx, B[walkP(t, 3)], S.X(-16 + S.vb * t), fy, d, env);
      else if (t < S.tk) blit(ctx, B.stand, S.X(sb) + (dc < 0.25 ? (fr(t, 30) ? 1 : -1) : 0), fy, d, env);
      else blit(ctx, B.down, S.X(sb + 4), fy, d, env);
      // agente de frente: choque con rebote
      if (t >= tc && t < S.tr) {
        const e = 14 * (1 - Math.exp(-dc * 14)), x = S.X(sb + 24 + e);
        blit(ctx, dc < 0.3 ? A.hit : A.stand, x, fy, -d, env);
        burst(ctx, env, S.X(sb + 12), fy - 9, dc);
      } else if (t < tc) blit(ctx, A[runP(t, 13)], S.X(S.W + 12 - S.va * t), fy, -d, env);
      else if (t >= S.tr + S.tCirc && t < S.tk) blit(ctx, A.stand, S.X(sb - 22), fy, d, env);
      else if (t >= S.tk && t < S.tk + 0.45) {
        blit(ctx, A.punch, S.X(sb - 22 + 8), fy, d, env);
        burst(ctx, env, S.X(sb - 6), fy - 9, t - S.tk);
      }
    } },

  { id: 'cruce', weight: STRIP.COMMON, minW: 100, // JACK y VEX se cruzan en sentidos opuestos, se paran, chocan los puños y siguen
    init(S) {
      const W = S.W, vw = 52 * S.k; S.vw = vw; S.tm = (W - 2) / (2 * vw); S.hold = 0.35; S.bump = 0.5;
      S.sj = -12 + vw * S.tm; S.dur = S.tm + S.hold + S.bump + (W + 12 - S.sj) / vw + 0.2;
    },
    draw(ctx, S, env) {
      const t = S.t, fy = S.feetY, d = S.dir, J = spr().jack, V = spr().vex, W = S.W, vw = S.vw, tm = S.tm;
      const e1 = tm + S.hold, e2 = e1 + S.bump, sv = W + 12 - vw * tm;
      // VEX por la fila de atrás al cruzarse
      let vs, vp, vy = 0;
      if (t < tm) { vs = W + 12 - vw * t; vp = walkP(t, 6); }
      else if (t < e1) { vs = sv; vp = 'stand'; }
      else if (t < e2) { vs = sv; vp = 'punch'; }
      else { vs = sv - vw * (t - e2); vp = walkP(t, 6); vy = -5; }
      let js, jp;
      if (t < tm) { js = -12 + vw * t; jp = walkP(t, 6); }
      else if (t < e1) { js = S.sj; jp = 'stand'; }
      else if (t < e2) { js = S.sj; jp = 'punch'; }
      else { js = S.sj + vw * (t - e2); jp = walkP(t, 6); }
      blit(ctx, V[vp], S.X(vs), fy + vy, -d, env);
      blit(ctx, J[jp], S.X(js), fy, d, env);
      if (t > e1 + 0.1 && t < e2) { burst(ctx, env, S.X((js + vs) / 2), fy - 9, t - e1 - 0.1, '#05d9e8'); burst(ctx, env, S.X((js + vs) / 2), fy - 9, t - e1 - 0.1, '#ff2a85'); }
    } },

  { id: 'rara', weight: STRIP.RARE, minW: 70, fade: true, // rara: el cocodrilo asoma de una alcantarilla de la calle, o una rata olfatea una moneda con el ave sin recogerla
    init(S, rnd) {
      S.v = rnd() < 0.5 ? 0 : 1;
      if (S.v === 0) S.dur = 5.4;
      else { S.vr1 = 85 * S.k; S.vr2 = 130 * S.k; S.stopS = 0.5 * S.W - 14; S.t1 = (S.stopS + 6) / S.vr1; S.t2 = S.t1 + 1.1; S.dur = S.t2 + (S.W + 12 - S.stopS) / S.vr2 + 0.2; }
    },
    draw(ctx, S, env) {
      const t = S.t, fy = S.feetY, d = S.dir, x = Math.round(S.X(0.5 * S.W)), K = spr();
      if (S.v === 0) {                                                             // cocodrilo
        const slide = clamp(t / 0.5, 0, 1) - clamp((t - 4.8) / 0.5, 0, 1), rise = clamp((t - 0.5) / 0.5, 0, 1) - clamp((t - 3.9) / 0.5, 0, 1);
        ctx.fillStyle = '#05010f'; ctx.fillRect(x - 8, fy - 1, 16, 2);
        if (rise > 0) {
          ctx.save();
          try {
            ctx.beginPath(); ctx.rect(x - 14, fy - 16, 28, 16); ctx.clip();
            const open = t > 1.2 && t < 3.6 && Math.sin(t * 2.2) > 0.4;
            blit(ctx, K.croc[open ? 1 : 0], x, fy + 11 - Math.round(rise * 11), d, NOREF);
          } finally { ctx.restore(); }
        }
        ctx.drawImage(K.lid, x - 7 + Math.round(slide * 10 * d), fy - 2);
        return;
      }
      ctx.fillStyle = '#05010f'; ctx.fillRect(x - 3, fy - 1, 7, 1);                // moneda con el ave, sin recoger
      blit(ctx, K.coin, x, fy - 1, 1, env);
      if (!env.lite && fr(t, 3)) { ctx.fillStyle = '#fff6d6'; ctx.fillRect(x + 2, fy - 7, 1, 1); }
      let s, im;
      if (t < S.t1) { s = S.vr1 * t - 12; im = K.rat[fr(t, 12)]; }
      else if (t < S.t2) { s = S.stopS; im = K.rat[2]; }
      else { s = S.stopS + S.vr2 * (t - S.t2); im = K.rat[fr(t, 16)]; }
      blit(ctx, im, S.X(s), fy, d, env);
    } },
];

// Escena en curso: carril elegido, sentido y reloj propio. `X(s)` = x a lo largo del carril (entra por un borde y sale por el otro, recortada al carril).
export class MicroScene {
  constructor(def, area, rnd = Math.random) {
    this.def = def; this.t = 0; this.area = area; this.feetY = area.feetY;
    const ok = area.lanes.filter((l) => l.x1 - l.x0 >= def.minW), lane = ok[Math.floor(rnd() * ok.length)] || area.lanes[0];
    this.lane = lane; this.dir = rnd() < 0.5 ? 1 : -1;
    this.x0 = lane.x0 - 12; this.W = lane.x1 - lane.x0 + 24; this.k = clamp(this.W / 330, 0.75, 2.6);   // velocidad según el ancho del carril: la escena dura parecido en un móvil que en una pantalla ancha
    this.dur = 5; def.init(this, rnd);
  }
  X(s) { return this.dir > 0 ? this.x0 + s : this.x0 + this.W - s; }
  update(dt) { this.t += dt; }
  get done() { return this.t >= this.dur; }
  draw(ctx, env, off = 0) {
    const { x0, x1 } = this.lane, A = this.area;
    ctx.save();
    try {
      ctx.beginPath(); ctx.rect(x0, A.y0 - 30, x1 - x0, A.y1 - A.y0 + 56); ctx.clip();      // nunca fuera del carril (ni sobre el panel); incluye el reflejo
      ctx.translate(off, 0);                                                                  // parallax de la calle (par * 0.9)
      if (this.def.fade) ctx.globalAlpha = clamp((this.dur - this.t) / 0.5, 0, 1);
      this.def.draw(ctx, this, env);
    } finally { ctx.restore(); }
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

  // Escenas que caben en el área (ancho de carril ≥ `minW`), sin las últimas 3; si no queda ninguna, solo se evita repetir la última.
  pick(area) {
    const fit = SCENES.filter((s) => area.lanes.some((l) => l.x1 - l.x0 >= s.minW));
    if (!fit.length) return null;
    let pool = fit.filter((s) => !this.recent.includes(s.id));
    if (!pool.length) pool = fit.filter((s) => s.id !== this.recent[this.recent.length - 1]);
    if (!pool.length) pool = fit;
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
      const def = this.pick(area);
      if (def) { this.scene = new MicroScene(def, area, this.rnd); this.recent.push(def.id); if (this.recent.length > STRIP.MEMORY) this.recent.shift(); }
      else this.nextAt = this.clock + 1;
    }
    const s = this.scene;
    if (!s) return;
    s.area = area; s.feetY = area.feetY;
    s.update(dt);
    if (s.done) { this.scene = null; this.nextAt = this.clock + this.wait(); return; }
    s.draw(ctx, env, env.off || 0);
  }
}
