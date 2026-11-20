import { clamp } from './utils.js';
import { MASKS } from './masks.js';

// Ajustes del jugador: una lista DECLARATIVA (`OPTIONS`) + un gestor (`Settings`) que la guarda en
// localStorage (`neonrush.settings.v1`) con lectura defensiva y valores por defecto.
//
// Para añadir una opción basta con añadir un objeto a OPTIONS; el menú (options-menu.js) se genera solo:
//   { id, section, label, type, default, apply(game, valor) }
//   type 'toggle'  → boolean (se muestra SÍ / NO)
//   type 'step'    → número entre `min` y `max` de `step` en `step` (`format(valor)` da el texto)
//   type 'choice'  → uno de `choices: [{ label, value }]` (el valor guardado es `value`)
//   `migrate(valorGuardado)` (opcional) convierte valores de versiones antiguas antes de validarlos
// `apply` se llama al cambiar la opción y una vez al arrancar (`applyAll`) para que el valor guardado
// surta efecto. Quien necesite el valor en caliente puede leerlo con `game.settings.get(id)`.
export const SETTINGS_KEY = 'neonrush.settings.v1';
// Máscaras desbloqueadas (`unlockedMasks` dentro de neonrush.settings.v1): NEON y BRUTE de serie; STRIKE, BLADE y GHOST se ganan
// abatiendo a su portador (pisos 2, 3 y 4). Nunca se pierden (ni con RESTAURAR). Lectura defensiva: solo ids válidos y las de serie siempre.
export const DEFAULT_UNLOCKED = MASKS.filter((m) => !m.lockFloor && !m.secret).map((m) => m.id); // (las secretas se encuentran: ver Game.lootRick)

