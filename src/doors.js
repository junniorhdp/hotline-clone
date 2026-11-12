import { TILE, moveAndSlide } from './map.js';
import { COLORS, closestOnSegment } from './utils.js';
import { drawSprite, pixelRect, WORLD_PX } from './sprites.js';
import { drawText } from './pixelfont.js';

const MAX_OPEN = Math.PI / 2;
const OPEN_SPEED = 3.2;          // rad/s al empujarla andando (apertura "normal")
const KICK_SPEED = 13;           // rad/s tras una patada
export const KNOCK_SPEED = 6;    // por encima de esto la hoja derriba a quien golpee
const DAMPING = 3.5;
const THICKNESS = 4;
const KICK_RANGE = 46;
const KICK_ARC = 1.1;            // rad a cada lado de la mirada

// Puerta batiente: un segmento que gira sobre una bisagra pegada a la pared.
export class Door {
  constructor(tx, ty, horizontal) {
    this.tx = tx;
    this.ty = ty;
    this.cx = tx * TILE + TILE / 2;
    this.cy = ty * TILE + TILE / 2;
    if (horizontal) {
      this.hx = tx * TILE;
      this.hy = this.cy;
      this.base = 0;
    } else {
      this.hx = this.cx;
      this.hy = ty * TILE;
      this.base = Math.PI / 2;
    }
    this.len = TILE;
    this.offset = 0;   // ángulo respecto a cerrada
    this.angVel = 0;
    this.creakCd = 0;
  }

  get angle() { return this.base + this.offset; }
  get ex() { return this.hx + Math.cos(this.angle) * this.len; }
  get ey() { return this.hy + Math.sin(this.angle) * this.len; }
  get fast() { return Math.abs(this.angVel) > KNOCK_SPEED; }

  // +1 / -1 según a qué lado de la hoja está el punto.
  sideOf(x, y) {
    const a = this.angle;
    return Math.cos(a) * (y - this.hy) - Math.sin(a) * (x - this.hx) >= 0 ? 1 : -1;
  }

  // ¿Está a tiro de patada desde (x, y) mirando hacia `angle`?
  inKickRange(x, y, angle) {
    const d = Math.hypot(this.cx - x, this.cy - y);
    if (d > KICK_RANGE) return false;
    let diff = Math.atan2(this.cy - y, this.cx - x) - angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    return Math.abs(diff) < KICK_ARC;
  }

  // La patada abre la puerta en sentido contrario a quien la da.
  kick(fromX, fromY) {
    this.angVel = -this.sideOf(fromX, fromY) * KICK_SPEED;
  }

  update(dt) {
    this.offset += this.angVel * dt;
    if (this.offset > MAX_OPEN) { this.offset = MAX_OPEN; this.angVel = -Math.abs(this.angVel) * 0.25; }
    if (this.offset < -MAX_OPEN) { this.offset = -MAX_OPEN; this.angVel = Math.abs(this.angVel) * 0.25; }
    this.angVel *= Math.exp(-DAMPING * dt);
    if (Math.abs(this.angVel) < 0.05) this.angVel = 0;
    this.creakCd = Math.max(0, this.creakCd - dt);
  }

  // Resuelve el choque con una entidad { x, y, r }.
  // Devuelve 'knock' si la hoja la golpea girando rápido, 'push' si la entidad la empuja, o null.
  collide(e, map) {
    const c = closestOnSegment(e.x, e.y, this.hx, this.hy, this.ex, this.ey);
    const dx = e.x - c.x, dy = e.y - c.y;
    const d = Math.hypot(dx, dy);
    const R = e.r + THICKNESS / 2;
    if (d >= R) return null;

    const side = this.sideOf(e.x, e.y);
    let result = 'push';
    if (this.angVel * side > 0 && this.fast) {
      // Pierde fuerza pero sigue abriéndose: el derribado sale despedido y deja de colisionar.
      result = 'knock';
      this.angVel *= 0.5;
    } else if (this.angVel * -side < OPEN_SPEED) {
      this.angVel = -side * OPEN_SPEED;
    }

    let nx = dx / d, ny = dy / d;
    if (!(d > 0.001)) {
      nx = -Math.sin(this.angle) * side;
      ny = Math.cos(this.angle) * side;
    }
    moveAndSlide(map, e, nx * (R - d), ny * (R - d));
    return result;
  }

  // Hoja pixelada de 16×3 que gira sobre la bisagra (rotación con vecino más cercano).
  draw(ctx) {
    drawSprite(ctx, 'door', this.hx, this.hy, this.angle, { ox: 0, oy: 1.5 });
    ctx.fillStyle = COLORS.wall;
    pixelRect(ctx, this.hx - 2, this.hy - 2, 2, 2);
  }

  drawDebug(ctx) {
    ctx.save();
    ctx.strokeStyle = this.fast ? COLORS.blood : COLORS.debug;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(this.hx, this.hy);
    ctx.lineTo(this.hx + Math.cos(this.base) * this.len, this.hy + Math.sin(this.base) * this.len);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    drawText(ctx, `V ${this.angVel.toFixed(1)}`, this.cx, this.cy - 26, { color: COLORS.debug, scale: WORLD_PX, align: 'center' });
  }
}
