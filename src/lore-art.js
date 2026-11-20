import { drawText, measureText } from './pixelfont.js';
import { pixelRect, WORLD_PX } from './sprites.js';
import { MASKS, maskIcon } from './masks.js';

// ARTE de las viñetas y del decorado narrativo (lore.js). Todo con rectángulos, la fuente bitmap y los retratos de máscara ya existentes: sin recursos nuevos.

const AMBER = '#ffbe0b';

// --- V3 · LOS GANCHOS: una pared con seis ganchos; cinco llevan una máscara y el sexto está vacío (con la sombra de un águila, o el águila colgada si ya tienes la máscara de Rick). ---
let silhouette = null;
function eagleSilhouette() {
  if (silhouette) return silhouette;
  const m = MASKS.find((x) => x.id === 'aguila'), ic = maskIcon(m);
  const c = document.createElement('canvas');
  c.width = ic.width; c.height = ic.height;
  const x = c.getContext('2d');
  x.drawImage(ic, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#07040c'; x.fillRect(0, 0, c.width, c.height);
  silhouette = c;
  return c;
}

export function drawHooks(ctx, w, h, t, game) {
  const y0 = Math.round(h * 0.08), hh = Math.round(h * 0.5);
  ctx.fillStyle = '#17110c'; ctx.fillRect(0, y0, w, hh);
  ctx.fillStyle = '#21180f';
  for (let y = y0 + 6; y < y0 + hh; y += 8) ctx.fillRect(0, y, w, 1);
  const list = MASKS.filter((m) => !m.secret), n = 6, gap = Math.min(58, Math.floor((w - 24) / n)), x0 = Math.round(w / 2 - gap * (n - 1) / 2);
  const cs = Math.max(1, Math.min(3, Math.floor((gap - 6) / 12))), hy = y0 + 10, size = 12 * cs;
  const rick = game.settings.isMaskUnlocked && game.settings.isMaskUnlocked('aguila');
  for (let i = 0; i < n; i++) {
    const x = x0 + i * gap, sway = i < 5 || rick ? Math.round(Math.sin(t * 1.3 + i)) : 0;
    ctx.fillStyle = '#7d7d95'; ctx.fillRect(x - 1, hy, 3, 2); ctx.fillRect(x, hy + 2, 1, 2);   // gancho
    if (i < 5) {
      ctx.fillStyle = '#3a2f1a'; ctx.fillRect(x, hy + 3, 1, 7);
      ctx.drawImage(maskIcon(list[i]), x - size / 2 + sway, hy + 9, size, size);
    } else if (rick) {                                                                         // la máscara de Rick, por fin colgada
      ctx.fillStyle = '#3a2f1a'; ctx.fillRect(x, hy + 3, 1, 7);
      ctx.drawImage(maskIcon(MASKS.find((m) => m.id === 'aguila')), x - size / 2 + sway, hy + 9, size, size);
    } else {                                                                                   // gancho vacío: solo queda la sombra de un águila en la pared
      ctx.globalAlpha = 0.9; ctx.drawImage(eagleSilhouette(), x - size / 2, hy + 9, size, size); ctx.globalAlpha = 1;
    }
  }
}

// --- V5 · LA GRABACIÓN: tres monitores; dos con estática y el tercero con una grabación vieja de un agente con máscara de águila que camina hacia la cámara y se detiene mirando arriba. ---
export function drawMonitors(ctx, w, h, t) {
  const mw = Math.min(92, Math.floor((w - 40) / 3)), mh = Math.round(mw * 0.72), gap = 8, x0 = Math.round(w / 2 - (3 * mw + 2 * gap) / 2), y0 = Math.round(h * 0.16);
  for (let i = 0; i < 3; i++) {
    const x = x0 + i * (mw + gap);
    ctx.fillStyle = '#14141e'; ctx.fillRect(x - 3, y0 - 3, mw + 6, mh + 6);
    ctx.fillStyle = '#05030a'; ctx.fillRect(x, y0, mw, mh);
    if (i < 2) {                                                                               // estática
      for (let r = 0; r < mh; r += 2) {
        ctx.fillStyle = Math.random() < 0.5 ? '#4a4a5a' : '#8a8a9a';
        const sx = Math.floor(Math.random() * mw * 0.6);
        ctx.fillRect(x + sx, y0 + r, 4 + Math.floor(Math.random() * mw * 0.4), 1);
      }
    } else drawFootage(ctx, x, y0, mw, mh, t);
  }
}

function drawFootage(ctx, x, y, mw, mh, t) {
  ctx.fillStyle = '#0c241e'; ctx.fillRect(x, y, mw, mh);
  ctx.fillStyle = '#143a2f';
  for (let k = 0; k < 6; k++) ctx.fillRect(x, y + Math.round(mh * (0.55 + k * 0.08)), mw, 1);   // baldosas del suelo
  ctx.fillRect(x + Math.round(mw / 2), y + Math.round(mh * 0.5), 1, Math.round(mh * 0.5));
  const gy = y + mh - 4, cx = x + Math.round(mw / 2);
  if (t > 1.0) {
    const k = Math.min(1, Math.max(0, (t - 1.0) / 3.0)), s = (0.35 + 0.65 * k) * (mh / 50), bob = t < 4 ? Math.round(Math.sin(t * 9) * 1) : 0, up = t > 4.6;
    const R = (dx, dy, ww, hh, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(cx + dx * s), Math.round(gy + dy * s) + bob, Math.max(1, Math.round(ww * s)), Math.max(1, Math.round(hh * s))); };
    R(-4, -14, 8, 14, '#1b1f2a');                                  // cuerpo
    R(-3, -22, 6, 7, '#2b2433');                                   // cabeza (águila)
    R(-2, -20, 1, 1, '#e8e4f0'); R(1, -20, 1, 1, '#e8e4f0');      // ojos
    R(-1, up ? -23 : -18, 2, 3, '#c9971f');                        // pico: se levanta al mirar arriba
  }
  for (let g = 0; g < 14; g++) { ctx.fillStyle = Math.random() < 0.5 ? '#2a4a3f' : '#0a1a15'; ctx.fillRect(x + Math.floor(Math.random() * mw), y + Math.floor(Math.random() * mh), 2, 1); } // grano
  ctx.fillStyle = Math.floor(t * 2) % 2 ? '#ff4a4a' : '#6a1a1a'; ctx.fillRect(x + 3, y + 3, 3, 3);                                                      // REC
  drawText(ctx, 'REC', x + 8, y + 1, { color: '#ff7a7a', shadow: null });
  for (let b = 0; b < 4; b++) { ctx.fillStyle = (b + Math.floor(t * 3)) % 2 ? '#8a8a9a' : '#4a4a5a'; ctx.fillRect(x + mw - 22 + b * 5, y + 3, 4, 6); } // hora ilegible «▒▒:▒▒»
}