export const OPTIONS = [
  // --- Audio: se conectan a los buses de audio.js (el mute rápido M sigue funcionando por encima) ---
  { id: 'musicVolume', section: 'AUDIO', label: 'MÚSICA', type: 'step', min: 0, max: 100, step: 10, default: 100,
    format: (v) => `${v}%`, apply: (g, v) => g.sfx.setVolumes({ music: v / 100 }) },
  { id: 'sfxVolume', section: 'AUDIO', label: 'EFECTOS', type: 'step', min: 0, max: 100, step: 10, default: 100,
    format: (v) => `${v}%`, apply: (g, v) => g.sfx.setVolumes({ sfx: v / 100 }) },
  // --- Jugabilidad / visual ---
  // Sin sangre: no hay manchas en suelo ni paredes, ni huellas, ni sangre sobre el personaje; las bajas
  // sueltan chispas de neón y humo. Lo leen game.js (`goreOn`) y el HUD.
  // Agente (JACK / VEX): SOLO cosmético (sprite, retrato del duelo VS y voz); mismas estadísticas. Se elige también
  // en la pantalla ELIGE TU MÁSCARA. Todas las ventajas jugables siguen siendo de las 5 máscaras.
  // OCULTA en el menú de opciones (`hidden`): el agente se elige en la pantalla ELIGE TU MÁSCARA antes de cada piso, que es donde se ve; el ajuste sigue guardándose aquí.
  { id: 'playerGender', section: 'JUEGO', label: 'AGENTE', type: 'choice', default: 'male', hidden: true,
    choices: [{ label: 'JACK', value: 'male' }, { label: 'VEX', value: 'female' }],
    apply: (g, v) => g.setGender(v) },
  // Luces estroboscópicas del piso 4 (el club): pulsos de color neón sobre la escena. Apagarlas deja el club
  // con su luz normal (recomendado con fotosensibilidad).
  { id: 'strobeEnabled', section: 'JUEGO', label: 'LUCES ESTROBOSCÓPICAS', type: 'toggle', default: true },
  // IA ENEMIGA: TONTOS (tardan más en reaccionar, preparan y espacian más los golpes y disparos, apuntan peor y ven menos) · PROMEDIO (el comportamiento de siempre) ·
  // GENIOS (reaccionan casi al instante, golpean y disparan antes y más seguido, apuntan fino y ven y te buscan más). Multiplicadores en `AI` (enemy.js). Afecta a la partida en curso.
  { id: 'aiLevel', section: 'JUEGO', label: 'IA ENEMIGA', type: 'choice', default: 'avg',
    choices: [{ label: 'BOBOS', value: 'dumber' }, { label: 'TONTOS', value: 'dumb' }, { label: 'PROMEDIO', value: 'avg' }, { label: 'GENIOS', value: 'genius' }],
    apply: (g, v) => g.setAiLevel(v) },
  // Sin la animación, la puerta principal se cierra al cruzar el umbral y se abre al despejar el piso al instante (como antes), sin que el agente se pare a cerrarla / abrirla.
  { id: 'doorAnim', section: 'JUEGO', label: 'ANIMACIÓN DE LA PUERTA', type: 'toggle', default: true },
  { id: 'goreEnabled', section: 'JUEGO', label: 'SANGRE', type: 'toggle', default: true,
    apply: (g) => g.refreshGore() },
  // --- Controles táctiles: escriben en `TouchControls.config` (TOUCH_CONFIG) ---
  { id: 'buttonScale', section: 'TÁCTIL', label: 'TAMAÑO BOTONES', type: 'choice', default: 1,
    choices: [{ label: 'PEQUEÑO', value: 0.85 }, { label: 'NORMAL', value: 1 }, { label: 'GRANDE', value: 1.2 }],
    apply: (g, v) => g.touch.setConfig({ buttonScale: v }) },
  { id: 'buttonOpacity', section: 'TÁCTIL', label: 'OPACIDAD BOTONES', type: 'choice', default: 1,
    choices: [{ label: 'BAJA', value: 0.5 }, { label: 'MEDIA', value: 0.75 }, { label: 'ALTA', value: 1 }],
    apply: (g, v) => g.touch.setConfig({ buttonOpacity: v }) },
  // Joystick derecho: apuntar y disparar comparten el dedo, así que el disparo solo ocurre al llevarlo al
  // borde (`fireThreshold`): BORDE (0,85, lo más seguro para apuntar), FÁCIL (0,6) o NO (el joystick solo
  // apunta; se dispara con ATACAR, tocando el joystick o con DISPARO AUTOMÁTICO).
  { id: 'stickFire', section: 'TÁCTIL', label: 'DISPARO CON JOYSTICK', type: 'choice', default: 0.85,
    choices: [{ label: 'BORDE', value: 0.85 }, { label: 'FÁCIL', value: 0.6 }, { label: 'NO', value: 2 }],
    apply: (g, v) => g.touch.setConfig({ fireThreshold: v }) },
  // Disparo automático: mientras apuntas (joystick derecho) a un enemigo a tiro, ataca solo; no hace falta
  // llegar al borde del joystick. Pensado para quien le cuesta disparar; funciona con cualquier nivel de asistencia.
  { id: 'autoFire', section: 'TÁCTIL', label: 'DISPARO AUTOMÁTICO', type: 'toggle', default: false,
    apply: (g, v) => g.touch.setConfig({ autoFire: v }) },
  { id: 'hapticsEnabled', section: 'TÁCTIL', label: 'VIBRACIÓN', type: 'toggle', default: true,
    apply: (g, v) => g.touch.setConfig({ hapticsEnabled: v }) },
  // Asistencia de apuntado: OFF = manual puro · SUAVE = ligero magnetismo · ALTO = soft lock-on con marcador
  // sobre el enemigo fijado (por defecto en táctil). Los valores numéricos son los de TOUCH_CONFIG.aimAssist.
  { id: 'aimAssist', section: 'TÁCTIL', label: 'ASISTENCIA DE APUNTADO', type: 'choice', default: 1,
    choices: [{ label: 'OFF', value: 0 }, { label: 'SUAVE', value: 0.5 }, { label: 'ALTO', value: 1 }],
    // Versión anterior: era un sí/no (true = 0,5).
    migrate: (v) => (v === true ? 0.5 : v === false ? 0 : v),
    apply: (g, v) => g.touch.setConfig({ aimAssist: v }) },
];

