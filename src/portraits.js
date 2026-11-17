import { buildSprite, drawSprite, playerBody, drawMaskHead } from './sprites.js';
import { maskIcon } from './masks.js';
import { COLORS, seededRandom, hashString } from './utils.js';
import { TOXIC } from './particles.js';

// Retratos de la pantalla "VS" del forcejeo (ver game.drawScuffleUI):
//  - `bloodyMaskPortrait(mask, nivel)`: el retrato de frente de la máscara (el de las tarjetas y el HUD) ampliado
//    a 24×24 con las salpicaduras que lleva el personaje (`player.bloodLevel`, 0..5). Determinista por máscara y
//    cada nivel parte de las mismas gotas (se van sumando); la sangre vieja es más oscura y la reciente, viva.
//  - `villainPortrait(kind)`: un rostro pixel-art sombrío por tipo de enemigo, casi todo en penumbra con los ojos
//    como única luz (el matón común bajo su gorra, el corredor con capucha y pañuelo).

// --- Sangre sobre la máscara ---------------------------------------------------------------------
export const BLOOD_DROPS = [0, 7, 16, 28, 42, 60]; // gotas por nivel de sangre (0..5)
const portraitCache = new Map();
export const PORTRAIT_PAD = 2;
const PAD = PORTRAIT_PAD; // margen (px del retrato) alrededor de la máscara: ahí asoman el pelo y la chaqueta
const baseCache = new Map();
const dropsCache = new Map();

function base24(mask) {
  if (!baseCache.has(mask.id)) {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(maskIcon(mask), 0, 0, 24, 24);
    baseCache.set(mask.id, c);
  }
  return baseCache.get(mask.id);
}

// Orden fijo (por máscara) en el que van apareciendo las gotas: píxeles opacos barajados con semilla.
function dropOrder(mask) {
  if (!dropsCache.has(mask.id)) {
    const base = base24(mask), data = base.getContext('2d').getImageData(0, 0, 24, 24).data;
    const px = [];
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (data[(y * 24 + x) * 4 + 3] > 0) px.push([x, y]);
    const rnd = seededRandom(hashString(`portrait:${mask.id}`));
    for (let i = px.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [px[i], px[j]] = [px[j], px[i]]; }
    dropsCache.set(mask.id, { px, opaque: new Set(px.map(([x, y]) => y * 24 + x)) });
  }
  return dropsCache.get(mask.id);
}

// Detrás de la máscara (se dibuja ANTES, la máscara lo tapa): en el retrato femenino, el pelo violeta cae por los lados y arriba,
// una coleta cuelga a la derecha con su goma rosa, y el cuello y los hombros de la bomber (cian, raya rosa, hombros estrechos)
// asoman bajo la máscara. Todo sobre un lienzo de 28×28 (24 + 2 de margen por lado).
function drawFemaleBack(ctx) {
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const hair = '#7a2f8f', shade = '#4d1a63', light = '#b04ab8', tie = '#ff4fa3';
  // flequillo / pelo de arriba y de los lados
  R(5, 0, 18, 4, hair); R(3, 2, 22, 4, hair); R(1, 4, 3, 16, hair); R(24, 4, 3, 14, hair);
  R(7, 0, 5, 1, light); R(13, 1, 4, 1, light); R(1, 6, 1, 8, shade); R(26, 6, 1, 8, shade);
  // coleta: sale por la derecha, baja por detrás del hombro y acaba en punta
  R(24, 10, 4, 2, tie); R(23, 12, 5, 8, hair); R(24, 20, 4, 6, hair); R(25, 26, 2, 2, shade); R(25, 13, 1, 6, light);
  // cuello
  R(10, 25, 8, 3, '#f1b48a'); R(10, 27, 8, 1, '#c27a5a');
  // bomber entallada: hombros estrechos con raya rosa y cuello alto
  R(2, 26, 8, 2, '#05d9e8'); R(18, 26, 8, 2, '#05d9e8'); R(3, 27, 6, 1, '#037f8c'); R(19, 27, 6, 1, '#037f8c');
  R(4, 26, 5, 1, '#ff4fa3'); R(19, 26, 5, 1, '#ff4fa3');
}

