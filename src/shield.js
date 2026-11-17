import { Enemy } from './enemy.js';
import { angleDiff, COLORS } from './utils.js';
import { pixelRect } from './sprites.js';

// BLINDADO (piso 9, letra `Z`): guardia pesado con un escudo balístico que lleva siempre hacia el jugador. Va armado con subfusil, avanza despacio mientras apunta
// (`pressure`) y se ve más lento (×0,82). Mismo contrato que la coraza del jefe (Game.killEnemy/knockDown llaman a guardKill/guardKnock antes de matar o derribar).
//   · Golpe de FRENTE (la dirección del golpe contraria a hacia donde mira, ±63°): pistola y cuerpo a cuerpo REBOTAN (chispas, el jugador se resiente 0,3 s);
//     el subfusil lo desgasta poco a poco (0,25 por bala) y la escopeta lo revienta (0,6 por perdigón): el escudo tiene SHIELD_HP = 4, así que ~7 perdigones
//     (una descarga a quemarropa) o 16 balas de subfusil lo rompen; ya roto es un guardia normal (muere de un golpe).
//   · Por la ESPALDA o los costados: cae de un golpe como cualquier enemigo. Flanquéalo, rodea una columna o usa una escopeta.
//   · Un arma LANZADA, un portazo o los puños por detrás lo derriban de frente (el escudo no sirve contra el impacto); derribado se remata (la ejecución no la frena).
export const FRONT_ARC = Math.PI - 1.1;
export const SHIELD_HP = 4;
const BULLET_DMG = { gun: 0, smg: 0.25, shotgun: 0.6 };

export class ShieldGuard extends Enemy {
  constructor(x, y, patrol, weapon, meleeWeapon = null) {
    super(x, y, patrol, weapon, 'shield', meleeWeapon);
    this.shieldHp = SHIELD_HP;
    this.flash = 0;          // destello al absorber un golpe
    this.hinted = false;     // ya ha avisado de que es blindado
    this.pressure = true;    // avanza despacio mientras apunta (ver Enemy.updateChase)
  }

  // ¿Viene el golpe (con dirección `angle`) de frente, contra el escudo? Roto o derribado, no protege.
  fromFront(angle) {
    return this.shieldHp > 0 && this.state !== 'down' && Math.abs(angleDiff(angle, this.angle)) > FRONT_ARC;
  }

  update(dt, game) {
    this.flash = Math.max(0, this.flash - dt);
    super.update(dt, game);
  }

  // Devuelve true si el golpe lo mata (sigue el flujo normal); false si el escudo lo absorbe.
  guardKill(cause, angle, game, src) {
    if (!this.fromFront(angle) || cause === 'execution') return true;
    if (cause === 'bullet') {
      const dmg = BULLET_DMG[(src && src.src) || 'gun'] ?? 0;
      if (dmg > 0) { this.shieldHit(dmg, angle, game); return false; }
    }
    this.deflect(angle, game, cause);
    return false;
  }

  // Derribos: los puños de frente rebotan; el resto (arma lanzada, portazo, puños por detrás) derriba.
  guardKnock(cause, angle, game) {
    if (cause === 'fists' && this.fromFront(angle)) { this.deflect(angle, game, cause); return false; }
    return true;
  }

  shieldHit(dmg, angle, game) {
    this.shieldHp -= dmg;
    this.flash = 0.1;
    const back = angle + Math.PI;
    game.particles.sparks(this.x + Math.cos(back) * this.r, this.y + Math.sin(back) * this.r, back, 5, 0.8);
    game.playAt('ricochet', this.x, this.y);
    if (this.shieldHp <= 0) {
      this.shieldHp = 0;
      game.addFloat(this.x, this.y - 22, '¡ESCUDO ROTO!', COLORS.player, 1, 1.4);
      game.camera.addShake(6);
      game.fx.kick(0.4);
      game.particles.sparks(this.x + Math.cos(back) * this.r, this.y + Math.sin(back) * this.r, back, 16, 1.2);
    } else this.hint(game);
  }

  deflect(angle, game, cause) {
    const back = angle + Math.PI;
    this.flash = 0.12;
    game.particles.sparks(this.x + Math.cos(back) * this.r, this.y + Math.sin(back) * this.r, back, 8, 0.8);
    game.camera.addShake(cause === 'bullet' ? 1.5 : 4);
    game.playAt('ricochet', this.x, this.y);
    if (cause === 'melee' || cause === 'fists') game.player.cooldown = Math.max(game.player.cooldown, 0.3); // el golpe rebota: el jugador se resiente
    this.hint(game);
  }

  // Aviso la primera vez que algo rebota en su escudo (una vez por enemigo).
  hint(game) {
    if (this.hinted) return;
    this.hinted = true;
    game.addFloat(this.x, this.y - 22, '¡BLINDADO! ¡FLANQUÉALO!', COLORS.enemy, 1, 1.6);
  }

  // Dentro del dibujo del enemigo (ya girado hacia donde mira): la placa del escudo delante, con grietas al desgastarse y destello al recibir golpes.
  drawGear(ctx) {
    if (this.shieldHp <= 0) return;
    const worn = this.shieldHp / SHIELD_HP;
    ctx.fillStyle = '#0a0a14'; pixelRect(ctx, 11, -12, 4, 12);
    ctx.fillStyle = this.flash > 0 ? '#ffffff' : '#8fa3ba'; pixelRect(ctx, 12, -11, 2, 10);
    ctx.fillStyle = this.flash > 0 ? '#ffffff' : '#d6e4f5'; pixelRect(ctx, 12, -11, 1, 10);
    ctx.fillStyle = '#566a82'; pixelRect(ctx, 13, -11, 1, 10);
    ctx.fillStyle = '#ffbe0b'; pixelRect(ctx, 12, -7, 2, 1); pixelRect(ctx, 12, -4, 2, 1); // franjas de aviso
    if (worn < 0.75) { ctx.fillStyle = '#0a0a14'; pixelRect(ctx, 12, -9, 2, 1); }
    if (worn < 0.5) { pixelRect(ctx, 13, -6, 1, 3); pixelRect(ctx, 12, -2, 2, 1); }
    if (worn < 0.25) { pixelRect(ctx, 12, -10, 1, 4); pixelRect(ctx, 13, -3, 1, 2); }
  }
}
