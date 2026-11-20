import { Enemy } from './enemy.js';
import { drawSprite, pixelRect, WORLD_PX } from './sprites.js';
import { civSpriteName } from './sprites.js';
import { COLORS } from './utils.js';

// ALIADO CIVIL (karma invisible, tanda 3): un civil al que el jugador ayudó (le dio una moneda) viene a pelear a su lado en la fase final del piso 10, con su aspecto y un arma de la calle.
// Misma vida que cualquier personaje (cae de un golpe) y mata de un golpe a un enemigo (cause 'ally': sin puntos ni sangre sobre el jugador). Hereda de `Enemy` solo el dibujo y el
// movimiento (rutas, puertas); NO está en `game.enemies` (el jugador y las balas no lo golpean), vive en `game.allies` y su IA es propia: ataca al enemigo vivo más cercano y, sin
// enemigos a la vista, se queda cerca de ti. Para igualar las armas de los mafiosos: los enemigos lo prefieren menos que a ti, apuntan peor contra él y uno de cada tres lleva una TAPA
// DE ALCANTARILLA como escudo frontal que aguanta 3 impactos (ver Game.allyHit / allyFor y las reglas de Enemy.update).
const SPEED = 200, REACH_MAX = 520, FOLLOW = 120, RISE = 0.9;

export class CivAlly extends Enemy {
  constructor(x, y, weapon, look, shield = false) {
    super(x, y, [{ x, y }], null, 'grunt', weapon);
    this.isAlly = true;
    this.look = look;
    this.sprite = civSpriteName(look);
    this.corpseSprite = 'civCorpse';
    this.shield = shield ? 3 : 0;
    this.tgt = null; this.retarget = 0;
    this.state = 'chase';
    this.rise = null;
  }

  // El enemigo vivo, en pie y a la vista más cercano (el que ya tiene se mantiene mientras siga siendo válido).
  pickTarget(game) {
    let best = null, bd = REACH_MAX;
    for (const e of game.enemies) {
      if (!e.alive || !e.standing || e.rise || e.kind === 'boss') continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  update(dt, game) {
    if (!this.alive) return;
    if (this.rise) { this.rise.t += dt; if (this.rise.t < RISE) return; this.rise = null; }
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    if (this.doorWait > 0) { this.doorWait -= dt; if (this.doorWait <= 0) this.doorPushTime = 0.6; } else this.doorPushTime = Math.max(0, this.doorPushTime - dt);
    this.retarget -= dt;
    if (!this.tgt || !this.tgt.alive || !this.tgt.standing || this.retarget <= 0) { this.tgt = this.pickTarget(game); this.retarget = 0.4; }
    const t = this.tgt;
    if (!t) {                                         // sin enemigos: se queda cerca del jugador
      const p = game.player, d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d > FOLLOW) this.goTo(p.x, p.y, SPEED * 0.8, dt, game.map);
      this.windup = 0;
      return;
    }
    const d = Math.hypot(t.x - this.x, t.y - this.y), a = Math.atan2(t.y - this.y, t.x - this.x);
    if (d < this.r + t.r + this.reach) {
      this.turnTowards(a, 16, dt);
      this.windup += dt;
      if (this.windup >= this.windupTime) {
        this.windup = 0; this.attackCd = 0.35; this.swingT = 0.15;
        game.allyStrike(this, t);
      }
    } else {
      this.windup = 0;
      this.goTo(t.x, t.y, SPEED, dt, game.map);
    }
  }

  draw(ctx, time, game) {
    super.draw(ctx, time, game);
    if (!this.alive) return;
    if (this.shield > 0) drawSprite(ctx, 'allyShield', this.x + Math.cos(this.angle) * 13, this.y + Math.sin(this.angle) * 13, this.angle); // la tapa de alcantarilla, de frente
    const b = Math.round(Math.sin(time * 6)) * WORLD_PX;                                                                                     // marca cian sobre la cabeza: es de los nuestros
    ctx.fillStyle = COLORS.player;
    pixelRect(ctx, this.x - 1, this.y - this.r - 9 + b, 3, 1); pixelRect(ctx, this.x, this.y - this.r - 7 + b, 1, 1);
  }
}
