import { drawText, measureText, CELL_H } from './pixelfont.js';
import { pixelDisc } from './sprites.js';
import { COLORS, angleDiff, clamp } from './utils.js';
import { lineOfSight } from './map.js';

// Controles táctiles: dos joysticks flotantes + botones, dibujados en pixel art.
// Traducen los dedos de `input.touches` a los controles que ya entiende el juego:
//   joystick izquierdo  → input.moveAxis (analógico, -1..1, con zona muerta reescalada; si el dedo
//                         se sale del círculo, el círculo lo sigue)
//   joystick derecho    → input.aimAngle / aimActive: arrastrarlo solo APUNTA; llevarlo al borde
//                         (más allá de `fireThreshold`) ataca/dispara a la cadencia del arma
//                         (input.aimFiring). Un toque rápido que no llega a disparar = un ataque.
//                         Con `aimAssist` la mira se ajusta un poco hacia el enemigo cercano.
// Botones de la derecha, de abajo a arriba, sin texto (iconos de píxeles, ver ICONS):
//   ATACAR (retícula)   → botón inteligente (`game.touchAction()`): tocar = un ataque (input.tapAttack);
//                         mantener = input.attackHeld. Con un derribado a tiro REMATA (el ataque ya
//                         ejecuta), con una puerta delante la PATEA (con armas de fuego envía E en vez
//                         de disparar) y, con el edificio limpio junto a la moto, se sube y se va. El
//                         toque rápido del joystick derecho hace lo mismo.
//   LANZAR (arma en vuelo) → clic derecho (recoger / lanzar)
//   PATEAR (bota)       → la tecla E según el contexto (`contextAction`): remata a un derribado (bota
//                         parpadeando rojo/blanco), patea la puerta de enfrente o, con el edificio limpio
//                         junto a la moto, se sube y se va (el icono pasa a doble chevron cian).
//   REINICIAR           → tecla R
// Fuera de la partida (menús, máscaras, resultados…) un toque equivale a un clic en ese punto.
// Los tamaños se definen en píxeles CSS (tamaño real del dedo) y se pasan a píxeles internos.

// Preferencias táctiles: un único objeto con los valores por defecto. La persistencia y el menú de opciones
// los lleva settings.js, que escribe aquí con `TouchControls.setConfig({...})` (buttonScale, buttonOpacity,
// hapticsEnabled, aimAssist) al arrancar y cuando el jugador cambia un ajuste. Todo el dibujo y la detección
// de toques leen de `TouchControls.config`, así que los cambios se ven en caliente.
export const TOUCH_CONFIG = {
  joystickRadius: 56,   // px CSS: radio de ambos joysticks
  buttonScale: 1,       // multiplica el alto de los botones (0,7..1,6)
  buttonOpacity: 1,     // multiplica su opacidad (0,3..1)
  aimAssist: 1,         // 0 = OFF, 0,5 = SUAVE, 1 = ALTO (soft lock-on; ver `assistAngle`)
  autoFire: false,      // dispara solo mientras el joystick derecho apunta a un enemigo a tiro (ver `autoFireWants`)
  hapticsEnabled: true, // vibración breve en botones, disparos, ejecuciones y muerte
  moveDeadzone: 0.12,   // fracción del radio: por debajo no hay movimiento
  aimDeadzone: 0.15,    // fracción del radio: por debajo no se cambia la mirada
  fireThreshold: 0.85,  // fracción del radio: más allá (borde exterior) ataca; > 1 = el joystick nunca dispara
};

const BUTTON_CSS_HEIGHT = 48;
const HOLD_FIRE_HYSTERESIS = 0.1; // al soltar hacia dentro, deja de atacar 0,1 del radio antes
const TAP_MAX = 0.25;          // s: un toque más corto que esto (sin disparar) es un ataque
const ACT_BUFFER = 0.25;       // s que se recuerda un PATEAR/REMATAR pulsado en plena cadencia
const PRESS_FLASH = 0.15;      // s de resaltado tras pulsar un botón
const HAPTIC_FIRE_GAP = 0.12;  // s mínimos entre vibraciones mientras se dispara
// Niveles de asistencia de apuntado: cono angular (rad), fuerza del tirón (0..1) y alcance (u del mundo).
const ASSIST_LEVELS = {
  soft: { cone: 0.3, pull: 0.35, range: 360 },
  high: { cone: 0.7, pull: 0.9, range: 440 },
};
const MARGIN = 6;
const GAMEPLAY = new Set(['playing', 'cleared', 'scuffle']);