// --- Cuarto de servicio (pisos 3 y 10): el MISMO cuarto, cada vez más gastado. `which` = 3 | 10. Decorado sin colisión (se dibuja bajo las entidades). ---
export function roomGeom(game) {
  const R = game.ladderRoom || game.sewerRoute;
  if (!R || !R.ladder) return null;
  const tx0 = R.ladder.x - 16, ty0 = R.ladder.y - 16;
  return { tx0, ty0, radio: { x: tx0 + 22, y: ty0 + 52 } };
}

export function drawServiceRoom(ctx, game, which, now, part) { // part: 'wall' (calendario y taquillas, sobre la capa de paredes) | 'floor' (mesa, radio, termo y silla, bajo las entidades)
  const G = roomGeom(game);
  if (!G) return;
  const { tx0, ty0 } = G, late = which === 10;
  // P(x, y, w, h, color): x e y en unidades del mundo (la casilla mide 32), w y h en píxeles internos (1 px = 2 unidades).
  const P = (x, y, w, h, c) => { ctx.fillStyle = c; pixelRect(ctx, x, y, w, h); };
  if (part === 'wall' || part === undefined) {
  // Calendario (pared norte, sobre la escalera): un día tachado (piso 3) / dos tachados y un tercero rodeado a lápiz, sin nombre (piso 10).
  P(tx0 + 4, ty0 - 30, 12, 14, '#cfc9bd'); P(tx0 + 4, ty0 - 30, 12, 2, '#a8573a');
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) P(tx0 + 6 + c * 8, ty0 - 24 + r * 6, 2, 2, '#b8b0a0');
  const X = (c, r) => { for (const [a, b] of [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]]) P(tx0 + 5 + c * 8 + a * 2, ty0 - 25 + r * 6 + b * 2, 1, 1, '#d90429'); };
  X(0, 0);
  if (late) {
    X(1, 0);
    const rx = tx0 + 20, ry = ty0 - 26, ring = '#6a6a7a';                              // el tercero, rodeado a lápiz
    P(rx, ry, 4, 1, ring); P(rx, ry + 6, 4, 1, ring); P(rx, ry, 1, 4, ring); P(rx + 6, ry, 1, 4, ring);
  }
  // Taquillas (pared norte) con el rótulo «R.▒▒▒» raspado: una capa en el piso 3 y una segunda capa de raspaduras encima en el piso 10.
  for (let k = 0; k < 3; k++) {
    P(tx0 + 34 + k * 20, ty0 - 16, 9, 8, k === 1 ? '#3a4452' : '#3f4a58');
    P(tx0 + 36 + k * 20, ty0 - 14, 5, 1, '#2a323c'); P(tx0 + 36 + k * 20, ty0 - 10, 5, 1, '#2a323c');
  }
  P(tx0 + 34, ty0 - 32, 30, 8, '#cfc9bd'); P(tx0 + 34, ty0 - 32, 30, 1, '#14100a');
  drawText(ctx, 'R.', tx0 + 36, ty0 - 34, { color: '#2a2a34', scale: WORLD_PX, shadow: null });
  for (let b = 0; b < 3; b++) for (let r = 0; r < 5; r++) { P(tx0 + 62 + b * 10 + (r % 2) * 2, ty0 - 30 + r * 2, 1, 1, '#6a6a7a'); P(tx0 + 62 + b * 10 + ((r + 1) % 2) * 2, ty0 - 30 + r * 2, 1, 1, '#a89f8f'); } // ▒▒▒ a medias
  for (let s = 0; s < 8; s++) P(tx0 + 36 + s * 7, ty0 - 31 + (s % 3) * 3, 3, 1, '#a89f8f');   // raspaduras sobre el rótulo
  if (late) for (let s = 0; s < 10; s++) { P(tx0 + 37 + s * 6, ty0 - 32 + ((s * 5) % 7), 2, 1, '#5a5a6a'); P(tx0 + 40 + s * 6, ty0 - 29 + (s % 4) * 2, 1, 2, '#3a3a4a'); } // segunda capa
  }
  if (part === 'wall') return;
  // Mesa baja contra la pared sur, con la radio y el termo.
  P(tx0 + 8, ty0 + 44, 24, 10, '#14100a'); P(tx0 + 9, ty0 + 45, 22, 8, '#5b4a2a'); P(tx0 + 9, ty0 + 45, 22, 1, '#7a6538');
  P(tx0 + 12, ty0 + 47, 8, 5, '#14141e'); P(tx0 + 14, ty0 + 48, 3, 3, '#2a2a3a'); P(tx0 + 26, ty0 + 44, 1, 4, '#14141e');
  P(tx0 + 22, ty0 + 51, 2, 1, Math.floor(now * 2) % 2 ? '#ff2a4a' : '#5a1a22');            // piloto de la radio
  P(tx0 + 40, ty0 + 47, 3, 6, '#9aa3ad'); P(tx0 + 40, ty0 + 46, 3, 1, '#c0392b');            // termo
  if (late) { for (let d = 0; d < 6; d++) P(tx0 + 38 + (d * 5) % 12, ty0 + 52 - (d % 2) * 2, 1, 1, '#6a6a7a'); }  // polvo sobre el termo (frío)
  else for (let s = 0; s < 2; s++) { const ph = (now * 1.2 + s * 0.5) % 1; ctx.globalAlpha = 0.5 * (1 - ph); P(tx0 + 41 + Math.round(Math.sin(now * 3 + s)) * 2, ty0 + 42 - Math.round(ph * 14), 1, 2, '#e8e4f0'); ctx.globalAlpha = 1; } // vapor (aún tibio)
  // Silla: metida bajo la mesa (piso 3) o sacada, mirando a la puerta (piso 10).
  if (late) { P(tx0 + 58, ty0 + 30, 8, 8, '#14100a'); P(tx0 + 60, ty0 + 32, 6, 6, '#3a2f1a'); P(tx0 + 58, ty0 + 30, 2, 8, '#5b4a2a'); }
  else P(tx0 + 12, ty0 + 41, 12, 2, '#3a2f1a');
}

