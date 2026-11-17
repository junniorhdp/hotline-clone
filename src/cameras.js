import { castRay, lineOfSight, TILE } from './map.js';
import { angleDiff, COLORS } from './utils.js';
import { pixelRect, WORLD_PX } from './sprites.js';

// Cámaras de seguridad del piso 8 y su operador. Cada cámara está en una pared y barre un cono hacia delante (`base` ± `sweep`). Si el jugador permanece en el cono con
// línea de visión, un indicador sube (DETECT_TIME s) y, al llenarse, el OPERADOR (enemigo `kind 'operator'`, sentado frente a los monitores de la sala de control) saca el
// walkie-talkie (RADIO_TIME s: ¡matarlo o tumbarlo a tiempo cancela el aviso!) y da la ALERTA GENERAL: todos los enemigos vivos corren hacia donde te vio la cámara.
// Si el jugador MATA al operador, las cámaras quedan ciegas para siempre (y +500 si aún no había saltado la alarma). Solo hay detección con el operador vivo.
const RANGE = 240;            // alcance del cono (u)
const HALF_FOV = 0.4;         // semiapertura (rad)
const DETECT_TIME = 0.6;      // s a la vista hasta dar el aviso
const RADIO_TIME = 1.3;       // s que tarda el operador en dar el aviso por el walkie
const REPEAT_ALARM = 6;       // mientras una cámara te siga viendo, el operador repite la posición cada tantos s
const STEALTH_BONUS = 500;

export class SecurityCams {
  constructor(game, data = []) {
    this.game = game;
    this.list = data.map((d, i) => ({ ...d, a: d.base, meter: 0, phase: i * 1.7, seen: false, blink: i * 0.3, spark: 0 }));
    this.disabled = false;
    this.alarmed = false;        // ya ha saltado la alarma general (no se da el bonus sigiloso)
    this.radio = null;           // { t, x, y }: el operador está dando el aviso
    this.alarmCd = 0;
    this.clock = 0;
  }

  get operator() { return this.game.enemies.find((e) => e.kind === 'operator') || null; }
  get active() { return !this.disabled && this.list.length > 0; }

  update(dt) {
    const g = this.game, p = g.player;
    this.clock += dt;
    this.alarmCd = Math.max(0, this.alarmCd - dt);
    const op = this.operator;
    // Operador muerto (por cualquier causa) = cámaras ciegas.
    if (!this.disabled && op && !op.alive) this.operatorDown(op);
    for (const c of this.list) {
      c.blink += dt;
      if (this.disabled) { c.seen = false; c.meter = 0; c.spark -= dt; if (c.spark <= 0) { c.spark = 1.5 + Math.random() * 3; g.particles.neon(c.x, c.y, Math.random() * 6.28, 2, 3); } continue; }
      c.a = c.base + Math.sin(this.clock * c.speed + c.phase) * c.sweep;
      const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
      const inState = (g.state === 'playing') && p.alive && g.inside;
      c.seen = inState && d < RANGE && Math.abs(angleDiff(Math.atan2(dy, dx), c.a)) < HALF_FOV && lineOfSight(g.map, c.x, c.y, p.x, p.y);
      c.meter = c.seen ? Math.min(1, c.meter + dt / DETECT_TIME) : Math.max(0, c.meter - dt * 1.2);
      if (c.meter >= 1) this.detected(c);
    }
    // El operador da el aviso por el walkie (si lo matan o lo tumban, se cancela).
    if (this.radio) {
      if (!op || !op.alive || op.state === 'down') { this.radio = null; if (op) op.radioT = 0; g.addFloat(g.player.x, g.player.y - 24, '¡AVISO CORTADO!', COLORS.player, 1, 1.4); }
      else {
        op.radioT = this.radio.t;
        this.radio.t -= dt;
        if (this.radio.t <= 0) { const r = this.radio; this.radio = null; op.radioT = 0; this.sound(op); g.generalAlarm(r.x, r.y); this.alarmed = true; this.alarmCd = REPEAT_ALARM; g.showCallout('¡ALERTA GENERAL!', COLORS.blood, 2, 'LA CÁMARA TE HA VISTO'); }
      }
    }
  }

