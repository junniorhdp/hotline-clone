// Top 5 histórico de partidas, persistido en localStorage de forma tolerante a fallos.
//
// Formato guardado (clave STORAGE_KEY, JSON):
//   { version: 1, entries: [ { id, score, floor, completed, combo, mask, maskName, date } ] }
//   - id        identificador de la partida (una partida = una entrada; se actualiza al avanzar)
//   - score     puntuación total acumulada (entero ≥ 0)
//   - floor     piso máximo alcanzado (1..N) o null en entradas heredadas
//   - completed true si se completó el edificio entero
//   - combo     combo máximo de la partida
//   - mask      id de la máscara usada en el último piso, maskName su nombre visible
//   - date      marca de tiempo (ms desde 1970) o null en entradas heredadas
//
// Datos antiguos: si no existe la clave nueva pero sí `neonrush.highscore` (versión anterior,
// un único número), se migra como una entrada "heredada". Cualquier JSON corrupto o entrada
// inválida se descarta en la lectura; nunca se escribe nada que no sea el formato válido.
const STORAGE_KEY = 'neonrush.scores.v1';
const LEGACY_KEY = 'neonrush.highscore';
const VERSION = 1;
export const MAX_ENTRIES = 5;

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null; // acceso bloqueado (privacidad, iframes, etc.)
  }
}

function toInt(v, min, max) {
  // Ojo: Number(null) y Number('') valen 0; un campo ausente debe quedarse en null.
  if (v === null || v === undefined || v === '') return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function toText(v, maxLen) {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, maxLen) : null;
}

// Devuelve una entrada saneada o null si no es aprovechable.
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const score = toInt(raw.score, 0, 1e9);
  const id = toText(raw.id, 40);
  if (score === null || !id) return null;
  return {
    id,
    score,
    floor: toInt(raw.floor, 1, 99),
    completed: raw.completed === true,
    combo: toInt(raw.combo, 0, 999) ?? 0,
    mask: toText(raw.mask, 16),
    maskName: toText(raw.maskName, 16),
    date: toInt(raw.date, 0, 8.64e15),
  };
}

function sortAndTrim(entries) {
  return entries
    .sort((a, b) => b.score - a.score || (a.date ?? 0) - (b.date ?? 0))
    .slice(0, MAX_ENTRIES);
}

export class ScoreHistory {
  constructor() {
    this.entries = this.load();
  }

  load() {
    const ls = storage();
    if (!ls) return [];
    let raw = null;
    try {
      raw = ls.getItem(STORAGE_KEY);
    } catch {
      return [];
    }
    if (raw === null) return this.migrateLegacy(ls);
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data?.entries) ? data.entries : [];
      return sortAndTrim(list.map(sanitize).filter(Boolean));
    } catch {
      return []; // JSON corrupto: se ignora y se sobrescribe en el siguiente guardado
    }
  }

  migrateLegacy(ls) {
    let legacy = 0;
    try {
      legacy = toInt(ls.getItem(LEGACY_KEY), 1, 1e9) ?? 0;
    } catch {
      legacy = 0;
    }
    if (!legacy) return [];
    const entries = [{ id: 'legacy', score: legacy, floor: null, completed: false, combo: 0, mask: null, maskName: null, date: null }];
    this.entries = entries;
    this.save();
    return entries;
  }

  save() {
    const ls = storage();
    if (!ls) return false;
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, entries: this.entries }));
      return true;
    } catch {
      return false; // cuota llena o almacenamiento bloqueado: el récord dura solo esta sesión
    }
  }

  best() {
    return this.entries.length ? this.entries[0].score : 0;
  }

  // Guarda (o actualiza) la entrada de una partida. Devuelve su puesto (1..5) o 0 si no entra.
  record(entry) {
    const clean = sanitize(entry);
    if (!clean) return 0;
    this.entries = sortAndTrim([...this.entries.filter((e) => e.id !== clean.id), clean]);
    this.save();
    return this.positionOf(clean.id);
  }

  positionOf(id) {
    return this.entries.findIndex((e) => e.id === id) + 1;
  }
}

export function newRunId() {
  return `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// "12/11/26 14:05" (sin depender del idioma del navegador).
export function formatDate(ms) {
  if (ms === null || ms === undefined) return 'ANTERIOR';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// --- Estadísticas por piso (desbloqueo, mejor rango y mejor puntuación) -----------------
//
// Clave FLOORS_KEY, JSON: { version: 1, floors: { "1": { completed, bestRank, bestScore } } }
// El piso 1 siempre está desbloqueado; el piso N se desbloquea al completar el N-1.
const FLOORS_KEY = 'neonrush.floors.v1';
const RANK_ORDER = ['S', 'A', 'B', 'C'];

export class FloorStats {
  constructor() {
    this.floors = this.load();
  }

  load() {
    const ls = storage();
    if (!ls) return {};
    try {
      const data = JSON.parse(ls.getItem(FLOORS_KEY) || 'null');
      const out = {};
      if (data && typeof data.floors === 'object') {
        for (const [key, raw] of Object.entries(data.floors)) {
          const n = toInt(key, 1, 99);
          if (!n || !raw || typeof raw !== 'object') continue;
          out[n] = {
            completed: raw.completed === true,
            bestRank: RANK_ORDER.includes(raw.bestRank) ? raw.bestRank : null,
            bestScore: toInt(raw.bestScore, 0, 1e9) ?? 0,
          };
        }
      }
      return out;
    } catch {
      return {}; // JSON corrupto: se ignora y se sobrescribe al guardar
    }
  }

  save() {
    const ls = storage();
    if (!ls) return;
    try {
      ls.setItem(FLOORS_KEY, JSON.stringify({ version: VERSION, floors: this.floors }));
    } catch {
      // sin almacenamiento: las estadísticas duran solo esta sesión
    }
  }

  get(n) {
    return this.floors[n] || { completed: false, bestRank: null, bestScore: 0 };
  }

  isUnlocked(n) {
    return n === 1 || this.get(n - 1).completed;
  }

  // Al completar un piso: lo marca y guarda el mejor rango (S > A > B > C) y puntuación.
  record(n, rank, score) {
    const prev = this.get(n);
    const better = !prev.bestRank || RANK_ORDER.indexOf(rank) < RANK_ORDER.indexOf(prev.bestRank);
    this.floors[n] = {
      completed: true,
      bestRank: better ? rank : prev.bestRank,
      bestScore: Math.max(prev.bestScore, Math.floor(score)),
    };
    this.save();
  }
}
