// Frases de los enemigos (se muestran como texto flotante sobre su cabeza): al avistar al jugador (neutras, según su género y según la máscara que lleva) y
// al ver cadáveres que otro ya descubrió (tensión). Solo datos y selección; el límite de frases a la vez lo pone Game.bark.

const NEUTRAL = ['¡AHÍ ESTÁ!', '¡ALTO AHÍ!', '¡TENEMOS UN INTRUSO!', '¡DISPARAD!', '¡NO DEJÉIS QUE ESCAPE!', '¡AQUÍ!'];

const GENDER = {
  female: ['¡ES UNA CHICA!', '¡CUIDADO, ES UNA MUJER!', '¡ES ELLA!', '¡UNA MUJER ENMASCARADA!', '¡A POR ELLA!'],
  male: ['¡ES UN TIPO CON MÁSCARA!', '¡AHÍ ESTÁ ESE CABRÓN!', '¡A POR ÉL!', '¡ES ÉL!', '¡UN TIPO ENMASCARADO!'],
};

// Por máscara (id estable de masks.js): reconocimiento, pánico, desconcierto o burla ante el aspecto del enmascarado.
const MASK = {
  tiburon: ['¡ES EL DEL TIBURÓN!', '¡VIENE CON EL CUCHILLO!', '¡CUIDADO, EL TIBURÓN!', '¡ESE TIBURÓN CORTA!', '¡SANGRE DE TIBURÓN!'],
  neon: ['¡UN GALLO!', '¿QUÉ ES ESO, UN POLLO?', '¡COCORICO, CABRÓN!', '¡ES UN GALLO LOCO!'],
  oso: ['¡UN OSO!', '¡ESE OSO PEGA DURO!', '¡CUIDADO, EL OSO!', '¡ES UN OSO ENORME!'],
  guepardo: ['¡ES MUY RÁPIDO!', '¡EL GUEPARDO!', '¡PARECE UN GATO GRANDE!', '¡NO LO DEJÉIS CORRER!'],
  buho: ['¡EL BÚHO!', '¿QUIÉN SE DISFRAZA DE BÚHO?', '¡NOS VIGILA UN BÚHO!', '¡ESOS OJOS ME ASUSTAN!'],
};

// Al ver un cadáver que ya descubrió otro: tensión, o silencio (la mayoría de las veces).
const TENSION = ['¡MIERDA!', '¡SIGUE FRÍO!', '¡NOS ESTÁN CAZANDO!', '¡OTRO MÁS!', '¿QUIÉN HA SIDO?', '¡ESTÁ AQUÍ DENTRO!', '¡ALERTA, ALERTA!'];

const pick = (list, avoid) => {
  let t = list[Math.floor(Math.random() * list.length)];
  if (t === avoid && list.length > 1) t = list[(list.indexOf(t) + 1) % list.length]; // no repite la frase anterior
  return t;
};

// Frase al avistar al jugador: máscara 45 %, género 30 %, neutra el resto (las líneas de máscara y de género se intercalan con las neutras).
export function spotLine(gender, maskId, avoid) {
  const r = Math.random(), m = MASK[maskId];
  if (m && r < 0.45) return pick(m, avoid);
  if (r < 0.75) return pick(GENDER[gender] || GENDER.male, avoid);
  return pick(NEUTRAL, avoid);
}

// Frase de tensión por ver un cadáver ya descubierto (o null: se queda callado, en guardia).
export function corpseLine(avoid) {
  return Math.random() < 0.45 ? pick(TENSION, avoid) : null;
}