// Valor válido para `opt` a partir de lo que haya (guardado, corrupto o de una versión antigua).
export function sanitize(opt, v) {
  if (opt.migrate) v = opt.migrate(v);
  if (opt.type === 'toggle') return typeof v === 'boolean' ? v : opt.default;
  if (opt.type === 'step') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return opt.default;
    return clamp(Math.round((v - opt.min) / opt.step) * opt.step + opt.min, opt.min, opt.max);
  }
  if (opt.type === 'choice') return opt.choices.some((c) => c.value === v) ? v : opt.default;
  return opt.default;
}

// Texto del valor actual de una opción (para el menú).
export function valueText(opt, v) {
  if (opt.type === 'toggle') return v ? 'SÍ' : 'NO';
  if (opt.type === 'step') return opt.format ? opt.format(v) : String(v);
  return (opt.choices.find((c) => c.value === v) || opt.choices[0]).label;
}

export class Settings {
  constructor(game) {
    this.game = game;
    this.values = {};
    for (const o of OPTIONS) this.values[o.id] = o.default;
    this.unlocked = new Set(DEFAULT_UNLOCKED);
    this.load();
  }

  get(id) {
    return this.values[id];
  }

  isMaskUnlocked(id) {
    return this.unlocked.has(id);
  }

  // Desbloquea una máscara de forma permanente. Devuelve true si era nueva.
  unlockMask(id) {
    if (this.unlocked.has(id) || !MASKS.some((m) => m.id === id)) return false;
    this.unlocked.add(id);
    this.save();
    return true;
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      const src = saved && typeof saved === 'object' && saved.values && typeof saved.values === 'object' ? saved.values : {};
      for (const o of OPTIONS) if (o.id in src) this.values[o.id] = sanitize(o, src[o.id]);
      this.game.keys.load(saved && saved.keys);
      const ids = new Set(MASKS.map((m) => m.id));
      if (saved && Array.isArray(saved.unlockedMasks)) for (const id of saved.unlockedMasks) if (ids.has(id)) this.unlocked.add(id); // controles de PC (keybinds.js); sin nada guardado = valores por defecto
    } catch { /* sin acceso o JSON corrupto: valores por defecto */ }
  }

  save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, values: this.values, keys: this.game.keys.toJSON(), unlockedMasks: [...this.unlocked] })); } catch { /* cuota o modo privado */ }
  }

  // Aplica todos los ajustes (arranque y restaurar).
  applyAll() {
    for (const o of OPTIONS) o.apply?.(this.game, this.values[o.id]);
  }

  set(id, value) {
    const opt = OPTIONS.find((o) => o.id === id);
    if (!opt) return;
    this.values[id] = sanitize(opt, value);
    this.save();
    opt.apply?.(this.game, this.values[id]);
  }

  // Un paso en la dirección `dir` (±1). Los toggles se invierten; en step/choice, `wrap` da la
  // vuelta al llegar al extremo (Enter / tocar), mientras que las flechas se quedan en el tope.
  adjust(id, dir, wrap = false) {
    const opt = OPTIONS.find((o) => o.id === id);
    if (!opt) return;
    const v = this.values[id];
    if (opt.type === 'toggle') return this.set(id, !v);
    if (opt.type === 'step') {
      let n = v + dir * opt.step;
      if (n > opt.max) n = wrap ? opt.min : opt.max;
      if (n < opt.min) n = wrap ? opt.max : opt.min;
      return this.set(id, n);
    }
    const i = Math.max(0, opt.choices.findIndex((c) => c.value === v));
    let n = i + dir;
    if (n >= opt.choices.length) n = wrap ? 0 : opt.choices.length - 1;
    if (n < 0) n = wrap ? opt.choices.length - 1 : 0;
    this.set(id, opt.choices[n].value);
  }

  reset() {
    for (const o of OPTIONS) if (!o.hidden) this.values[o.id] = o.default; // (el agente elegido no se restaura)
    this.save();
    this.applyAll();
  }
}
