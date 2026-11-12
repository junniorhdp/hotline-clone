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
const FIRE_THRESHOLD = 0.3;    // fracción del radio: por encima el joystick derecho ataca
const MARGIN = 6;
const GAMEPLAY = new Set(['playing', 'cleared']);

const inside = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

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

  layout() {
    const { width: w, height: h } = this.game.scene;
    const bh = Math.max(16, Math.round(this.px(BUTTON_CSS_HEIGHT)));
    const bw = Math.max(Math.round(bh * 1.8), measureText('LANZAR') + 12);
    const rh = Math.max(14, Math.round(bh * 0.75));
    return {
      stickR: Math.max(16, Math.round(this.px(STICK_CSS_RADIUS))),
      buttons: [
        { id: 'throw', label: 'LANZAR', x: w - MARGIN - bw, y: h - MARGIN - bh * 2 - 6, w: bw, h: bh },
        { id: 'kick', label: 'PATADA', x: w - MARGIN - bw, y: h - MARGIN - bh, w: bw, h: bh },
        // Debajo de la miniatura de la máscara del HUD.
        { id: 'retry', label: 'REINICIAR', x: MARGIN, y: 56, w: measureText('REINICIAR') + 12, h: rh },
      ],
    };
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
      // Menús y pantallas: tocar = hacer clic ahí. En resultados y fin de partida, tocar en
      // cualquier sitio continúa; en la pantalla de muerte, reintenta.
      for (const t of input.touches.values()) {
        if (!t.isNew) continue;
        input.mouse.x = t.x;
        input.mouse.y = t.y;
        input.mousePressed.left = true;
        if (g.state === 'results' || g.state === 'gameover') input.pressed.add('Enter');
        if (g.state === 'dead') input.pressed.add('KeyR');
      }
      return;
    }

    const L = this.layout();
    const half = g.scene.width / 2;
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
          this.aim = { id: t.id, ox: p.x, oy: p.y, x: p.x, y: p.y };
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
        if (this.aim && this.aim.id === t.id) this.aim = null;
        this.roles.delete(t.id);
      }
    }

    const vec = (s) => {
      const dx = (s.x - s.ox) / L.stickR, dy = (s.y - s.oy) / L.stickR;
      const len = Math.hypot(dx, dy);
      return len > 1 ? { x: dx / len, y: dy / len, len: 1 } : { x: dx, y: dy, len };
    };
    input.moveAxis = this.move ? vec(this.move) : { x: 0, y: 0 };
    if (this.aim) {
      const v = vec(this.aim);
      input.aimActive = true;
      if (v.len > AIM_DEADZONE) input.aimAngle = Math.atan2(v.y, v.x);
      input.aimFiring = v.len > FIRE_THRESHOLD;
    } else {
      input.aimActive = input.aimFiring = false;
    }
  }

  // --- Dibujo (en píxeles internos, sobre el HUD) -------------------------------------------

  draw(ctx) {
    const g = this.game;
    if (!g.input.touchMode || !GAMEPLAY.has(g.state)) return;
    const { width: w, height: h } = g.scene;
    const L = this.layout();
    const R = L.stickR;
    const rightBase = L.buttons[0].x - R - 10;

    // Joysticks: si no se están usando, un círculo tenue indica dónde poner el pulgar.
    this.drawStick(ctx, this.move, MARGIN + R + 6, h - MARGIN - R - 6, R, COLORS.player, false);
    this.drawStick(ctx, this.aim, Math.min(rightBase, w - MARGIN - R), h - MARGIN - R - 6, R,
      g.input.aimFiring ? COLORS.blood : COLORS.wall, g.input.aimFiring);

    for (const b of L.buttons) {
      const lit = this.flash[b.id] > 0;
      ctx.globalAlpha = lit ? 0.9 : 0.55;
      ctx.fillStyle = '#140a24';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = lit ? COLORS.wall : '#3a2a55';
      ctx.fillRect(b.x, b.y, b.w, 1);
      ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
      ctx.fillRect(b.x, b.y, 1, b.h);
      ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
      ctx.globalAlpha = lit ? 1 : 0.8;
      drawText(ctx, b.label, b.x + b.w / 2, b.y + Math.round((b.h - CELL_H) / 2) - 1,
        { color: lit ? COLORS.text : '#c9bce6', align: 'center' });
    }
    ctx.globalAlpha = 1;
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
