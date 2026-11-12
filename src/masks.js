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
export const DEFAULT_EFFECTS = { meleeLethal: false, speedMul: 1, startWeapon: null, bulletSpeedMul: 1, spreadMul: 1 };

export const MASKS = [
  {
    id: 'neon',
    name: 'NEÓN',
    passive: ['SIN PASIVA.', 'LA EXPERIENCIA CLÁSICA.'],
    effects: {},
    palette: { a: '#2a2a40', A: '#454566', v: '#05d9e8', V: '#9ff6ff' },
    rows: [
      '....kkkk....',
      '..kkAAAAkk..',
      '.kAAaaaaAAk.',
      '.kAaaaaaaAk.',
      'kAaaaaaaaaAk',
      'kkkkkkkkkkkk',
      'kVvvvvvvvvVk',
      'kvvvvvvvvvvk',
      'kkkkkkkkkkkk',
      '.kaaaaaaaak.',
      '..kaaaaaak..',
      '...kkkkkk...',
    ],
  },
  {
    id: 'oso',
    name: 'OSO',
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
    name: 'GUEPARDO',
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
    name: 'TIBURÓN',
    passive: ['EMPIEZAS CADA PISO', 'CON UN CUCHILLO.'],
    effects: { startWeapon: 'knife' },
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
    name: 'BÚHO',
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
