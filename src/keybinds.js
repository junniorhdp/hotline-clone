// Controles de PC reasignables. Cada acción tiene hasta dos entradas (principal y secundaria): un código de
// teclado de `KeyboardEvent.code` ('KeyW', 'Space', 'ArrowUp'…) o un botón del ratón ('Mouse0' = izquierdo,
// 'Mouse1' = central, 'Mouse2' = derecho). El juego NUNCA compara códigos fijos para estas acciones: pregunta a
// `game.keys` (`down`/`pressed`), que mira el mapa vigente. Los controles táctiles escriben "pulsaciones virtuales"
// (`input.virtualPress(acción)`), así siguen funcionando sea cual sea la asignación de PC.
// Se guardan en `localStorage` dentro de `neonrush.settings.v1` (clave `keys`; ver settings.js) con lectura defensiva.
//
// Fijos (no reasignables): Esc (pausa / volver), Enter y Espacio en los menús, R reintentar, M silencio, V efectos,
// T récords y F1 debug; por eso esas teclas no se aceptan en una acción (`RESERVED`), salvo Espacio, que sí.

export const KEY_ACTIONS = [
  { id: 'moveUp', label: 'ARRIBA', group: 'MOVIMIENTO' },
  { id: 'moveDown', label: 'ABAJO', group: 'MOVIMIENTO' },
  { id: 'moveLeft', label: 'IZQUIERDA', group: 'MOVIMIENTO' },
  { id: 'moveRight', label: 'DERECHA', group: 'MOVIMIENTO' },
  { id: 'attack', label: 'ATACAR/DISPARAR', group: 'ACCIONES' },
  { id: 'throw', label: 'LANZAR/RECOGER', group: 'ACCIONES' },
  { id: 'kick', label: 'PATEAR/INTERACTUAR', group: 'ACCIONES' },
  { id: 'execute', label: 'REMATAR', group: 'ACCIONES' },
];

// Por defecto: WASD + flechas, clic izquierdo para atacar, clic derecho para lanzar/recoger, Espacio o F para patear
// (y rematar, si hay un derribado a tiro) y E para rematar. El forcejeo se aporrea con ATACAR, PATEAR o REMATAR.
export const KEY_CONFIG = {
  moveUp: ['KeyW', 'ArrowUp'],
  moveDown: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  attack: ['Mouse0', null],
  throw: ['Mouse2', null],
  kick: ['Space', 'KeyF'],
  execute: ['KeyE', null],
};

export const RESERVED = new Set(['Escape', 'Enter', 'NumpadEnter', 'F1', 'KeyR', 'KeyM', 'KeyV', 'KeyT']);
const VALID = /^(Key[A-Z]|Digit\d|Numpad\w+|F\d{1,2}|Mouse[012]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Tab|Backspace|Backquote|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|Insert|Delete|Home|End|Page(Up|Down))$/;

const NAMES = {
  Mouse0: 'CLIC IZQ', Mouse1: 'CLIC MED', Mouse2: 'CLIC DER', Space: 'ESPACIO',
  ArrowUp: 'FL.ARRIBA', ArrowDown: 'FL.ABAJO', ArrowLeft: 'FL.IZQ', ArrowRight: 'FL.DER',
  ShiftLeft: 'SHIFT IZQ', ShiftRight: 'SHIFT DER', ControlLeft: 'CTRL IZQ', ControlRight: 'CTRL DER',
  AltLeft: 'ALT IZQ', AltRight: 'ALT DER', Tab: 'TAB', Backspace: 'RETROCESO', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Insert: 'INSERT', Delete: 'SUPR', Home: 'INICIO', End: 'FIN', PageUp: 'RE PAG', PageDown: 'AV PAG',
};

// Texto corto para mostrar una entrada (para los menús y los avisos de pantalla).
export function keyLabel(code) {
  if (!code) return '---';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6).toUpperCase();
  return code.toUpperCase();
}

const clone = (cfg) => Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, [...v]]));

export class KeyBinds {
  constructor(input) {
    this.input = input;
    this.map = clone(KEY_CONFIG);
    this.onChange = null; // lo pone Game para guardar en settings
    this.syncBlocked();
  }

  // --- Lectura ------------------------------------------------------------------------------------
  isDown(code) {
    const m = this.input.mouse;
    if (code === 'Mouse0') return m.left;
    if (code === 'Mouse1') return !!m.middle;
    if (code === 'Mouse2') return m.right;
    return this.input.down(code);
  }