// --- Piso 10 · LA CALLE VACÍA: detalles de los civiles junto al barril apagado, según el karma confirmado (sin números ni explicación). `kind`: 'good' | 'bad' | 'mixed' | 'none'. ---
export function drawKarmaStreet(ctx, game, B, lid, kind, now) {
  const P = (x, y, w, h, c) => { ctx.fillStyle = c; pixelRect(ctx, x, y, w, h); };
  const good = kind === 'good', bad = kind === 'bad', mixed = kind === 'mixed';
  if (good) {                                                                      // mantas dobladas, una pila de monedas y una vela
    P(B.x - 34, B.y + 12, 12, 5, '#14100a'); P(B.x - 33, B.y + 13, 10, 3, '#6b7a4a'); P(B.x - 33, B.y + 14, 10, 1, '#8a9a5a');
    P(B.x - 34, B.y + 20, 12, 5, '#14100a'); P(B.x - 33, B.y + 21, 10, 3, '#4a6a8a');
    for (let i = 0; i < 5; i++) { P(B.x + 22, B.y + 14 - i * 2, 4, 2, '#b38600'); P(B.x + 22, B.y + 14 - i * 2, 4, 1, '#ffbe0b'); }
  }
  if (good || mixed) {
    P(B.x + 36, B.y + 8, 1, 4, '#e8e4f0');
    const f = Math.floor(now * 8) % 2;
    P(B.x + 36, B.y + 5, 1, 2 + f, f ? '#ffd166' : '#ff9a3d');
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.14; ctx.fillStyle = '#ff9a3d'; pixelRect(ctx, B.x + 32, B.y + 1, 9, 9); ctx.restore();
  }
  if (bad || mixed) {                                                              // manta quemada y un zapato suelto
    P(B.x - 34, B.y + 12, 12, 5, '#0a0806'); P(B.x - 32, B.y + 13, 3, 2, '#2a2420'); P(B.x - 27, B.y + 15, 2, 1, '#2a2420');
    P(B.x + 24, B.y + 14, 4, 2, '#3a2f1a'); P(B.x + 24, B.y + 16, 4, 1, '#14100a'); P(B.x + 29, B.y + 13, 1, 1, '#3a2f1a');
  }
  if (lid && (good || bad || mixed)) {                                             // moneda junto a la tapa: de canto (bien) o boca abajo y sin brillo (mal)
    if (good) { P(lid.x + 22, lid.y + 6, 1, 4, '#ffd166'); P(lid.x + 23, lid.y + 6, 1, 4, '#a8741a'); }
    else { P(lid.x + 22, lid.y + 8, 4, 3, '#14100a'); P(lid.x + 23, lid.y + 8, 2, 2, '#5a4300'); }
  }
}

// Moneda rayada con la silueta de un ave (también se usa en el asiento de la moto): 5×5 px con una «v» oscura. `glint` 0..1: destello.
export function drawBirdCoin(ctx, x, y, glint = 0) {
  const P = (ox, oy, w, h, c) => { ctx.fillStyle = c; pixelRect(ctx, x + ox * WORLD_PX, y + oy * WORLD_PX, w, h); };
  P(-3, -3, 5, 5, '#140a24'); P(-2, -2, 3, 3, '#ffbe0b'); P(-2, -2, 1, 1, '#fff6c8');
  P(-2, -1, 1, 1, '#7a5300'); P(0, -1, 1, 1, '#7a5300'); P(-1, 0, 1, 1, '#7a5300');
  if (glint > 0) { ctx.save(); ctx.globalAlpha = glint; ctx.fillStyle = '#ffffff'; pixelRect(ctx, x - 1, y - 7, 1, 3); pixelRect(ctx, x - 1, y + 4, 1, 3); pixelRect(ctx, x - 7, y - 1, 3, 1); pixelRect(ctx, x + 4, y - 1, 3, 1); ctx.restore(); }
}

export { AMBER };