  sound(op) { this.game.playAt('alert', op.x, op.y, 1); }

  detected(c) {
    const g = this.game, op = this.operator;
    if (this.radio || this.alarmCd > 0 || !op || !op.alive) return;
    if (op.state === 'down') return;
    this.radio = { t: RADIO_TIME, x: g.player.x, y: g.player.y };
    op.radioT = RADIO_TIME;
    g.bark(op, '¡INTRUSO EN LA CÁMARA!', true);
    g.addFloat(g.player.x, g.player.y - 24, '¡DETECTADO!', COLORS.blood, 1, 1.2);
    g.camera.addShake(3);
  }

  operatorDown(op) {
    const g = this.game;
    this.disabled = true;
    this.radio = null;
    op.radioT = 0;
    const stealth = !this.alarmed;
    g.showCallout('CÁMARAS CIEGAS', COLORS.player, 2, stealth ? '¡OPERADOR ELIMINADO! +' + STEALTH_BONUS : 'OPERADOR ELIMINADO');
    if (stealth) g.score.addBonus(STEALTH_BONUS);
    g.sfx.play('unlock');
    for (const c of this.list) g.particles.neon(c.x, c.y, Math.random() * 6.28, 6, 3);
  }

  // Conos de luz en el suelo (bajo los personajes): ámbar suave, y rojo y más intenso cuando la cámara ve al jugador.
  drawCones(ctx) {
    if (!this.active) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const c of this.list) {
      const len = Math.min(RANGE, castRay(this.game.map, c.x, c.y, c.a, RANGE));
      const hot = c.meter > 0.02;
      ctx.fillStyle = hot ? '#ff2a4a' : '#ffbe0b';
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.a);
      for (let k = 14; k < len; k += 8) {
        ctx.globalAlpha = (hot ? 0.12 + c.meter * 0.12 : 0.08) * (1 - k / (RANGE + 40));
        const half = Math.tan(HALF_FOV) * k;
        ctx.fillRect(k, -half, 8, half * 2);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // Cuerpos de las cámaras (sobre las paredes): base en la pared, cuerpo orientado a su rumbo y un piloto que parpadea (rojo al detectar; apagado si están ciegas).
  drawBodies(ctx) {
    for (const c of this.list) {
      const x = Math.round(c.wx), y = Math.round(c.wy);
      ctx.fillStyle = '#0a0a14'; pixelRect(ctx, x - 6, y - 6, 12, 12);
      ctx.fillStyle = this.disabled ? '#3a3a52' : '#6b6b85'; pixelRect(ctx, x - 5, y - 5, 10, 10);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.a);
      ctx.fillStyle = '#14141e'; pixelRect(ctx, -6, -4, 12, 8);
      ctx.fillStyle = this.disabled ? '#2b2b3a' : '#9d8fb8'; pixelRect(ctx, -5, -3, 10, 6);
      ctx.fillStyle = this.disabled ? '#0a0a14' : (c.meter > 0.02 ? '#ff2a4a' : '#05d9e8'); pixelRect(ctx, 4, -2, 4, 4); // lente
      ctx.restore();
      if (!this.disabled && (c.meter > 0.02 ? Math.floor(c.blink * 8) % 2 : Math.floor(c.blink * 1.5) % 2)) { ctx.fillStyle = '#ff2a4a'; pixelRect(ctx, x - 3, y - 3, 2, 2); }
    }
  }

  drawDebug(ctx) {
    ctx.save();
    ctx.strokeStyle = '#00ff9f';
    for (const c of this.list) {
      ctx.beginPath(); ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(c.a - HALF_FOV) * RANGE, c.y + Math.sin(c.a - HALF_FOV) * RANGE);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(c.a + HALF_FOV) * RANGE, c.y + Math.sin(c.a + HALF_FOV) * RANGE);
      ctx.stroke();
    }
    ctx.restore();
  }
}
