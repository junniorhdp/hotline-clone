import { playerSprite, uprightSprite } from './sprites.js';

// Máscaras: se eligen antes de cada piso y aplican una pasiva durante todo el piso
// (también al reintentar con R). Diseños propios del juego.
//
// El aspecto de cada máscara vive en MASK_DEFS/MASK_SKINS (`sprites.js`), que son los sprites
// del jugador en partida: `maskIcon` reutiliza ese mismo bitmap girado hacia arriba, así que
// el menú y el HUD muestran exactamente la cabeza que se verá en el piso.
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
  },
  {
    id: 'oso',
    name: 'OSO',
    passive: ['PUÑETAZOS MORTALES:', 'MATAN AL INSTANTE, SIN DERRIBAR.'],
    effects: { meleeLethal: true },
  },
  {
    id: 'guepardo',
    name: 'GUEPARDO',
    passive: ['VELOCIDAD DE MOVIMIENTO', '+30%.'],
    effects: { speedMul: 1.3 },
  },
  {
    id: 'tiburon',
    name: 'TIBURÓN',
    passive: ['EMPIEZAS CADA PISO', 'CON UN CUCHILLO.'],
    effects: { startWeapon: 'knife' },
  },
  {
    id: 'buho',
    name: 'BÚHO',
    passive: ['TUS BALAS: +20% VELOCIDAD', 'Y MÁS PRECISIÓN.'],
    effects: { bulletSpeedMul: 1.2, spreadMul: 0.5 },
  },
];

// Efectos completos de una máscara (con valores por defecto).
export function maskEffects(mask) {
  return { ...DEFAULT_EFFECTS, ...(mask ? mask.effects : {}) };
}

// Icono de la máscara para el menú y el HUD: el sprite del jugador en partida (16×16) mirando
// hacia arriba. Una sola fuente de verdad, no puede desincronizarse del piso.
export const MASK_ICON_SIZE = 16;
export function maskIcon(mask) {
  return uprightSprite(playerSprite(mask.id));
}