const ICON_COLOR = '#ff2e55'; // rojo neón (el blanco va fijo en las 'o')
const inside = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

// Iconos de los botones de la derecha: cuadrículas generadas por código ('#' = color del botón,
// 'o' = blanco). Se dibujan a escala entera y en posiciones enteras, así salen nítidos en cualquier pantalla.
function makeIcon(n, plot) {
  const g = Array.from({ length: n }, () => Array(n).fill('.'));
  plot((x, y, c = '#') => { if (x >= 0 && y >= 0 && x < n && y < n) g[y][x] = c; });
  return g.map((r) => r.join(''));
}
export const ICONS = {
  // Retícula: anillo con cuatro marcas y punto central.
  attack: [
    '.....#.....',
    '.....#.....',
    '...#####...',
    '..#.....#..',
    '..#.....#..',
    '###..o..###',
    '..#.....#..',
    '..#.....#..',
    '...#####...',
    '.....#.....',
    '.....#.....',
  ],
  // Arma en vuelo: hoja en diagonal con la punta clara y estelas de velocidad.
  throw: makeIcon(11, (p) => {
    for (let i = 0; i <= 7; i++) { p(10 - i, i); p(9 - i, i); p(8 - i, i + 1); }
    p(10, 0, 'o'); p(9, 0, 'o'); p(10, 1, 'o');
    p(2, 8); p(1, 9); p(2, 9); p(3, 8);
    for (const [x, y] of [[3, 2], [4, 2], [0, 5], [1, 5], [2, 5], [0, 8]]) p(x, y, 'o');
  }),
  // Bota de perfil con la suela clara y dos rayas de impulso.
  kick: [
    '...####....',
    '...####....',
    '...####....',
    'oo.####....',
    'oo.#####...',
    '...######..',
    '...#######.',
    'oo.########',
    '..#########',
    '..ooooooooo',
    '...........',
  ],
  // Pausa: dos barras.
  pause: makeIcon(11, (p) => { for (let y = 1; y < 10; y++) for (const x of [2, 3, 4, 6, 7, 8]) p(x, y); }),
  // Doble chevron: interactuar / subir a la moto.
  mount: makeIcon(11, (p) => {
    for (let i = 0; i < 5; i++) for (const o of [0, 5]) { p(o + i, 1 + i); p(o + i, 9 - i); p(o + i + 1, 1 + i); p(o + i + 1, 9 - i); }
  }),
};

function drawIcon(ctx, rows, cx, cy, k, color) {
  const n = rows.length;
  const x0 = Math.round(cx - (n * k) / 2), y0 = Math.round(cy - (n * k) / 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (c === '.') continue;
      ctx.fillStyle = c === 'o' ? '#ffffff' : color;
      ctx.fillRect(x0 + x * k, y0 + y * k, k, k);
    }
  }
}

