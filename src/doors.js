import { TILE, moveAndSlide } from './map.js';
import { COLORS, closestOnSegment } from './utils.js';
import { drawSprite, pixelRect, WORLD_PX } from './sprites.js';
import { drawText } from './pixelfont.js';

const MAX_OPEN = Math.PI / 2;
// Prioridad: el jugador manda sobre la puerta. Su empujón abre rápido (derriba a quien esté
// detrás) y la "bloquea" PLAYER_LOCK_TIME: mientras tanto ningún enemigo puede cambiar su giro.
// Los enemigos, en cambio, la abren despacio (sin fuerza para derribar).
export const PLAYER_PUSH_SPEED = 9;  // rad/s al empujarla el jugador (andando o corriendo)
export const ENEMY_PUSH_SPEED = 1.8; // rad/s al empujarla un enemigo
const KICK_SPEED = 14;               // rad/s tras una patada
const PLAYER_LOCK_TIME = 0.4;
export const KNOCK_SPEED = 6;        // por encima de esto la hoja derriba a quien golpee
const KNOCK_MARGIN = 7;              // margen extra (mundo) de la hoja al golpear rápido
const KNOCK_FOLLOW_SPEED = 8;        // la hoja conserva al menos este impulso tras estampar
const DAMPING = 3.5;
const THICKNESS = 4;
const KICK_RANGE = 46;
const KICK_ARC = 1.1;                // rad a cada lado de la mirada

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
    this.offset = 0;      // ángulo respecto a cerrada
    this.prevOffset = 0;  // ángulo del paso anterior (para el barrido del golpe)
    this.angVel = 0;
    this.creakCd = 0;
    this.playerLock = 0;  // s durante los que solo el jugador decide el giro
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

  // La patada abre la puerta en sentido contrario a quien la da y anula cualquier empujón de
  // un enemigo desde el otro lado.
  kick(fromX, fromY) {
    this.angVel = -this.sideOf(fromX, fromY) * KICK_SPEED;
    this.playerLock = PLAYER_LOCK_TIME;
  }

  // ¿La hoja, girando, barre la posición de la entidad en este paso? Se mira todo el arco
  // recorrido desde el paso anterior (más un margen) y no solo el contacto en este instante,
  // para que un enemigo que llega corriendo no "atraviese" la hoja entre dos pasos.
  sweptHits(e) {
    const dx = e.x - this.hx, dy = e.y - this.hy;
    const r = Math.hypot(dx, dy);
    if (r < 4 || r > this.len + e.r + KNOCK_MARGIN) return false;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const toEntity = wrap(Math.atan2(dy, dx) - this.angle);
    const swept = wrap(this.prevOffset - this.offset);
    const margin = (e.r + KNOCK_MARGIN) / r;
    return toEntity >= Math.min(0, swept) - margin && toEntity <= Math.max(0, swept) + margin;
  }

  update(dt) {
    this.prevOffset = this.offset;
    this.playerLock = Math.max(0, this.playerLock - dt);
    this.offset += this.angVel * dt;
    if (this.offset > MAX_OPEN) { this.offset = MAX_OPEN; this.angVel = -Math.abs(this.angVel) * 0.25; }
    if (this.offset < -MAX_OPEN) { this.offset = -MAX_OPEN; this.angVel = Math.abs(this.angVel) * 0.25; }
    this.angVel *= Math.exp(-DAMPING * dt);
    if (Math.abs(this.angVel) < 0.05) this.angVel = 0;
    this.creakCd = Math.max(0, this.creakCd - dt);
  }

  // Resuelve el choque con una entidad { x, y, r }. Opciones:
  //   player     true si es el jugador: siempre impone su empujón (PLAYER_PUSH_SPEED) y bloquea
  //              la puerta; nunca es derribado por ella.
  //   pushSpeed  velocidad a la que la abre al empujarla (enemigos: ENEMY_PUSH_SPEED).
  //   canPush    función que se llama solo si hay contacto: false = no puede empujar todavía
  //              (el enemigo se para un instante antes de abrir).
  // Devuelve 'knock' (la hoja la golpea girando rápido), 'push' (la entidad la empuja),
  // 'blocked' (toca la puerta pero no puede moverla) o null (sin contacto).
  collide(e, map, { player = false, pushSpeed = ENEMY_PUSH_SPEED, canPush = null } = {}) {
    const side = this.sideOf(e.x, e.y);
    if (!player && this.fast && this.angVel * side > 0 && this.sweptHits(e)) {
      // Estampada: la hoja conserva (y refuerza) su impulso y sigue abriéndose.
      this.angVel = Math.sign(this.angVel) * Math.max(Math.abs(this.angVel) * 0.85, KNOCK_FOLLOW_SPEED);
      return 'knock';
    }

    const c = closestOnSegment(e.x, e.y, this.hx, this.hy, this.ex, this.ey);
    const dx = e.x - c.x, dy = e.y - c.y;
    const d = Math.hypot(dx, dy);
    const R = e.r + THICKNESS / 2;
    if (d >= R) return null;

    let result = 'push';
    if (player) {
      if (this.angVel * -side < PLAYER_PUSH_SPEED) this.angVel = -side * PLAYER_PUSH_SPEED;
      this.playerLock = PLAYER_LOCK_TIME;
    } else if (this.playerLock > 0 || (canPush && !canPush())) {
      result = 'blocked'; // la puerta manda: se le aparta, pero no la mueve
    } else if (this.angVel * -side < pushSpeed) {
      this.angVel = -side * pushSpeed;
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
    drawText(ctx, `V ${this.angVel.toFixed(1)}${this.playerLock > 0 ? " JUGADOR" : ""}`, this.cx, this.cy - 26, { color: COLORS.debug, scale: WORLD_PX, align: 'center' });
  }
}
