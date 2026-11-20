// CAMPO DE PRUEBAS: nivel exclusivo (NO está en `LEVELS`: ni el selector, ni los récords, ni la campaña lo ven) para probar cada arma. Se abre desde el título (CAMPO DE PRUEBAS):
// `Game.testRange` = true hace que `loadLevel` use `TESTRANGE_DEF`. No es para divertirse: una sala grande y despejada con TODAS las armas del juego en un mostrador (se elige
// la que se quiera, y al cogerla reaparece otra en su sitio) y muchos enemigos que NO se mueven, no te ven, no atacan y vuelven a salir a los pocos segundos de caer, para
// pegar, disparar, rematar, lanzar y envenenar a gusto. Empiezas ya dentro, con la máscara puesta y sin bloqueo ni reloj; R reinicia la sala. Ver "Campo de pruebas" en CLAUDE.md.
// Mismas reglas de diseño que los pisos (la puerta principal, la moto y el exterior habituales): `npm run check:levels` también lo valida.
const HALL = '#' + '.'.repeat(46) + '#';
const row = (placements) => {            // una fila del salón con letras en las columnas dadas (x → letra)
  const cells = HALL.split('');
  for (const [x, ch] of placements) cells[x] = ch;
  return cells.join('');
};
const xs = (from, step, n) => Array.from({ length: n }, (_, i) => from + i * step);
const pat = (letters, from, step) => letters.split('').map((ch, i) => [from + i * step, ch]);

export const TESTRANGE_DEF = {
  testRange: true,
  name: 'CAMPO DE PRUEBAS',
  floor: 'metal',
  loot: [],
  guaranteed: [],
  smgChance: 0,
  mix: { arm: 0, melee: 0 },     // las letras mandan: ni pistolas ni armas cuerpo a cuerpo sorteadas
  noHostages: true,
  dummies: true,                 // todos los enemigos son MANEQUÍES (Enemy.dummy): quietos, ciegos y sin ataque; reaparecen al caer (Game.updateRange)
  par: 999,
  // TODAS las armas, en el mostrador (fila 3): [tipo, x, y]. Cada hueco repone su arma al cogerla.
  pickups: [['bat', 3, 3], ['nailbat', 7, 3], ['pipe', 11, 3], ['knife', 15, 3], ['cleaver', 19, 3], ['crowbar', 23, 3], ['rustpipe', 27, 3], ['rustknife', 31, 3],
    ['gun', 35, 3], ['shotgun', 39, 3], ['smg', 43, 3]],
  rows: [
    '#'.repeat(48),
    HALL,
    HALL,
    HALL,
    HALL,
    HALL,
    HALL,
    row(xs(4, 4, 11).map((x) => [x, 'E'])),                                       // fila 7: 11 enemigos sin arma
    HALL,
    HALL,
    row(pat('RARARARARAR', 4, 4)),                                                 // fila 10: corredores y armados (pistola) alternados
    HALL,
    HALL,
    row([[6, 'H'], [14, 'Z'], [22, 'H'], [30, 'Z'], [38, 'H'], [44, 'Z']]),       // fila 13: pesados (escopeta) y blindados (escudo)
    HALL,
    HALL,
    row(xs(6, 4, 10).map((x) => [x, 'E'])),                                       // fila 16: más enemigos sin arma, para derribar y rematar
    HALL,
    HALL,
    HALL,
    '#####D######D###########D##########D######D#####',
    '#..............................................#',
    '#..............................................#',
    '########################N#######################',
    '.......P........................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '################################################',
  ],
  zones: [
    ['metal', 1, 1, 46, 19],
    // Exterior: vestíbulo, calle (asfalto, rayas del carril) y plaza de la moto.
    ['wood', 1, 21, 46, 22], ['asphalt', 0, 25, 47, 28], ['asphaltLine', 0, 27, 1, 27],
    ['asphaltLine', 4, 27, 5, 27], ['asphaltLine', 8, 27, 9, 27], ['asphaltLine', 12, 27, 13, 27],
    ['asphaltLine', 16, 27, 17, 27], ['asphaltLine', 20, 27, 21, 27],
    ['asphaltLine', 24, 27, 25, 27], ['asphaltLine', 28, 27, 29, 27],
    ['asphaltLine', 32, 27, 33, 27], ['asphaltLine', 36, 27, 37, 27],
    ['asphaltLine', 40, 27, 41, 27], ['asphaltLine', 44, 27, 45, 27], ['asphaltBay', 6, 25, 9, 25],
  ],
  props: [
    ['counter', 2, 2, 44, 1],                       // el mostrador de las armas
    ['crates', 8, 5, 2, 2], ['crates', 36, 5, 2, 2], ['barrel', 24, 5, 1, 1],   // algo de cobertura al fondo (para probar que las balas se detienen)
    // Exterior mínimo: la moto aparcada en la plaza (2×1 casillas).
    ['bike', 7, 25, 2, 1],
  ],
};
