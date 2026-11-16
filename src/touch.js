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
//   ATACAR              → botón inteligente (`game.touchAction()`, la etiqueta cambia): tocar = un ataque
//                         (input.tapAttack); mantener = input.attackHeld. Con un derribado a tiro REMATA
//                         (el ataque ya ejecuta), con una puerta delante la PATEA (con armas de fuego
//                         envía E en vez de disparar) y, con el edificio limpio junto a la moto, se sube
//                         y se va (MOTO). El toque rápido del joystick derecho hace lo mismo.
//   LANZAR              → clic derecho (recoger / lanzar), justo encima de ATACAR
//   REINICIAR           → tecla R
// Fuera de la partida (menús, máscaras, resultados…) un toque equivale a un clic en ese punto.
// Los tamaños se definen en píxeles CSS (tamaño real del dedo) y se pasan a píxeles internos.

// Preferencias táctiles: un único objeto, pensado para un futuro menú de opciones. Se guardan en
// `localStorage` (clave TOUCH_KEY) con lectura defensiva: lo que falte o sea inválido usa el valor
// por defecto. Todo el dibujo y la detección de toques leen de `TouchControls.config`.
export const TOUCH_KEY = 'neonrush.touch.v1';
export const TOUCH_CONFIG = {
  joystickRadius: 56,   // px CSS: radio de ambos joysticks
  buttonScale: 1,       // multiplica el alto de los botones (0,7..1,6)
  buttonOpacity: 1,     // multiplica su opacidad (0,3..1)
  aimAssist: 0.5,       // 0 = sin asistencia … 1 = máxima (ver `assistAngle`)
  hapticsEnabled: true, // vibración breve en botones, disparos, ejecuciones y muerte
  moveDeadzone: 0.12,   // fracción del radio: por debajo no hay movimiento
  aimDeadzone: 0.15,    // fracción del radio: por debajo no se cambia la mirada
  fireThreshold: 0.6,   // fracción del radio: más allá (borde exterior) ataca
};
const RANGES = {
  joystickRadius: [36, 100], buttonScale: [0.7, 1.6], buttonOpacity: [0.3, 1], aimAssist: [0, 1],
  moveDeadzone: [0, 0.4], aimDeadzone: [0, 0.4], fireThreshold: [0.3, 0.95],
};

export function loadTouchConfig() {
  const cfg = { ...TOUCH_CONFIG };
  try {
    const saved = JSON.parse(localStorage.getItem(TOUCH_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const k in RANGES) {
        const v = saved[k];
        if (typeof v === 'number' && Number.isFinite(v)) cfg[k] = clamp(v, RANGES[k][0], RANGES[k][1]);
      }
      if (typeof saved.hapticsEnabled === 'boolean') cfg.hapticsEnabled = saved.hapticsEnabled;
    }
  } catch { /* sin acceso o JSON corrupto: valores por defecto */ }
  return cfg;
}

export function saveTouchConfig(cfg) {
  try { localStorage.setItem(TOUCH_KEY, JSON.stringify(cfg)); } catch { /* cuota o modo privado */ }
}

const BUTTON_CSS_HEIGHT = 48;
const HOLD_FIRE_HYSTERESIS = 0.1; // al soltar hacia dentro, deja de atacar 0,1 del radio antes
const TAP_MAX = 0.25;          // s: un toque más corto que esto (sin disparar) es un ataque
const ACT_BUFFER = 0.25;       // s que se recuerda un PATEAR/REMATAR pulsado en plena cadencia
const PRESS_FLASH = 0.15;      // s de resaltado tras pulsar un botón
const HAPTIC_FIRE_GAP = 0.12;  // s mínimos entre vibraciones mientras se dispara
const ASSIST_RANGE = 360;      // u del mundo: hasta dónde engancha la asistencia
const MARGIN = 6;
const GAMEPLAY = new Set(['playing', 'cleared']);

