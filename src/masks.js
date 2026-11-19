import { buildSprite } from './sprites.js';

// Máscaras: se eligen antes de cada piso y aplican una pasiva durante todo el piso
// (también al reintentar con R). Diseños propios del juego.
//
// `effects` (todos opcionales, los valores por defecto están en `DEFAULT_EFFECTS`):
//   meleeLethal     los puñetazos matan al instante en vez de derribar
//   speedMul        multiplicador de la velocidad de movimiento
//   startWeapon     arma con la que empiezas el piso (tipo de WEAPON_DEFS)
//   bulletSpeedMul  multiplicador de la velocidad de tus balas
//   spreadMul       multiplicador de la dispersión de tus disparos (menos = más precisión)
//   lookAhead       mirada adelantada de la cámara (RICK): 1 = la de siempre; > 1 la adelanta más hacia el cursor (PC) o hacia donde apuntas / te mueves (táctil). Sin zoom.
export const DEFAULT_EFFECTS = { meleeLethal: false, speedMul: 1, startWeapon: null, bulletSpeedMul: 1, spreadMul: 1, lookAhead: 1 };

export const MASKS = [
  {
    id: 'neon',
    jaw: { x0: 4, x1: 8, y0: 8 }, // región que baja al hablar (celdas del retrato 12×12; y1 por defecto 12): ver Comms.drawMaskTalking
    name: 'NEON',
    passive: ['SIN PASIVA.', 'LA EXPERIENCIA CLÁSICA.'],
    effects: {},
    // Gallo: cresta roja de neón, plumas claras, pico ámbar afilado y barbillas bajo el pico.
    palette: { f: '#ece8ff', F: '#b3abd6', r: '#ff2e55', R: '#b01238', b: '#ffbe0b' },
    rows: [
      '...r.r.r....',
      '..krrrrrk...',
      '.kffffffffk.',
      'kffffffffffk',
      'kfkkffffkkfk',
      'kfkkffffkkfk',
      'kfffbbbbfffk',
      '.kFfbbbbfFk.',
      '.kFffbbffFk.',
      '..kfRRRRfk..',
      '...kRRRRk...',
      '....kkkk....',
    ],
  },
  {
    id: 'oso',
    jaw: { x0: 0, x1: 12, y0: 9 }, // región que baja al hablar (celdas del retrato 12×12; y1 por defecto 12): ver Comms.drawMaskTalking
    name: 'BRUTE',
    passive: ['PUÑETAZOS MORTALES:', 'MATAN AL INSTANTE, SIN DERRIBAR.'],
    effects: { meleeLethal: true },
    palette: { b: '#7a4a2a', B: '#5a3418', n: '#c89060' },
    rows: [
      '.kk......kk.',
      'kbbk....kbbk',
      'kbBbkkkkbBbk',
      '.kbbbbbbbbk.',
      'kbbbbbbbbbbk',
      'kbkkbbbbkkbk',
      'kbbbbbbbbbbk',
      'kbbbnnnnbbbk',
      '.kbnnkknnbk.',
      '.kbnnnnnnbk.',
      '..kkbbbbkk..',
      '....kkkk....',
    ],
  },
  {
    id: 'guepardo',
    jaw: { x0: 0, x1: 12, y0: 9 }, // región que baja al hablar (celdas del retrato 12×12; y1 por defecto 12): ver Comms.drawMaskTalking
    name: 'STRIKE',
    lockFloor: 2, // bloqueada: la lleva un enemigo portador en este piso (ver Game.dropMask)
    passive: ['VELOCIDAD DE MOVIMIENTO', '+30%.'],
    effects: { speedMul: 1.3 },
    palette: { o: '#ffb23f', O: '#c47a1a', w: '#fff1d0' },
    rows: [
      '.kk......kk.',
      'kOok....kOok',
      'kooOkkkkOook',
      '.kookoookok.',
      'kooooooooook',
      'kokkookokkok',
      'kokooooookok',
      'kokowwwwokok',
      '.kowwkkwwok.',
      '.kkwwwwwwkk.',
      '..kkwwwwkk..',
      '....kkkk....',
    ],
  },
  {
    id: 'tiburon',
    jaw: { x0: 0, x1: 12, y0: 9 }, // región que baja al hablar (celdas del retrato 12×12; y1 por defecto 12): ver Comms.drawMaskTalking
    name: 'BLADE',
    lockFloor: 3,
    passive: ['EMPIEZAS CON UN CUCHILLO', 'DE CARNICERO (+ALCANCE).'],
    effects: { startWeapon: 'cleaver' },
    palette: { g: '#6c7fa8', G: '#45557a', w: '#f5f3ff' },
    rows: [
      '.....kk.....',
      '....kGgk....',
      '...kGggk....',
      '.kkggggggkk.',
      'kggggggggggk',
      'kgkkggggkkgk',
      'kggggggggggk',
      'kgwwwwwwwwgk',
      'kkwkwkwkwkwk',
      'kwwwwwwwwwwk',
      '.kkwwwwwwkk.',
      '...kkkkkk...',
    ],
  },
  {
    id: 'buho',
    jaw: { x0: 5, x1: 7, y0: 8, y1: 9 }, // región que baja al hablar (celdas del retrato 12×12; y1 por defecto 12): ver Comms.drawMaskTalking
    name: 'GHOST',
    lockFloor: 4,
    passive: ['TUS BALAS: +20% VELOCIDAD', 'Y MÁS PRECISIÓN.'],
    effects: { bulletSpeedMul: 1.2, spreadMul: 0.5 },
    palette: { u: '#6b4a8a', U: '#4a3066', e: '#ffd166', y: '#ff8a3d' },
    rows: [
      '.k........k.',
      'kuk......kuk',
      'kuukkkkkkuuk',
      'kuuuuuuuuuuk',
      'kueeekkeeeuk',
      'kuekekkekeuk',
      'kueeekkeeeuk',
      'kuuuuyyuuuuk',
      '.kuuuyyuuuk.',
      '.kuUuuuuUuk.',
      '..kkuuuukk..',
      '....kkkk....',
    ],
  },
  {
    // SECRETA: no sale en la selección hasta encontrarla (`secret`). Está en el cadáver que devora el cocodrilo de la alcantarilla del piso 3 (ver Game.lootRick). Águila de Rick, su
    // antiguo dueño: plumas oscuras con acentos dorados, cejas marcadas, ojos de oro y pico de hueso afilado y ganchudo. Lleva la MARCA de su final sin romper la silueta: una
    // GRIETA clara (`c`) que cruza el ojo izquierdo y una MUESCA de mordisco en el borde derecho.
    id: 'aguila',
    secret: true,
    jaw: { x0: 4, x1: 8, y0: 8, y1: 11 }, // el pico baja al hablar
    name: 'RICK',
    passive: ['MIRADA ADELANTADA:', 'LA CÁMARA SE ADELANTA.'],
    effects: { lookAhead: 2.4 },
    palette: { d: '#565670', D: '#1c1c28', g: '#e0a82a', b: '#ece4c8', B: '#b8ae8c', e: '#f2c230', c: '#fff6d8' },
    rows: [
      '..kg....gk..',
      '.kddgkkgddk.',
      'kdDcddddDDdk',
      'kDDckddkDDDk',
      'kdecekkeeedk',
      'kdckekkekedk',
      'kdcddbbdddk.',
      'kdddkbbkddk.',
      '.kddkbBkddk.',
      '.kdgkBBkgdk.',
      '..kkkBBkkk..',
      '.....kk.....',
    ],
  },
];

// Efectos completos de una máscara (con valores por defecto).
export function maskEffects(mask) {
  return { ...DEFAULT_EFFECTS, ...(mask ? mask.effects : {}) };
}

const icons = new Map();
// Icono 12×12 de la máscara (se hornea la primera vez que se pide).
export function maskIcon(mask) {
  if (!icons.has(mask.id)) icons.set(mask.id, buildSprite(mask.rows, mask.palette));
  return icons.get(mask.id);
}
