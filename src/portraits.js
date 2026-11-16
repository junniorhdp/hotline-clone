import { buildSprite } from './sprites.js';
import { maskIcon } from './masks.js';
import { COLORS, seededRandom, hashString } from './utils.js';

// Retratos de la pantalla "VS" del forcejeo (ver game.drawScuffleUI):
//  - `bloodyMaskPortrait(mask, nivel)`: el retrato de frente de la máscara (el de las tarjetas y el HUD) ampliado
//    a 24×24 con las salpicaduras que lleva el personaje (`player.bloodLevel`, 0..5). Determinista por máscara y
//    cada nivel parte de las mismas gotas (se van sumando); la sangre vieja es más oscura y la reciente, viva.
//  - `villainPortrait(kind)`: un rostro pixel-art sombrío por tipo de enemigo, casi todo en penumbra con los ojos
//    como única luz (el matón común bajo su gorra, el corredor con capucha y pañuelo).

// --- Sangre sobre la máscara ---------------------------------------------------------------------
const BLOOD_DROPS = [0, 7, 16, 28, 42, 60]; // gotas por nivel de sangre (0..5)
const portraitCache = new Map();
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

export function bloodyMaskPortrait(mask, level = 0) {
  const lv = Math.max(0, Math.min(5, level | 0));
  const key = `${mask.id}:${lv}`;
  if (portraitCache.has(key)) return portraitCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base24(mask), 0, 0);
  const n = BLOOD_DROPS[lv];
  if (n > 0) {
    const { px, opaque } = dropOrder(mask);
    for (let i = 0; i < n && i < px.length; i++) {
      const [x, y] = px[i];
      const age = i / n; // las primeras gotas son las más viejas
      ctx.fillStyle = age < 0.35 ? COLORS.bloodDark : age < 0.7 ? COLORS.bloodMid : COLORS.blood;
      ctx.fillRect(x, y, 1, 1);
      if (i % 5 === 0 && x < 23 && y < 23) ctx.fillRect(x, y, 2, 2);       // coágulo
      if (i % 7 === 3) {                                                     // reguero hacia abajo (solo sobre la máscara)
        for (let d = 1; d <= 3 && opaque.has((y + d) * 24 + x); d++) ctx.fillRect(x, y + d, 1, 1);
      }
      if (age > 0.85 && i % 3 === 0) { ctx.fillStyle = COLORS.bloodWet; ctx.fillRect(x, y, 1, 1); } // brillo húmedo
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
