import { drawText, measureText, CELL_H } from './pixelfont.js';
import { pixelDisc } from './sprites.js';
import { COLORS } from './utils.js';

// Controles táctiles: dos joysticks flotantes + botones, dibujados en pixel art.
// Traducen los dedos de `input.touches` a los controles que ya entiende el juego:
//   joystick izquierdo  → input.moveAxis (analógico, -1..1)
//   joystick derecho    → input.aimAngle / aimActive y, empujado más allá de FIRE_THRESHOLD,
//                         input.aimFiring (ataca/dispara solo respetando la cadencia del arma)
//   LANZAR              → clic derecho (recoger / lanzar)
//   PATADA              → tecla E
//   REINICIAR           → tecla R
// Fuera de la partida (menús, máscaras, resultados…) un toque equivale a un clic en ese punto.
// Los tamaños se definen en píxeles CSS (tamaño real del dedo) y se pasan a píxeles internos.
const STICK_CSS_RADIUS = 56;
const BUTTON_CSS_HEIGHT = 48;
const AIM_DEADZONE = 0.15;     // fracción del radio: por debajo no se cambia la mirada
const FIRE_THRESHOLD = 0.3;    // fracción del radio: arrastrado más allá, ataca al instante
const HOLD_FIRE_DELAY = 0.1;   // s: mantenido sin arrastrar, ataca tras este tiempo
const MARGIN = 6;
const GAMEPLAY = new Set(['playing', 'cleared']);

const inside = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