// `gender`: 'male' (el retrato de siempre) o 'female' (con pelo, coleta, cuello y chaqueta). La sangre va encima de la
// máscara igual en los dos.
// `mix` = para cada gota (en su orden de aparición) 1 si es de sangre VERDE tóxica y 0 si es roja (ver Game.maskBits): la máscara refleja la mezcla
// de fluidos que el personaje ha acumulado. Sin `mix` todo es rojo.
export function bloodyMaskPortrait(mask, level = 0, gender = 'male', mix = null) {
  const lv = Math.max(0, Math.min(5, level | 0));
  const female = gender === 'female';
  const nDrops = BLOOD_DROPS[lv];
  const key = `${mask.id}:${lv}:${female ? 'f' : 'm'}:${mix ? mix.slice(0, nDrops).join('') : ''}`;
  if (portraitCache.has(key)) return portraitCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 24 + PAD * 2;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (female) drawFemaleBack(ctx);
  ctx.drawImage(base24(mask), PAD, PAD);
  const n = BLOOD_DROPS[lv];
  if (n > 0) {
    const { px, opaque } = dropOrder(mask);
    for (let i = 0; i < n && i < px.length; i++) {
      const [x0, y0] = px[i];
      const x = x0 + PAD, y = y0 + PAD;
      const age = i / n; // las primeras gotas son las más viejas
      const pal = mix && mix[i] === 1 ? TOXIC : { dark: COLORS.bloodDark, mid: COLORS.bloodMid, blood: COLORS.blood, wet: COLORS.bloodWet };
      ctx.fillStyle = age < 0.35 ? pal.dark : age < 0.7 ? pal.mid : pal.blood;
      ctx.fillRect(x, y, 1, 1);
      if (i % 5 === 0 && x < 23 + PAD && y < 23 + PAD) ctx.fillRect(x, y, 2, 2);       // coágulo
      if (i % 7 === 3) {                                                     // reguero hacia abajo (solo sobre la máscara)
        for (let d = 1; d <= 3 && opaque.has((y0 + d) * 24 + x0); d++) ctx.fillRect(x, y + d, 1, 1);
      }
      if (age > 0.85 && i % 3 === 0) { ctx.fillStyle = pal.wet; ctx.fillRect(x, y, 1, 1); } // brillo húmedo
    }
  }
  portraitCache.set(key, c);
  return c;
}

// --- Rostros de los villanos -----------------------------------------------------------------------
// 12×12, de frente. `eyes` = píxeles de los ojos (para el parpadeo); `frame` = color del marco en la UI.
const VILLAINS = {
  // Matón común: gorra morada que le deja la cara en sombra, ojos ámbar, cicatriz y mandíbula marcada.
  grunt: {
    palette: { k: '#07050d', d: '#2a1a22', s: '#7a4a38', c: '#2e1850', m: '#4b2a7a', a: '#ffbe0b', w: '#c9c3e6' },
    rows: [
      '...cccccc...',
      '..cmmmmmmc..',
      '.cmmmmmmmmc.',
      '.cccccccccc.',
      '.kkkkkkkkkk.',
      '.kkakkkkakk.',
      '.kdkkkkkkdk.',
      '.kdkkkkkwdk.',
      '.kdsdddddsk.',
      '..kdsssssdk.',
      '...kdddddk..',
      '....kkkkk...',
    ],
    eyes: [[3, 5], [8, 5]],
    frame: '#ffbe0b',
  },
  // Corredor: capucha rosa, pañuelo cian sobre la boca y dos rendijas de neón por ojos.
  runner: {
    palette: { k: '#07050d', p: '#ff4fa3', P: '#a31f66', e: '#05d9e8', c: '#037f8c', C: '#9ff6ff' },
    rows: [
      '....pppp....',
      '..pPPPPPPp..',
      '.pPPPPPPPPp.',
      '.pPkkkkkkPp.',
      '.pkkkkkkkkp.',
      '.pkeekkeekp.',
      '.pkkkkkkkkp.',
      '.pPcccccccp.',
      '..pcCCCCCcp.',
      '..pccccccc..',
      '...pPPPPp...',
      '....pppp....',
    ],
    eyes: [[3, 5], [4, 5], [7, 5], [8, 5]],
    frame: '#ff4fa3',
  },
};

const villainCache = new Map();
export function villainDef(kind) {
  return VILLAINS[kind] || VILLAINS.grunt;
}
export function villainPortrait(kind) {
  const def = villainDef(kind), key = VILLAINS[kind] ? kind : 'grunt';
  if (!villainCache.has(key)) villainCache.set(key, buildSprite(def.rows, def.palette));
  return villainCache.get(key);
}

