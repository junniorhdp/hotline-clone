// Cobertura de la traducción: recorre los textos de src/ y avisa de los que, en inglés, saldrían en español. Ejecutar: npm run check:i18n
// Heurística (no es perfecta): considera "texto visible" lo que lleva mayúsculas seguidas, tildes o varias palabras. Los textos sueltos en minúsculas pueden escapársele.
import fs from 'fs';
import { parseSync } from 'vite';
import { tr, hasTranslation } from '../src/i18n.js';

// No son texto de pantalla (o solo salen en depuración).
const SKIP_FILES = new Set(['sprites.js', 'pixelfont.js', 'i18n.js', 'i18n-en.js', 'portraits.js', 'menu-strip.js']);
const SKIP = [
  /^(#|rgb|Key[A-Z]?$|Arrow|Mouse|neonrush|Digit|Numpad|Escape|Enter|Space|Backspace|Delete)/, /translate\(|px;|\.js$/, /^[.#kfdDNZzBgpPcC]{6,}$/,
  /: (la fila|falta|tiene que|mueble|'|no hay|la puerta)/, /^aeiou/, /ABCDEFGHIJ/, /^(DEBUG|ESCENA) /, /^ (AIM|WINDUP|\[GUN\]|JUGADOR|BLOQUEADA|CERRANDO|GOLPE)/,
  /^(CLASSIC|7 HP 7|7TH|¡OPERADOR ELIMINADO! \+|RESISTENCIA X| · 7 MUERTO7 -7|NUM | ESTABA EN |: INTERCAMBIADAS| ESTÁ RESERVADA| SE QUEDARÍA SIN TECLA)$/, /^\.{2,3}k[fR]/, // trozos que se unen en frases ya cubiertas, y sprites
  /^(DOWN|EJECUTANDO|FUERA|DENTRO|LIBRE|CERRANDO|CIVILES)$/, /^EJECUCION /, /^Franja del título/, /^RARARA/, /^(Mid|Dark)$/,
];
// Iguales (o casi) en los dos idiomas.
const SAME = new Set(['NEON RUSH', 'NEON', 'JACK', 'VEX', 'BRUTE', 'STRIKE', 'BLADE', 'GHOST', 'RICK', 'RADIO', 'AUDIO', 'ENGLISH', 'ESPAÑOL', 'LANGUAGE / IDIOMA',
  'IDIOMA / LANGUAGE', 'VS', 'COMBO', 'OFF', 'POS', 'REC', 'NO', 'NORMAL', 'PENTHOUSE', 'TAB', 'INSERT', 'EN', 'ES', 'HIGH SCORES', '1ST', '2ND', '3RD', '4TH', '5TH', 'EN | ES']);

const texts = new Map();
const dir = new URL('../src/', import.meta.url);
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js') && !SKIP_FILES.has(n))) {
  const code = fs.readFileSync(new URL(f, dir), 'utf8');
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return;
    let s = null;
    if (n.type === 'Literal' && typeof n.value === 'string') s = n.value;
    if (n.type === 'TemplateLiteral') s = n.quasis.map((q) => q.value.cooked).join('7');
    if (s !== null && (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+[.?!:]*$/.test(s) || /[A-ZÁÉÍÓÚÑ¿¡]{2,}/.test(s) || /[¿¡áéíóúñ]/.test(s) || /[a-z]{2,} [a-z]{2,}/i.test(s))
      && !SKIP.some((re) => re.test(s))) texts.set(s, f);
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
  };
  walk(parseSync(f, code).program);
}

// Restos de español en una traducción.
const SPANISH = /[¿¡áéíóúñ]|(^|[^\p{L}])(EL|LOS|LAS|UNA|PARA|PERO|CON|SIN|POR|QUE|PISO|ARMA|PUERTA|ESPACIO|TOCA|VOLVER)(?!\p{L})/iu;
const missing = [];
for (const [s, f] of texts) {
  if (SAME.has(s.trim())) continue;
  const out = tr(s);
  if (!hasTranslation(s) || SPANISH.test(out)) missing.push(`${f}: ${JSON.stringify(s)}${out !== s ? ` -> ${JSON.stringify(out)}` : ''}`);
}
console.log(`${texts.size} textos revisados, ${missing.length} sin traducir`);
missing.forEach((m) => console.log('  ' + m));
process.exit(missing.length ? 1 : 0);