// Botón táctil pixel art: fondo oscuro, borde de 1 px (rosa al pulsarlo) y texto centrado.
export function drawTouchButton(ctx, b, lit, alpha = 0.55) {
  ctx.globalAlpha = lit ? 0.95 : alpha;
  ctx.fillStyle = '#140a24';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = lit ? COLORS.wall : b.accent || '#3a2a55';
  ctx.fillRect(b.x, b.y, b.w, 1);
  ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
  ctx.fillRect(b.x, b.y, 1, b.h);
  ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
  ctx.globalAlpha = lit ? 1 : Math.min(1, alpha + 0.25);
  drawText(ctx, b.label, b.x + b.w / 2, b.y + Math.round((b.h - CELL_H) / 2) - 1,
    { color: lit ? COLORS.text : '#c9bce6', align: 'center' });
  ctx.globalAlpha = 1;
}

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.move = null;   // { id, ox, oy, x, y } en píxeles internos
    this.aim = null;
    this.roles = new Map();
    this.flash = {};    // botón → segundos de resaltado tras pulsarlo
  }

  // Medida en píxeles CSS → píxeles internos de la escena.
  px(css) {
    return (css * this.game.dpr) / this.game.view.scale;
  }

  // Márgenes = MARGIN + zona segura del sistema (muesca, barra de inicio): nada táctil
  // queda debajo de ellas.
  layout() {
    const { width: w, height: h } = this.game.scene;
    const s = this.game.safe;
    const left = MARGIN + s.l, right = w - MARGIN - s.r, bottom = h - MARGIN - s.b;
    const bh = Math.max(16, Math.round(this.px(BUTTON_CSS_HEIGHT)));
    const bw = Math.max(Math.round(bh * 1.8), measureText('LANZAR') + 12);
    const rh = Math.max(14, Math.round(bh * 0.75));
    return {
      left, right, bottom,
      stickR: Math.max(16, Math.round(this.px(STICK_CSS_RADIUS))),
      buttons: [
        { id: 'throw', label: 'LANZAR', x: right - bw, y: bottom - bh * 2 - 6, w: bw, h: bh },
        { id: 'kick', label: 'PATADA', x: right - bw, y: bottom - bh, w: bw, h: bh },
        // Debajo de la miniatura de la máscara del HUD.
        { id: 'retry', label: 'REINICIAR', x: left, y: 56 + s.t, w: measureText('REINICIAR') + 12, h: rh },
      ],
    };
  }

  // Tamaño estándar de un botón táctil de pantalla (en píxeles internos) para `label`.
  buttonSize(label) {
    const h = Math.max(16, Math.round(this.px(BUTTON_CSS_HEIGHT * 0.85)));
    return { w: Math.max(h * 2, measureText(label) + 14), h };
  }

  reset() {
    this.move = this.aim = null;
    this.roles.clear();
    const input = this.game.input;
    input.moveAxis = { x: 0, y: 0 };
    input.aimActive = input.aimFiring = false;
  }

  press(id) {
    const input = this.game.input;
    if (id === 'throw') input.mousePressed.right = true;
    if (id === 'kick') input.pressed.add('KeyE');
    if (id === 'retry') input.pressed.add('KeyR');
    this.flash[id] = 0.15;
  }

  // Se llama al principio de cada paso de simulación, antes de que el juego lea la entrada.
  update(dt) {
    const g = this.game, input = g.input;
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
          this.flash[hit.id] = 0.15;
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

    const L = this.layout();
    const half = g.scene.width / 2;
    let endedAim = null;
    for (const t of input.touches.values()) {
      const p = g.toInternal(t.x, t.y);
      if (t.isNew && !this.roles.has(t.id)) {
        const button = L.buttons.find((b) => inside(b, p));
        if (button) {
          this.roles.set(t.id, 'button');
          this.press(button.id);
        } else if (p.x < half && !this.move) {
          this.move = { id: t.id, ox: p.x, oy: p.y, x: p.x, y: p.y };
          this.roles.set(t.id, 'move');
        } else if (p.x >= half && !this.aim) {
          this.aim = { id: t.id, ox: p.x, oy: p.y, x: p.x, y: p.y, held: 0, fired: false };
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

    const vec = (s) => {
      const dx = (s.x - s.ox) / L.stickR, dy = (s.y - s.oy) / L.stickR;
      const len = Math.hypot(dx, dy);
      return len > 1 ? { x: dx / len, y: dy / len, len: 1 } : { x: dx, y: dy, len };
    };
    input.moveAxis = this.move ? vec(this.move) : { x: 0, y: 0 };
    // Joystick derecho:
    // - mantenerlo ataca a la cadencia del arma: al instante si se arrastra más allá de
    //   FIRE_THRESHOLD, o tras HOLD_FIRE_DELAY aunque el dedo esté quieto (así, al arrastrar para
    //   apuntar, el primer disparo ya sale en la dirección buena);
    // - un toque rápido que se levanta antes de disparar = un ataque en la dirección actual.
    if (this.aim) {
      this.aim.held += dt;
      const v = vec(this.aim);
      input.aimActive = true;
      if (v.len > AIM_DEADZONE) input.aimAngle = Math.atan2(v.y, v.x);
      input.aimFiring = v.len > FIRE_THRESHOLD || this.aim.held >= HOLD_FIRE_DELAY;
      if (input.aimFiring) this.aim.fired = true;
    } else {
      input.aimActive = input.aimFiring = false;
      if (endedAim && !endedAim.fired) {
        const v = vec(endedAim);
        if (v.len > AIM_DEADZONE) { input.aimAngle = Math.atan2(v.y, v.x); input.aimActive = true; }
        input.tapAttack = true;
      }
    }
  }

  // --- Dibujo (en píxeles internos, sobre el HUD) -------------------------------------------

  draw(ctx) {
    const g = this.game;
    if (!g.input.touchMode || !GAMEPLAY.has(g.state)) return;
    const L = this.layout();
    const R = L.stickR;
    const rightBase = L.buttons[0].x - R - 10;

    // Joysticks: si no se están usando, un círculo tenue indica dónde poner el pulgar.
    this.drawStick(ctx, this.move, L.left + R + 6, L.bottom - R - 6, R, COLORS.player, false);
    this.drawStick(ctx, this.aim, Math.min(rightBase, L.right - R), L.bottom - R - 6, R,
      g.input.aimFiring ? COLORS.blood : COLORS.wall, g.input.aimFiring);

    for (const b of L.buttons) drawTouchButton(ctx, b, this.flash[b.id] > 0, 0.55);
  }

  // Botones de las pantallas fuera de la partida (los define game.screenButtons()).
  drawScreenButtons(ctx) {
    for (const b of this.game.screenButtons()) drawTouchButton(ctx, b, this.flash[b.id] > 0, 0.85);
  }

  drawStick(ctx, stick, idleX, idleY, R, color, firing) {
    const active = !!stick;
    const ox = active ? stick.ox : idleX, oy = active ? stick.oy : idleY;
    ctx.globalAlpha = active ? 0.22 : 0.1;
    ctx.fillStyle = color;
    pixelDisc(ctx, ox, oy, R);
    ctx.globalAlpha = active ? 0.35 : 0.15;
    ctx.fillStyle = '#140a24';
    pixelDisc(ctx, ox, oy, R - 2);
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
