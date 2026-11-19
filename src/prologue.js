// PRÓLOGO: tutorial aparte del piso 1 (ver "Prólogo" en CLAUDE.md). No está en `LEVELS` (el selector de pisos, los récords y las estadísticas de campaña no lo ven):
// `Game.prologue` = true hace que `loadLevel` use `PROLOGUE_DEF` en vez de `LEVELS[0]`. Es un edificio corto (3 salas + pasillo) con el exterior habitual (vestíbulo,
// puerta principal, calle y moto), 4 enemigos y un COMPAÑERO capturado y herido (`hostage` = casilla fija, `partner`): no pelea; se libera, te sigue y sale contigo.
// Mismas reglas de diseño que los pisos (ver "Diseño de niveles"): `npm run check:levels` también lo valida.
export const PROLOGUE_KEY = 'neonrush.prologue.v1';

// ¿Ya se jugó o se saltó alguna vez el prólogo? (JUGAR lo lanza solo la primera vez; PRÓLOGO en el título, siempre.) Lectura defensiva: sin acceso → false.
export function prologueSeen() {
  try { return localStorage.getItem(PROLOGUE_KEY) === '1'; } catch { return false; }
}
export function markPrologueSeen() {
  try { localStorage.setItem(PROLOGUE_KEY, '1'); } catch { /* modo privado o cuota: sin guardar */ }
}

// LÍNEAS DE LORE del prólogo (se muestran con comms.js; ver Game.prologueLine). Aquí solo hay texto: se pulen sin tocar código.
//   · `id` = momento (intro: fuera del edificio · enter: salidas cerradas · kill: primera baja · free: al liberarlo · clear: piso despejado). Cada id sale una vez por partida.
//   · `who`: 'central' (la voz de la Organización por radio, ámbar) | 'partner' (el compañero, con su nombre, su color y el retrato de su máscara).
//   · Marcadores: {ME} = nombre del agente que controlas, {PARTNER} = el del compañero. 1-2 frases cortas por línea (se parten solas en filas).
//   · Arco que se insinúa (sin explicarlo): la mafia está casi caída (trabajo de la Organización) · alguien DENTRO de la Organización vendió los nombres de los agentes ·
//     quedan tres nombres pendientes (cabo suelto de misterio).
export const PROLOGUE_LINES = {
  intro: [{ who: 'central', text: 'La mafia cayó casi entera esta semana. {PARTNER} se quedó dentro.' }],
  enter: [{ who: 'central', text: 'Bien, puerta cerrada. Que no salga ninguno.' }],
  kill: [{ who: 'central', text: 'Esos no llevan los colores de la familia.' }],
  free: [
    { who: 'partner', text: 'Sabía que vendrías, {ME}. Me usaron de cebo.' },
    { who: 'partner', text: 'Alguien de la Organización dio nuestros nombres.' },
  ],
  clear: [{ who: 'partner', text: 'Quedan tres nombres en la lista. Vámonos.' }],
};

export const PROLOGUE_DEF = {
  prologue: true,
  name: 'PRÓLOGO · EL RESCATE',
  floor: 'concrete',
  loot: [],
  guaranteed: [],
  smgChance: 0,
  mix: { arm: 0, melee: 0.35 },   // sin sorteo de pistolas: solo lo que dibuja el mapa (4 enemigos: 3 sin arma o con tubo/bate/cuchillo y 1 con pistola)
  par: 60,
  hostage: [37, 5],               // casilla fija del compañero (R lo conserva)
  rows: [
    '########################################',
    '#............#............#............#',
    '#............#............#......V.....#',
    '#............D............#...W........#',
    '#...T........#............D............#',
    '#........B...#....E.......#............#',
    '#............#............#............#',
    '######D############D############D#######',
    '#......................................#',
    '#...........................E..........#',
    '###################D####################',
    '#......................................#',
    '#......................................#',
    '###################N####################',
    '.......P................................',
    '........................................',
    '........................................',
    '........................................',
    '........................................',
    '########################################',
  ],
  zones: [
    ['brokenTiles', 1, 1, 12, 6], ['wood', 14, 1, 25, 6], ['carpet', 27, 1, 38, 6],
    ['wood', 1, 11, 38, 12], ['asphalt', 0, 15, 39, 18], ['asphaltLine', 0, 17, 1, 17],
    ['asphaltLine', 4, 17, 5, 17], ['asphaltLine', 8, 17, 9, 17], ['asphaltLine', 12, 17, 13, 17],
    ['asphaltLine', 16, 17, 17, 17], ['asphaltLine', 20, 17, 21, 17], ['asphaltLine', 24, 17, 25, 17],
    ['asphaltLine', 28, 17, 29, 17], ['asphaltLine', 32, 17, 33, 17], ['asphaltLine', 36, 17, 37, 17],
    ['asphaltBay', 6, 15, 9, 15],
  ],
  props: [
    ['desk', 6, 1, 3, 1], ['crates', 1, 1, 1, 1], ['trash', 11, 6, 1, 1], ['rug', 3, 3, 3, 2],
    ['shelf', 25, 1, 1, 2], ['desk', 16, 1, 2, 1], ['papers', 20, 3, 1, 1], ['debris', 22, 6, 1, 1],
    ['cabinet', 29, 1, 1, 1], ['cabinet', 30, 1, 1, 1], ['crates', 38, 1, 1, 1], ['stain', 34, 3, 1, 1],
    ['barrel', 12, 8, 1, 1], ['trash', 38, 9, 1, 1], ['stain', 30, 8, 1, 1],
    // Exterior: vestíbulo, calle y la moto (aparcada en la plaza, 2×1 casillas).
    ['counter', 8, 11, 4, 1], ['sofa', 26, 12, 3, 1], ['barrel', 1, 11, 1, 1], ['crates', 1, 12, 1, 1],
    ['shelf', 38, 11, 1, 2], ['rug', 14, 11, 3, 2], ['papers', 12, 12, 1, 1], ['trash', 32, 12, 1, 1],
    ['crates', 3, 18, 1, 1], ['crates', 4, 18, 1, 1], ['barrel', 12, 18, 1, 1], ['trash', 15, 17, 1, 1],
    ['stain', 20, 16, 1, 1], ['debris', 26, 17, 1, 1], ['barrel', 30, 18, 1, 1], ['crates', 34, 18, 1, 1],
    ['crates', 35, 18, 1, 1], ['crates', 35, 17, 1, 1], ['trash', 37, 15, 1, 1], ['papers', 23, 18, 1, 1],
    ['bike', 7, 15, 2, 1],
  ],
};