// Botón táctil pixel art: fondo oscuro, borde de 1 px (rosa al pulsarlo) y texto centrado.
// `press` (0..1) es el pulso tras tocarlo: crece hasta 2 px y se ilumina.
export function drawTouchButton(ctx, b, lit, alpha = 0.55, press = 0) {
  const grow = Math.round(press * 2);
  const x = b.x - grow, y = b.y - grow, w = b.w + grow * 2, h = b.h + grow * 2;
  ctx.globalAlpha = lit ? 0.95 : alpha;
  ctx.fillStyle = press > 0 ? '#2a1546' : '#140a24';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = lit ? COLORS.wall : b.accent || '#3a2a55';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  ctx.globalAlpha = lit ? 1 : Math.min(1, alpha + 0.25);
  if (b.icon) {
    // Icono a escala entera: ocupa ~60 % del lado menor del botón.
    const k = Math.max(1, Math.floor((Math.min(w, h) * 0.6) / b.icon.length));
    drawIcon(ctx, b.icon, x + w / 2, y + h / 2, k, lit ? '#ffffff' : b.iconColor || ICON_COLOR);
  } else {
    drawText(ctx, b.label, x + w / 2, y + Math.round((h - CELL_H) / 2) - 1,
      { color: lit ? COLORS.text : b.textColor || '#c9bce6', align: 'center' });
  }
  ctx.globalAlpha = 1;
}

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.config = { ...TOUCH_CONFIG };
    this.move = null;   // { id, ox, oy, x, y } en píxeles internos
    this.aim = null;
    this.roles = new Map();
    this.flash = {};    // botón → segundos de resaltado tras pulsarlo
    this.action = { id: 'attack', label: 'ATACAR', ready: false }; // acción contextual vigente
    this.actBuffer = 0;
    this.actAction = 'kick'; // acción que se reintenta con el buffer (kick | execute)
    this.lock = null;        // enemigo fijado por la asistencia (se marca en pantalla)
    this.pendingLock = null;
    this.hapticTimer = 0;
    this.prev = { exec: false, alive: true, firing: false };
  }

  // Medida en píxeles CSS → píxeles internos de la escena.
  px(css) {
    return (css * this.game.dpr) / this.game.view.scale;
  }

  setConfig(patch) {
    Object.assign(this.config, patch);
  }

  // Vibración breve (Android; iOS no la soporta). Respeta `hapticsEnabled`.
  haptic(pattern) {
    if (!this.config.hapticsEnabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try { navigator.vibrate(pattern); } catch { /* bloqueada por el navegador */ }
  }

  // Márgenes = MARGIN + zona segura del sistema (muesca, barra de inicio): nada táctil
  // queda debajo de ellas. Junto al pulgar derecho: ATACAR (grande, en la esquina) y LANZAR justo encima.
  layout() {
    const { width: w, height: h } = this.game.scene;
    const s = this.game.safe, cfg = this.config;
    const left = MARGIN + s.l, right = w - MARGIN - s.r, bottom = h - MARGIN - s.b;
    const bh = Math.max(16, Math.round(this.px(BUTTON_CSS_HEIGHT * cfg.buttonScale)));
    const rh = Math.max(14, Math.round(bh * 0.75));
    // De abajo a arriba, alineados al borde derecho: ATACAR (principal, grande, en la esquina), LANZAR y
    // PATEAR/INTERACTUAR. Sin texto: los iconos los distinguen (ver ICONS). Son casi cuadrados.
    const ah = Math.round(bh * 1.3), aw = Math.round(ah * 1.25);
    const bw = Math.round(bh * 1.25);
    const attack = { id: 'attack', icon: ICONS.attack, x: right - aw, y: bottom - ah, w: aw, h: ah, accent: COLORS.enemyBullet };
    const throwB = { id: 'throw', icon: ICONS.throw, x: right - bw, y: attack.y - 6 - bh, w: bw, h: bh };
    const actB = { id: 'act', icon: this.action.id === 'mount' ? ICONS.mount : ICONS.kick, x: right - bw, y: throwB.y - 6 - bh, w: bw, h: bh };
    return {
      left, right, bottom,
      stickR: Math.max(16, Math.round(this.px(cfg.joystickRadius))),
      buttons: [
        attack, throwB, actB,
        // Debajo de la miniatura de la máscara del HUD.
        { id: 'retry', label: 'REINICIAR', x: left, y: 56 + s.t, w: measureText('REINICIAR') + 12, h: rh },
        // Pausa (= Esc): abre el menú de pausa con OPCIONES. Arriba a la DERECHA, justo bajo el HUD de puntos y piso y por encima de la columna
        // de botones (antes estaba bajo REINICIAR, junto a la máscara del HUD, donde estorbaba): no tapa nada y queda lejos del pulgar izquierdo.
        { id: 'pause', icon: ICONS.pause, x: right - rh, y: Math.max(40 + s.t, Math.min(68 + s.t, actB.y - rh - 4)), w: rh, h: rh },
      ],
    };
  }

  // Esquina superior izquierda de la columna de botones de la derecha (ATACAR / LANZAR / acción): los textos de la escena no deben taparla.
  rightColumn() {
    const L = this.layout(), col = L.buttons.slice(0, 3);
    return { x: Math.min(...col.map((b) => b.x)), y: Math.min(...col.map((b) => b.y)) };
  }

  // Tamaño estándar de un botón táctil de pantalla (en píxeles internos) para `label`.
  buttonSize(label) {
    const h = Math.max(16, Math.round(this.px(BUTTON_CSS_HEIGHT * 0.85 * this.config.buttonScale)));
    return { w: Math.max(h * 2, measureText(label) + 14), h };
  }

  reset() {
    this.move = this.aim = null;
    this.roles.clear();
    this.actBuffer = 0;
    this.lock = null;
    const input = this.game.input;
    input.moveAxis = { x: 0, y: 0 };
    input.aimActive = input.aimFiring = input.attackHeld = false;
  }

  press(id, touchId) {
    const g = this.game, input = g.input;
    this.flash[id] = PRESS_FLASH;
    this.haptic(12);
    // Si el toque patea o sube a la moto no cuenta como ATACAR mantenido (si no, dispararía a la vez).
    if (id === 'attack' && this.smartAttack()) this.roles.set(touchId, 'button:used');
    if (id === 'throw') input.virtualPress('throw');
    if (id === 'act') this.contextAction();
    if (id === 'retry') input.pressed.add('KeyR');
    if (id === 'pause') input.pressed.add('Escape');
  }

  // Botón superior (PATEAR / REMATAR / INTERACTUAR): la tecla E según el contexto. Con un derribado a
  // tiro lo remata, con el edificio limpio junto a la moto se sube y se va; si no, patea la puerta.
  contextAction() {
    const g = this.game, a = g.touchAction();
    if (a.id === 'mount') { g.startLeaving(); return; }
    if (a.id === 'execute') this.haptic(28);
    this.actAction = a.id === 'execute' ? 'execute' : 'kick';
    g.input.virtualPress(this.actAction);
    this.actBuffer = ACT_BUFFER; // si el arma sigue en cadencia, se reintenta en cuanto acabe
  }

  // Ataque unificado (botón ATACAR y toque rápido del joystick derecho): según el contexto sube a la
  // moto, patea la puerta (con arma de fuego, donde atacar dispararía; el cuerpo a cuerpo ya patea
  // solo) o ataca, y atacar con un derribado a tiro ya lo remata. Devuelve true si el toque se gastó
  // en patear o montar (no es un ataque).
  smartAttack() {
    const g = this.game, input = g.input, a = g.touchAction();
    if (a.id === 'mount') { g.startLeaving(); return true; }
    if (a.id === 'kick' && a.ready && !g.player.def.melee) {
      this.actAction = 'kick';
      input.virtualPress('kick');
      this.actBuffer = ACT_BUFFER; // si el arma sigue en cadencia, se reintenta en cuanto acabe
      return true;
    }
    if (a.id === 'execute') this.haptic(28);
    input.tapAttack = true;
    return false;
  }

  // Asistencia de apuntado (`config.aimAssist`: 0 = OFF, 0,5 = SUAVE, 1 = ALTO; ver ASSIST_LEVELS). Con un
  // enemigo vivo a la vista (sin paredes ni puertas de por medio) dentro de un cono alrededor de donde apunta el
  // dedo, la mira se inclina hacia él: SUAVE es un ligero magnetismo; ALTO es un soft lock-on (cono de ~40°,
  // casi se alinea del todo y engancha hasta más lejos). El cono se estrecha un poco con la distancia. Siempre
  // parte del ángulo crudo del dedo (no se acumula) y el objetivo anterior tiene prioridad mientras siga
  // dentro (no salta entre enemigos). El objetivo fijado queda en `this.lock` (lo dibuja game.drawLockMark).
  assistLevel() {
    const s = this.config.aimAssist;
    return s <= 0 ? null : s < 0.75 ? ASSIST_LEVELS.soft : ASSIST_LEVELS.high;
  }

  assistAngle(raw) {
    // Con disparo automático y sin asistencia se sigue detectando el objetivo (cono SUAVE) para saber a quién
    // disparar, pero sin mover la mira (`pull` solo se aplica si hay asistencia).
    const assist = this.assistLevel();
    const L = assist || (this.config.autoFire ? ASSIST_LEVELS.soft : null);
    const g = this.game, p = g.player;
    this.pendingLock = null;
    if (!L || !p || !p.alive) return raw;
    let best = null, bestDiff = 0, bestScore = Infinity;
    for (const e of g.enemies) {
      if (!e.alive || e.state === 'down') continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > L.range || d < 1) continue;
      const diff = angleDiff(Math.atan2(dy, dx), raw);
      const cone = L.cone * (1 - 0.4 * (d / L.range)) * (e === this.lock ? 1.2 : 1);
      if (Math.abs(diff) > cone) continue;
      if (!lineOfSight(g.map, p.x, p.y, e.x, e.y)) continue;
      const score = Math.abs(diff) + d / 2000 - (e === this.lock ? 0.12 : 0);
      if (score < bestScore) { best = e; bestDiff = diff; bestScore = score; }
    }
    if (!best) return raw;
    this.pendingLock = best;
    if (!assist) return raw;
    return raw + bestDiff * clamp(L.pull * (1 - 0.35 * Math.abs(bestDiff) / L.cone), 0, 0.95);
  }

  // ¿Hay que disparar solo? Hay un enemigo fijado, a tiro del arma (cuerpo a cuerpo: a su alcance; de fuego:
  // hasta 440 u) y, con arma de fuego, queda munición (no se gasta el "SIN MUNICIÓN" en vano).
  autoFireWants() {
    const e = this.lock, p = this.game.player;
    if (!e || !e.alive || !p.alive || p.exec) return false;
    const def = p.def, d = Math.hypot(e.x - p.x, e.y - p.y);
    if (def.melee) return d <= def.range + e.r + 4;
    return d <= Math.min(def.range ?? 440, 440) + 10 && p.weapon && p.weapon.ammo > 0;
  }

  // Se llama al principio de cada paso de simulación, antes de que el juego lea la entrada.
  update(dt) {
    const g = this.game, input = g.input, cfg = this.config;
    for (const id in this.flash) this.flash[id] = Math.max(0, this.flash[id] - dt);
    if (!input.touchMode) { if (this.move || this.aim) this.reset(); return; }

    if (!GAMEPLAY.has(g.state) || g.panel || g.comms.cur) {   // con una línea de comunicación en pantalla un toque es un clic (sin joysticks)
      if (this.move || this.aim || this.roles.size) this.reset();
      // Pantallas fuera de la partida: primero los botones táctiles de la pantalla (VOLVER,
      // TERMINAR…), que "pulsan" la tecla equivalente. Si no se toca ninguno: con el panel de
      // récords abierto, tocar lo cierra; en resultados, tocar continúa; en el resto, el toque
      // es un clic en ese punto (menús, tarjetas de máscara…).
      const buttons = g.screenButtons();
      for (const t of input.touches.values()) {
        if (!t.isNew) continue;
        const p = g.toInternal(t.x, t.y);
        const hit = buttons.find((b) => inside(b, p));
        if (hit) {
          input.pressed.add(hit.key);
          this.flash[hit.id] = PRESS_FLASH;
          this.haptic(10);
          continue;
        }
        if (g.showRecords) { input.pressed.add('Escape'); continue; }
        if (g.state === 'results') { input.pressed.add('Enter'); continue; }
        if (g.state === 'dead' || g.state === 'gameover') continue; // solo con sus botones
        input.mouse.x = t.x;
        input.mouse.y = t.y;
        input.mousePressed.left = true;
      }
      return;
    }

    this.action = g.touchAction();
    const L = this.layout();
    const half = g.scene.width / 2;
    let endedAim = null;
    for (const t of input.touches.values()) {
      const p = g.toInternal(t.x, t.y);
      if (t.isNew && !this.roles.has(t.id)) {
        const button = L.buttons.find((b) => inside(b, p));
        if (button) {
          this.roles.set(t.id, `button:${button.id}`);
          this.press(button.id, t.id);
        } else if (p.x < half && !this.move) {
          this.move = { id: t.id, ox: p.x, oy: p.y, x: p.x, y: p.y };
          this.roles.set(t.id, 'move');
        } else if (p.x >= half && !this.aim) {
          this.aim = { id: t.id, ox: p.x, oy: p.y, x: p.x, y: p.y, held: 0, fired: false, firing: false };
          this.roles.set(t.id, 'aim');
        } else {
          this.roles.set(t.id, 'ignored');
        }
      }
      for (const stick of [this.move, this.aim]) {
        if (stick && stick.id === t.id) { stick.x = p.x; stick.y = p.y; }
      }
      if (t.ended) {
        if (this.move && this.move.id === t.id) this.move = null;
        if (this.aim && this.aim.id === t.id) { endedAim = this.aim; this.aim = null; }
        this.roles.delete(t.id);
      }
    }

    // Joystick izquierdo flotante: si el dedo se sale del círculo, el círculo lo sigue, así el
    // pulgar nunca queda fuera del área útil y cambiar de dirección es igual de rápido en cualquier punto.
    const m = this.move;
    if (m) {
      const dx = m.x - m.ox, dy = m.y - m.oy, len = Math.hypot(dx, dy);
      if (len > L.stickR) { m.ox += (dx / len) * (len - L.stickR); m.oy += (dy / len) * (len - L.stickR); }
    }
    const vec = (s, dz) => {
      const dx = (s.x - s.ox) / L.stickR, dy = (s.y - s.oy) / L.stickR;
      const len = Math.hypot(dx, dy);
      return { dx, dy, len: Math.min(1, len), dir: len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 }, dz };
    };
    // Zona muerta reescalada: por debajo no hay movimiento y justo después la velocidad arranca
    // desde cero, sin escalón (el joystick conserva el control fino).
    if (m) {
      const v = vec(m, cfg.moveDeadzone);
      const mag = v.len <= cfg.moveDeadzone ? 0 : (v.len - cfg.moveDeadzone) / (1 - cfg.moveDeadzone);
      input.moveAxis = { x: v.dir.x * mag, y: v.dir.y * mag };
    } else {
      input.moveAxis = { x: 0, y: 0 };
    }
    // ATACAR mantenido (los dedos que se levantaron ya no tienen rol).
    input.attackHeld = [...this.roles.values()].includes('button:attack');

    // Joystick derecho:
    // - arrastrarlo solo APUNTA (no dispara): se puede mirar alrededor sin gastar balas;
    // - llevarlo al borde (más allá de `fireThreshold`) ataca a la cadencia del arma; al volver
    //   hacia dentro deja de atacar un poco antes (histéresis) para que no parpadee en el límite;
    // - un toque rápido (< TAP_MAX) que no llegó a disparar = un ataque en la dirección actual.
    if (this.aim) {
      this.aim.held += dt;
      const v = vec(this.aim, cfg.aimDeadzone);
      input.aimActive = true;
      if (v.len > cfg.aimDeadzone) {
        input.aimAngle = this.assistAngle(Math.atan2(v.dir.y, v.dir.x));
        this.lock = this.pendingLock;
      } else this.lock = null;
      const limit = this.aim.firing ? cfg.fireThreshold - HOLD_FIRE_HYSTERESIS : cfg.fireThreshold;
      this.aim.firing = v.len > limit;
      // Disparo automático: apuntar a un enemigo fijado a tiro dispara sin llegar al borde del joystick.
      const auto = cfg.autoFire && v.len > cfg.aimDeadzone && this.autoFireWants();
      input.aimFiring = this.aim.firing || auto;
      if (input.aimFiring) this.aim.fired = true;
    } else {
      input.aimActive = input.aimFiring = false;
      this.lock = null;
      if (endedAim && !endedAim.fired && endedAim.held < TAP_MAX) {
        const v = vec(endedAim, cfg.aimDeadzone);
        if (v.len > cfg.aimDeadzone) { input.aimAngle = this.assistAngle(Math.atan2(v.dir.y, v.dir.x)); input.aimActive = true; }
        this.smartAttack();
      }
    }

    // PATEAR (E) pulsado mientras el arma aún estaba en cadencia (E se pierde si el cooldown > 0).
    const p = g.player;
    if (this.actBuffer > 0) {
      this.actBuffer -= dt;
      if (p.alive && !p.exec && p.cooldown <= 0 && !input.vpressed.has(this.actAction)) {
        input.virtualPress(this.actAction);
        this.actBuffer = 0;
      }
    }

    // Háptica: pulso al empezar a atacar y cada HAPTIC_FIRE_GAP mientras dure, al empezar una
    // ejecución y al morir.
    this.hapticTimer -= dt;
    const firing = input.aimFiring || input.attackHeld;
    if (firing && (!this.prev.firing || this.hapticTimer <= 0)) { this.haptic(8); this.hapticTimer = HAPTIC_FIRE_GAP; }
    if (!!p.exec && !this.prev.exec) this.haptic(30);
    if (!p.alive && this.prev.alive) this.haptic([40, 30, 90]);
    this.prev = { exec: !!p.exec, alive: p.alive, firing };
  }

  // --- Dibujo (en píxeles internos, sobre el HUD) -------------------------------------------

  draw(ctx) {
    const g = this.game;
    if (!g.input.touchMode || !GAMEPLAY.has(g.state) || g.panel) return;
    const L = this.layout();
    const R = L.stickR;
    const op = this.config.buttonOpacity;
    const rightBase = L.buttons[0].x - R - 10;
    const now = performance.now();

    // Joysticks: si no se están usando, un círculo tenue indica dónde poner el pulgar.
    this.drawStick(ctx, this.move, L.left + R + 6, L.bottom - R - 6, R, COLORS.player, false);
    this.drawStick(ctx, this.aim, Math.min(rightBase, L.right - R), L.bottom - R - 6, R,
      g.input.aimFiring ? COLORS.blood : COLORS.wall, g.input.aimFiring, this.config.fireThreshold <= 1 ? this.config.fireThreshold : 0);

    const act = this.action;
    const blink = Math.floor(now / 110) % 2;
    for (const b of L.buttons) {
      const press = (this.flash[b.id] || 0) / PRESS_FLASH;
      const lit = press > 0 || (b.id === 'attack' && g.input.attackHeld);
      let alpha = b.id === 'attack' ? 0.7 : 0.55;
      // Forcejeo: ATACAR late en rojo/blanco para pedir que se aporree.
      if (b.id === 'attack' && g.state === 'scuffle') { b.accent = Math.floor(now / 90) % 2 ? '#ffffff' : ICON_COLOR; alpha = 1; }
      if (b.id === 'act') {
        // Botón superior: REMATAR parpadea rojo/blanco, MOTO en cian, PATEAR enciende el rosa si hay puerta.
        b.iconColor = act.id === 'mount' ? COLORS.player : ICON_COLOR;
        b.accent = act.id === 'execute' ? (blink ? '#ffffff' : ICON_COLOR) : act.id === 'mount' ? COLORS.player
          : act.id === 'interact' ? COLORS.enemy // contenedor, máquina, cabina o vagabundo a tiro: ámbar
          : act.ready ? COLORS.wall : undefined;
        alpha = act.ready ? 0.9 : 0.4;
      }
      drawTouchButton(ctx, b, lit, alpha * op, press);
    }
  }

  // Botones de las pantallas fuera de la partida (los define game.screenButtons()).
  drawScreenButtons(ctx) {
    for (const b of this.game.screenButtons()) {
      const press = (this.flash[b.id] || 0) / PRESS_FLASH;
      drawTouchButton(ctx, b, press > 0, 0.85, press);
    }
  }

  drawStick(ctx, stick, idleX, idleY, R, color, firing, ring = 0) {
    const active = !!stick;
    const ox = active ? stick.ox : idleX, oy = active ? stick.oy : idleY;
    ctx.globalAlpha = active ? 0.22 : 0.1;
    ctx.fillStyle = color;
    pixelDisc(ctx, ox, oy, R);
    ctx.globalAlpha = active ? 0.35 : 0.15;
    ctx.fillStyle = '#140a24';
    pixelDisc(ctx, ox, oy, R - 2);
    if (ring > 0) {
      // Anillo de puntos: más allá de él, el joystick ataca (así se aprende dónde está el límite).
      ctx.globalAlpha = active ? 0.5 : 0.25;
      ctx.fillStyle = color;
      const rr = R * ring, n = Math.max(12, Math.round(rr * 0.9));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.fillRect(Math.round(ox + Math.cos(a) * rr), Math.round(oy + Math.sin(a) * rr), 1, 1);
      }
    }
    if (active) {
      let dx = stick.x - ox, dy = stick.y - oy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      ctx.globalAlpha = firing ? 0.85 : 0.6;
      ctx.fillStyle = color;
      pixelDisc(ctx, ox + dx, oy + dy, Math.round(R * 0.42));
    }
    ctx.globalAlpha = 1;
  }
}