// --- Agentes (JACK / VEX) y su vista previa --------------------------------------------------------
// Los dos agentes son una variante SOLO cosmética del personaje (`'male'` / `'female'` en el ajuste playerGender): cambian la silueta, la chaqueta,
// la coleta, el retrato VS y la voz. Las ventajas jugables son de las 5 máscaras. Cada uno tiene su color neón (JACK cian, VEX magenta).
export const AGENTS = {
  male: { name: 'JACK', color: '#05d9e8', tint: '#062a30' },
  female: { name: 'VEX', color: '#ff2a85', tint: '#3a0d28' },
};

// Símbolo ♂ / ♀ de píxeles (9×9) para los botones del selector.
export function drawGenderIcon(ctx, x, y, gender, color) {
  const px = [];
  const ring = (cx, cy) => {
    for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) { const d = Math.hypot(i - cx, j - cy); if (d > 1.7 && d < 2.9) px.push([i, j]); }
  };
  if (gender === 'male') {
    ring(3.5, 5.5);
    px.push([5, 3], [6, 2], [7, 1], [8, 0], [5, 0], [6, 0], [7, 0], [8, 1], [8, 2], [8, 3]); // flecha hacia arriba a la derecha
  } else {
    ring(4, 3);
    px.push([4, 6], [4, 7], [4, 8], [3, 7], [5, 7]); // cruz hacia abajo
  }
  ctx.fillStyle = color;
  for (const [i, j] of px) ctx.fillRect(x + i, y + j, 1, 1);
}

// Visor de vista previa en vivo: el agente elegido con la máscara elegida, en guardia, con una respiración suave (vaivén de un píxel, los
// puños que suben y bajan, la mirada que barre unos grados y, en VEX, la coleta que se balancea). Dibuja con el mismo sprite que el
// juego (`playerBody`, `drawMaskHead`, `ponytail`), así que muestra exactamente la combinación que se va a jugar.
export function drawAgentPreview(ctx, r, maskId, gender, t) {
  const ag = AGENTS[gender] || AGENTS.male;
  // Fondo con rejilla tenue y barrido de luz
  ctx.fillStyle = '#0d0221';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#1a0f2e';
  for (let k = 8; k < r.w; k += 8) ctx.fillRect(r.x + k, r.y + 1, 1, r.h - 2);
  for (let k = 8; k < r.h; k += 8) ctx.fillRect(r.x + 1, r.y + k, r.w - 2, 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.clip();
  // Agente
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2 - 3 + Math.round(Math.sin(t * 2.4) * 1.5);
  ctx.translate(cx, cy);
  ctx.scale(1.5, 1.5);
  ctx.rotate(-0.45 + Math.sin(t * 0.9) * 0.09);
  const guard = Math.sin(t * 2.4) * 1.2;
  drawSprite(ctx, 'fist', 10 + guard, 8);
  drawSprite(ctx, 'fist', 10 - guard, -8);
  drawSprite(ctx, playerBody(maskId, 0, gender), 0, 0);
  if (gender === 'female') drawSprite(ctx, 'ponytail', -3, 0, Math.sin(t * 2.4 + 1) * 0.3, { ox: 10, oy: 2.5 });
  drawMaskHead(ctx, maskId, 0);
  ctx.restore();
  // Barrido de luz que sube por el visor
  const sweep = Math.floor(((t * 22) % (r.h + 16)) - 8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(r.x + 1, r.y + r.h - 1 - sweep, r.w - 2, 2);
  // Marco neón del color del agente + esquinas reforzadas
  ctx.fillStyle = ag.color;
  ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
  ctx.fillRect(r.x, r.y, 1, r.h); ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
  for (const [ox, oy] of [[0, 0], [r.w - 6, 0], [0, r.h - 6], [r.w - 6, r.h - 6]]) {
    ctx.fillRect(r.x + ox, r.y + oy, 6, 2); ctx.fillRect(r.x + ox, r.y + oy, 2, 6);
    ctx.fillRect(r.x + ox + (ox ? 0 : 4), r.y + oy + (oy ? 4 : 0), 2, 2);
  }
}

// Candado de píxeles (7×8) para las máscaras bloqueadas; `scale` en píxeles de escena por píxel del icono.
export function drawPadlock(ctx, x, y, color, scale = 2) {
  const rows = ['..###..', '.#...#.', '.#...#.', '#######', '#######', '###.###', '###.###', '#######'];
  ctx.fillStyle = color;
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') ctx.fillRect(x + i * scale, y + j * scale, scale, scale); });
}