const inside = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

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
  drawText(ctx, b.label, x + w / 2, y + Math.round((h - CELL_H) / 2) - 1,
    { color: lit ? COLORS.text : b.textColor || '#c9bce6', align: 'center' });
  ctx.globalAlpha = 1;
}

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.config = loadTouchConfig();
    this.move = null;   // { id, ox, oy, x, y } en píxeles internos
    this.aim = null;
    this.roles = new Map();
    this.flash = {};    // botón → segundos de resaltado tras pulsarlo
    this.action = { id: 'attack', label: 'ATACAR', ready: false }; // acción contextual vigente
    this.actBuffer = 0;
    this.hapticTimer = 0;
    this.prev = { exec: false, alive: true, firing: false };
  }

  // Medida en píxeles CSS → píxeles internos de la escena.
  px(css) {
    return (css * this.game.dpr) / this.game.view.scale;
  }

  setConfig(patch) {
    Object.assign(this.config, patch);
    saveTouchConfig(this.config);
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
    // ATACAR es el botón principal: más grande y en la esquina, donde cae el pulgar. Su ancho es fijo
    // (cabe la etiqueta más larga) para que no se mueva al cambiar de ATACAR a REMATAR, PATEAR o MOTO.
    const ah = Math.round(bh * 1.3);
    const aw = Math.max(Math.round(ah * 1.6), measureText('REMATAR') + 12);
    const bw = Math.max(Math.round(bh * 1.8), measureText('LANZAR') + 12);
    const attack = { id: 'attack', label: this.action.label, x: right - aw, y: bottom - ah, w: aw, h: ah, accent: COLORS.wall };
    // LANZAR justo encima de ATACAR, alineado a su borde derecho (el pulgar lo alcanza sin soltar la esquina).
    const throwB = { id: 'throw', label: 'LANZAR', x: right - bw, y: attack.y - 6 - bh, w: bw, h: bh };
    return {
      left, right, bottom,
      stickR: Math.max(16, Math.round(this.px(cfg.joystickRadius))),
      buttons: [
        attack, throwB,
        // Debajo de la miniatura de la máscara del HUD.
        { id: 'retry', label: 'REINICIAR', x: left, y: 56 + s.t, w: measureText('REINICIAR') + 12, h: rh },
      ],
    };
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
    if (id === 'throw') input.mousePressed.right = true;
    if (id === 'retry') input.pressed.add('KeyR');
  }

  // Ataque unificado (botón ATACAR y toque rápido del joystick derecho): según el contexto sube a la
  // moto, patea la puerta (con arma de fuego, donde atacar dispararía; el cuerpo a cuerpo ya patea
  // solo) o ataca, y atacar con un derribado a tiro ya lo remata. Devuelve true si el toque se gastó
  // en patear o montar (no es un ataque).
  smartAttack() {
    const g = this.game, input = g.input, a = g.touchAction();
    if (a.id === 'mount') { g.startLeaving(); return true; }
    if (a.id === 'kick' && a.ready && !g.player.def.melee) {
      input.pressed.add('KeyE');
      this.actBuffer = ACT_BUFFER; // si el arma sigue en cadencia, se reintenta en cuanto acabe
      return true;
    }
    if (a.id === 'execute') this.haptic(28);
    input.tapAttack = true;
    return false;
  }

  // Asistencia de apuntado: si hay un enemigo vivo a la vista dentro de un cono estrecho alrededor
  // de donde apunta el dedo, la mira se inclina hacia él. El cono (7°..28°) y la fuerza del tirón
  // crecen con `aimAssist`; el tirón es mayor cuanto más centrado está el enemigo, así que nunca
  // "salta" a otro objetivo. Se calcula siempre desde el ángulo crudo del dedo (sin acumular).
  assistAngle(raw) {
    const strength = this.config.aimAssist;
    const g = this.game, p = g.player;
    if (strength <= 0 || !p || !p.alive) return raw;
    const cone = 0.12 + 0.37 * strength;
    let best = null, bestScore = Infinity;
    for (const e of g.enemies) {
      if (!e.alive || e.state === 'down') continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > ASSIST_RANGE || d < 1) continue;
      const diff = angleDiff(Math.atan2(dy, dx), raw);
      // El cono se estrecha un poco con la distancia: a lo lejos hay menos margen de duda.
      if (Math.abs(diff) > cone * (1 - 0.4 * (d / ASSIST_RANGE))) continue;
      if (!lineOfSight(g.map, p.x, p.y, e.x, e.y)) continue;
      const score = Math.abs(diff) + d / 2000;
      if (score < bestScore) { best = diff; bestScore = score; }
    }
    if (best === null) return raw;
    return raw + best * clamp(strength * 0.7 * (1 - Math.abs(best) / (cone * 2)), 0, 0.85);
  }

  // Se llama al principio de cada paso de simulación, antes de que el juego lea la entrada.
  update(dt) {
    const g = this.game, input = g.input, cfg = this.config;
    for (const id in this.flash) this.flash[id] = Math.max(0, this.flash[id] - dt);
    if (!input.touchMode) { if (this.move || this.aim) this.reset(); return; }

    if (!GAMEPLAY.has(g.state)) {
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
      if (v.len > cfg.aimDeadzone) input.aimAngle = this.assistAngle(Math.atan2(v.dir.y, v.dir.x));
      const limit = this.aim.firing ? cfg.fireThreshold - HOLD_FIRE_HYSTERESIS : cfg.fireThreshold;
      this.aim.firing = v.len > limit;
      input.aimFiring = this.aim.firing;
      if (this.aim.firing) this.aim.fired = true;
    } else {
      input.aimActive = input.aimFiring = false;
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
      if (p.alive && !p.exec && p.cooldown <= 0 && !input.wasPressed('KeyE')) {
        input.pressed.add('KeyE');
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
    if (!g.input.touchMode || !GAMEPLAY.has(g.state)) return;
    const L = this.layout();
    const R = L.stickR;
    const op = this.config.buttonOpacity;
    const rightBase = L.buttons[0].x - R - 10;
    const now = performance.now();

    // Joysticks: si no se están usando, un círculo tenue indica dónde poner el pulgar.
    this.drawStick(ctx, this.move, L.left + R + 6, L.bottom - R - 6, R, COLORS.player, false);
    this.drawStick(ctx, this.aim, Math.min(rightBase, L.right - R), L.bottom - R - 6, R,
      g.input.aimFiring ? COLORS.blood : COLORS.wall, g.input.aimFiring, this.config.fireThreshold);

    const act = this.action;
    for (const b of L.buttons) {
      const press = (this.flash[b.id] || 0) / PRESS_FLASH;
      const lit = press > 0 || (b.id === 'attack' && g.input.attackHeld);
      let alpha = b.id === 'attack' ? 0.7 : 0.55;
      if (b.id === 'attack') {
        // Contexto: REMATAR parpadea en rojo/blanco neón, MOTO en cian, PATEAR en rosa; ATACAR, el de siempre.
        if (act.id === 'execute') {
          const blink = Math.floor(now / 110) % 2;
          b.accent = blink ? COLORS.text : COLORS.enemyBullet;
          b.textColor = blink ? COLORS.enemyBullet : COLORS.text;
          alpha = 0.95;
        } else if (act.id === 'mount') {
          b.accent = COLORS.player;
          b.textColor = COLORS.player;
          alpha = 0.9;
        } else {
          b.accent = COLORS.wall;
          b.textColor = act.id === 'kick' && act.ready ? COLORS.text : undefined;
          alpha = act.id === 'kick' && act.ready ? 0.9 : 0.7;
        }
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
