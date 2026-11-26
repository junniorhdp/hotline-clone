// Idioma del juego. El código escribe sus textos EN ESPAÑOL y se traducen justo al dibujarse (pixelfont.js llama a `tr` en drawText y measureText), así que la lógica
// nunca ve el texto traducido. El idioma por defecto es el INGLÉS (lo piden los portales de juegos); se cambia en el título (EN / ES) y en OPCIONES.
// OJO: lo que se corte antes de dibujarse (texto tecleado letra a letra o partido en filas) tiene que pasar por `tr` ENTERO, antes de cortarlo.
import { EN } from './i18n-en.js';

export const LANGUAGES = ['en', 'es'];
let lang = 'en';
const cache = new Map();
const MAX_CACHE = 1500;

export const getLang = () => lang;
export const locale = () => (lang === 'es' ? 'es' : 'en-US'); // separador de miles
export function setLang(v) {
  lang = LANGUAGES.includes(v) ? v : 'en';
  cache.clear();
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

const norm = (s) => s.toUpperCase();
const exact = new Map();
const patterns = [];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const [es, en] of Object.entries(EN)) {
  if (!es.includes('{}')) { exact.set(norm(es), en); continue; }
  const parts = norm(es).split('{}');
  patterns.push({
    re: new RegExp(`^${parts.map(escapeRe).join('(.+?)')}$`, 's'), en,
    weight: parts.join('').length,
  });
}
patterns.sort((a, b) => b.weight - a.weight); // primero los más concretos

// Traducción de `s` o null si no hay ninguna.
function lookup(s, depth) {
  const lead = s.length - s.trimStart().length, core = s.trim();
  if (!core) return null;
  const wrap = (t) => s.slice(0, lead) + t + s.slice(lead + core.length);
  const key = norm(core);
  const hit = exact.get(key);
  if (hit !== undefined) return wrap(hit);
  if (depth > 3) return null;
  if (core.startsWith('· ')) { const t = lookup(core.slice(2), depth + 1); return t === null ? null : wrap(`· ${t}`); }   // trozo que se añade a otra frase
  for (const p of patterns) {
    if (!p.re.test(key)) continue;
    // Los huecos se capturan del texto original (para conservar sus mayúsculas) y se traducen a su vez.
    const m = new RegExp(p.re.source, 'is').exec(core);
    if (!m) continue;
    return wrap(p.en.replace(/\{(\d)\}/g, (_, i) => { const g = m[Number(i) + 1] ?? ''; return lookup(g, depth + 1) ?? g; }));
  }
  // Textos compuestos «A · B»: cada parte por separado.
  if (core.includes(' · ')) {
    let any = false;
    const out = core.split(' · ').map((part) => { const t = lookup(part, depth + 1); if (t !== null) any = true; return t ?? part; });
    if (any) return wrap(out.join(' · '));
  }
  return null;
}

export function hasTranslation(s) {
  return lookup(String(s), 0) !== null;
}

export function tr(text) {
  const s = String(text);
  if (lang === 'es') return s;
  let out = cache.get(s);
  if (out === undefined) {
    out = lookup(s, 0) ?? s;    if (cache.size > MAX_CACHE) cache.clear();
    cache.set(s, out);
  }
  return out;
}