  isPressed(code) {
    const p = this.input.mousePressed;
    if (code === 'Mouse0') return p.left;
    if (code === 'Mouse1') return !!p.middle;
    if (code === 'Mouse2') return p.right;
    return this.input.wasPressed(code);
  }

  codes(action) {
    return this.map[action].filter(Boolean);
  }

  down(action) {
    return this.codes(action).some((c) => this.isDown(c));
  }

  // Pulsada desde el último paso (o con una pulsación virtual del táctil).
  pressed(action) {
    return this.input.vpressed.has(action) || this.codes(action).some((c) => this.isPressed(c));
  }

  // Etiqueta de la entrada principal (o la secundaria, si la principal falta): para avisos en pantalla.
  label(action) {
    return keyLabel(this.map[action][0] || this.map[action][1]);
  }

  // --- Cambios ------------------------------------------------------------------------------------
  find(code, skipAction, skipSlot) {
    for (const a of KEY_ACTIONS) {
      for (let s = 0; s < 2; s++) {
        if (this.map[a.id][s] === code && !(a.id === skipAction && s === skipSlot)) return { action: a.id, slot: s };
      }
    }
    return null;
  }

  // Asigna `code` a la ranura `slot` (0 principal, 1 secundaria) de `action`. Devuelve:
  //   { status: 'ok' }                       asignada
  //   { status: 'swap', other }              estaba en otra acción: se intercambian (la otra recibe la anterior)
  //   { status: 'reserved' | 'invalid' | 'blocked' | 'dup' }  rechazada (nada cambia)
  assign(action, slot, code) {
    if (!VALID.test(code)) return { status: 'invalid' };
    if (RESERVED.has(code)) return { status: 'reserved' };
    const cur = this.map[action][slot];
    if (cur === code) return { status: 'ok' };
    const other = this.find(code, action, slot);
    if (other) {
      if (other.action === action) return { status: 'dup' }; // ya está en la otra ranura de esta misma acción
      // La principal de una acción nunca puede quedarse vacía: si el intercambio la vaciaría, se rechaza.
      if (!cur && other.slot === 0) return { status: 'blocked', other: other.action };
      this.map[other.action][other.slot] = cur;
      this.map[action][slot] = code;
      this.changed();
      return { status: 'swap', other: other.action, otherSlot: other.slot };
    }
    this.map[action][slot] = code;
    this.changed();
    return { status: 'ok' };
  }

  // Quita la entrada secundaria (la principal no se puede dejar vacía).
  clear(action, slot) {
    if (slot === 0 || !this.map[action][slot]) return false;
    this.map[action][slot] = null;
    this.changed();
    return true;
  }

  reset() {
    this.map = clone(KEY_CONFIG);
    this.changed();
  }

  changed() {
    this.syncBlocked();
    if (this.onChange) this.onChange();
  }

  // Evita que el navegador haga su acción por defecto (scroll con Espacio o flechas, buscar con Tab…) en las teclas asignadas.
  syncBlocked() {
    for (const a of KEY_ACTIONS) for (const c of this.map[a.id]) if (c && !c.startsWith('Mouse')) this.input.block(c);
  }

  // --- Persistencia (la guarda Settings) ------------------------------------------------------------
  toJSON() {
    return clone(this.map);
  }

  // Lectura defensiva: lo que falte o sea inválido usa el valor por defecto; si queda una tecla repetida entre
  // acciones, o una principal vacía, se descarta todo y se usan los valores por defecto.
  load(saved) {
    const next = clone(KEY_CONFIG);
    if (saved && typeof saved === 'object') {
      for (const a of KEY_ACTIONS) {
        const v = saved[a.id];
        if (!Array.isArray(v)) continue;
        const ok = (c) => typeof c === 'string' && VALID.test(c) && !RESERVED.has(c);
        if (ok(v[0])) next[a.id][0] = v[0];
        next[a.id][1] = v[1] === null ? null : ok(v[1]) ? v[1] : next[a.id][1];
      }
    }
    const seen = new Set();
    let bad = false;
    for (const a of KEY_ACTIONS) for (const c of next[a.id]) { if (!c) continue; if (seen.has(c)) bad = true; seen.add(c); }
    this.map = bad ? clone(KEY_CONFIG) : next;
    this.syncBlocked();
  }
}
