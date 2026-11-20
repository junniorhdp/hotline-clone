import { moveAndSlide, lineOfSight, isSolidAt, castRay } from './map.js';
import { WEAPON_DEFS, Bullet, Pickup, inMeleeArc, drawWeaponShape } from './weapons.js';
import { VOMIT } from './particles.js';
import { COLORS, TAU, angleDiff, clamp } from './utils.js';
import { drawSprite, sprites, pixelRect, pixelDisc, drawMaskHead, maskHead, playerBody, BLOOD_LEVELS, WORLD_PX } from './sprites.js';
import { DEFAULT_EFFECTS } from './masks.js';
import { drawText } from './pixelfont.js';
import { AGENTS } from './portraits.js';

const SPEED = 228;           // antes 210: un ~9% más rápido
// El movimiento ya responde al instante (no hay inercia), así que la "aceleración" es un
// empujón: al arrancar desde parado o girar en seco, la velocidad sube un DODGE_BOOST y cae
// enseguida. Da ese primer paso explosivo al esquivar sin quitar control en el resto.
const DODGE_BOOST = 0.3;      // fracción extra de velocidad en el primer instante
const DODGE_TURN_COS = 0.35;  // giro de más de ~70° respecto al rumbo anterior
const DODGE_DECAY = 0.13;     // s: constante de caída del empujón
const PICKUP_RADIUS = 30;
const BUFF_SPEED = 1.18;       // lata de la máquina expendedora (game.buff): +18 % de velocidad…
const MAX_SPEED_STACK = 1.45;  // tope del multiplicador de velocidad acumulado (pico con empujón ≈ 430 u/s: < 7,2 u por paso, sin atravesar paredes)
const BUFF_COOLDOWN = 0.8;     // …y -20 % de espera entre ataques
const THROW_SPEED = 720;
const NOISE_RADIUS_KICK = 420; // una patada a una puerta se oye mucho más lejos que abrirla andando (antes 260)
export const FINISH_RANGE = 34;      // distancia (además del radio) para rematar; cubre el empuje del derribo
// Ejecución de un derribado: el jugador queda clavado `time` segundos y el/los golpes caen en `hits` (s).
// Cada arma tiene su estilo (ver startExecution): el último golpe es el que mata (o daña al jefe); los
// anteriores solo hieren (sangre, sacudida y sonido) para que se vea un remate brutal y distinto.
export const EXEC_STYLES = {
  stomp: { time: 0.42, hits: [0.27] },              // sin arma: pisotón
  smash: { time: 0.42, hits: [0.27] },
  cleaver: { time: 0.44, hits: [0.15, 0.31] },      // cuchillo de carnicero (BLADE): dos hachazos rápidos              // arma de fuego vacía: culatazo de arriba abajo
  bat: { time: 0.64, hits: [0.44] },                // bate: swing enorme y lento hacia la cabeza
  pipe: { time: 0.58, hits: [0.2, 0.4] },           // tubo: dos golpes secos
  rustpipe: { time: 0.58, hits: [0.2, 0.4] },       // tubo oxidado: igual que el tubo
  knife: { time: 0.7, hits: [0.17, 0.3, 0.44] },    // cuchillo: tres puñaladas
  shoot: { time: 0.42, hits: [0.27] },              // pistola: disparo a quemarropa
  blast: { time: 0.52, hits: [0.32] },              // escopeta: descarga con gran retroceso
  burst: { time: 0.52, hits: [0.24, 0.31, 0.38] },  // subfusil: ráfaga de tres
};
// Armas con la misma ejecución y gesto de ataque que una base (las improvisadas de la calle).
const STYLE_ALIAS = { rustpipe: 'pipe', crowbar: 'pipe', rustknife: 'knife', cleaver: 'pipe', nailbat: 'bat' };
// El cuchillo de carnicero tiene su propia ejecución (EXEC_STYLES.cleaver) pero se anima como el tubo (levanta y golpea).
const POSE_STYLE = { cleaver: 'pipe' };
// Retroceso al disparar (segundos que dura, empuje del arma hacia atrás y del cuerpo, y si bombea).
const RECOIL = {
  gun: { time: 0.14, kick: 3, lean: 1 },
  shotgun: { time: 0.5, kick: 6, lean: 3, pump: true },
  smg: { time: 0.07, kick: 1.5, lean: 0.5 },
};
const EXEC_NOISE = 220;       // ruido (radio) de un golpe sordo; con arma de fuego es el de su disparo
const STEP_INTERVAL = 0.3;
const KICK_COOLDOWN = 0.35;
const AIM_MAX_DIST = 360;    // largo máximo del indicador de apuntado (armas de alcance ilimitado)
const AIM_START = 18;        // el indicador empieza en la boca del arma
const AIM_DOT_SPACING = 10;

// Sangre acumulada (`gore`: suma de la `power` de cada baja, ver KILL_FEEL en game.js) que hace
// falta para cada nivel visible de sangre en el personaje. Hay BLOOD_LEVELS niveles. Un piso
// tiene 5-11 enemigos: el nivel 2-3 llega acabando el primero y el máximo bien entrado el tercero.
const BLOOD_STEPS = [1, 3, 6, 10, 15];

// Suelas manchadas: pisar sangre fresca (un cadáver o un charco de baja) las empapa y al andar
// dejan huellas rojas que alternan pie y se van apagando. Una carga da entre SOLE_MIN y SOLE_MAX
// pisadas.
const SOLE_MIN = 8;
const SOLE_MAX = 14;
const STEP_DIST = 24;       // unidades entre pisadas (alternando pie izquierdo y derecho)
const FOOT_SPREAD = 5;      // cuánto se separa cada pie del eje de la marcha
const SOLE_FADE = 0.88;     // cuánto baja la intensidad entre la primera huella y la última

export function bloodLevelFor(gore) {
  let level = 0;
  while (level < BLOOD_LEVELS && gore >= BLOOD_STEPS[level]) level++;
  return level;
}

const DOOR_REACH = 44; // distancia mínima al centro de la puerta principal durante la animación: fuera del barrido de la hoja (radio ~32 + el del jugador)
export class Player {
  // `perks` = efectos de la máscara elegida y `maskId` su aspecto (ver masks.js): la cabeza que
  // se pinta sobre el cuerpo es la de esa máscara, así que en el piso se ve la que se eligió.
  // `masked` = false al llegar en moto: va sin máscara (la lleva en la mano) hasta `putOnMask`.
  constructor(x, y, perks = DEFAULT_EFFECTS, maskId = 'neon', masked = true) {
    this.x = x;
    this.y = y;
    this.r = 10;
    this.angle = 0;
    this.perks = perks;
    this.maskId = maskId;
    this.masked = masked;
    this.agentId = 'main'; // 'main' (el primer agente) | 'support' (el compañero del relevo, ver Game.swapControl)
    this.gender = 'male';
    this.handT = 0;    // s que le quedan mirándose la mano tras recoger una moneda con la máscara de Rick (lore.js)
    this.vomit = null; // { t, dur, spurts, wasMasked }: vomitando por culpa (ver startVomit)
    this.doorAnim = null; // { kind: 'close' | 'open', t, door, fired }: el agente cierra la puerta principal al entrar / la abre al despejar (ver startDoorAnim)
    this.bloodLevel = 0;  // 0..BLOOD_LEVELS: cuánta sangre lleva encima (lo fija Game)
    this.soleTox = false; // las suelas llevan sangre VERDE (pisó sangre tóxica): las huellas salen verdes
    this.soles = 0;       // pisadas manchadas que le quedan
    this.solesMax = 0;    // las de la carga actual (para saber en qué punto de la secuencia va)
    this.stride = 0;      // distancia recorrida desde la última huella
    this.foot = 1;        // 1 / -1: pie que toca
    this.exec = null;     // ejecución en curso: { target, t, hit, style }
    // null = puños, o { type, ammo }
    const start = masked ? perks.startWeapon : null; // sin máscara no hay arma de la máscara todavía
    this.weapon = start ? { type: start, ammo: WEAPON_DEFS[start].maxAmmo || 0 } : null;
    this.cooldown = 0;
    this.swing = 0;
    this.swingDur = 1;
    this.punchSide = 1;
    this.muzzle = 0;
    this.gender = 'male'; // 'male' | 'female': SOLO cosmético (sprite, retrato y voz); lo fija Game (ajuste playerGender)
    this.tailA = 0;       // ángulo de balanceo de la cola de caballo (rad)
    this.prevAngle = 0;
    this.recoil = 0;      // s restantes del retroceso del arma (ver RECOIL)
    this.recoilMax = 1;
    this.noAmmoFlash = 0;
    this.stepTimer = 0;
    this.bumpCd = 0;
    this.boost = 0;       // empujón de esquive vigente (fracción de velocidad extra)
    this.moving = false;  // ¿se movía el fotograma anterior?
    this.hx = 0;          // rumbo anterior (dirección normalizada)
    this.hy = 0;
    this.alive = true;
  }

  get def() {
    return WEAPON_DEFS[this.weapon ? this.weapon.type : 'fists'];
  }

  update(dt, game) {
    const { input, map } = game;
    this.handT = Math.max(0, this.handT - dt);
    let mx = 0, my = 0;
    // Controles de PC reasignables (keybinds.js): se pregunta al mapa vigente, nunca a códigos fijos.
    const keys = game.keys;
    if (keys.down('moveLeft')) mx -= 1;
    if (keys.down('moveRight')) mx += 1;
    if (keys.down('moveUp')) my -= 1;
    if (keys.down('moveDown')) my += 1;
    // Teclado: dirección normalizada (velocidad completa). Joystick: analógico, la velocidad
    // es proporcional a cuánto se empuja.
    let mag = 1;
    if (mx || my) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
    } else if (input.moveAxis.x || input.moveAxis.y) {
      mag = Math.min(1, Math.hypot(input.moveAxis.x, input.moveAxis.y));
      mx = input.moveAxis.x / (mag || 1);
      my = input.moveAxis.y / (mag || 1);
    }

    // Ejecutando: sin movimiento, ataque ni recoger/lanzar hasta que acabe (EXEC_TIME).
    if (this.exec) { this.updateExecution(dt, game); return; }
    if (this.vomit) { this.updateVomit(dt, game); return; } // vomitando: quieto, sin máscara y vulnerable
    if (this.doorAnim) { this.updateDoorAnim(dt, game); return; } // cerrando / abriendo la puerta principal: sin control unos instantes
    this.bumpCd = Math.max(0, this.bumpCd - dt);
    this.boost *= Math.exp(-dt / DODGE_DECAY);
    const startX = this.x, startY = this.y;
    if (mx || my) {
      // Arrancar desde parado o girar en seco renueva el empujón (no se acumula).
      if (!this.moving || mx * this.hx + my * this.hy < DODGE_TURN_COS) this.boost = DODGE_BOOST;
      this.hx = mx;
      this.hy = my;
      this.moving = true;
      // Los bonus de velocidad se SUMAN (STRIKE +30 %, lata +18 %) y el total tiene tope: así no se disparan al acumularse.
      const bonus = (this.perks.speedMul - 1) + (game.buff ? BUFF_SPEED - 1 : 0);
      const speed = SPEED * Math.min(MAX_SPEED_STACK, 1 + bonus) * mag * (1 + this.boost);
      const hit = moveAndSlide(map, this, mx * speed * dt, my * speed * dt);
      if ((hit.hitX || hit.hitY) && this.bumpCd <= 0) {
        game.particles.dust(this.x + (hit.hitX ? Math.sign(mx) * this.r : 0), this.y + (hit.hitY ? Math.sign(my) * this.r : 0), 4);
        this.bumpCd = 0.35;
      }
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        game.sfx.play('step', 0.8);
        this.stepTimer = STEP_INTERVAL;
      }
    } else {
      this.stepTimer = 0.05;
      this.moving = false;
    }
    this.updateSoles(game, Math.hypot(this.x - startX, this.y - startY));

    if (input.touchMode) {
      // Táctil: mira con el joystick derecho; si no se usa, mira hacia donde camina.
      if (input.aimActive) this.angle = input.aimAngle;
      else if (mx || my) this.angle = Math.atan2(my, mx);
    } else {
      const m = game.mouseWorld();
      this.angle = Math.atan2(m.y - this.y, m.x - this.x);
    }

    this.updateTail(dt, mx || my);
    this.cooldown -= dt;
    this.swing = Math.max(0, this.swing - dt);
    this.recoil = Math.max(0, this.recoil - dt);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.noAmmoFlash = Math.max(0, this.noAmmoFlash - dt);

    // Melee y subfusil: se puede mantener pulsado. Pistola/escopeta: un clic, un disparo.
    // Joystick derecho mantenido: ataca con cualquier arma al ritmo de su cadencia; un toque
    // rápido en él o en el botón ATACAR (`tapAttack`) da un único ataque; ATACAR mantenido
    // (`attackHeld`) ataca de forma continua.
    const wantsAttack = input.aimFiring || input.tapAttack || input.attackHeld
      || (this.def.melee || this.def.auto ? keys.down('attack') : keys.pressed('attack'));
    if (wantsAttack && this.cooldown <= 0) {
      this.attack(game);
      input.tapAttack = false;
    }
    if (keys.pressed('throw')) this.throwOrPickup(game);
    // REMATAR: remata a un derribado en rango. PATEAR/INTERACTUAR: lo mismo si hay uno a tiro y, si no, patada a la puerta.
    const kickKey = keys.pressed('kick'), execKey = keys.pressed('execute');
    if ((kickKey || execKey) && this.cooldown <= 0) {
      const target = this.executionTarget(game);
      if (target) this.startExecution(game, target);
      else if (kickKey) this.kick(game);
    }
  }

  // Destello del disparo: además del sprite del fogonazo, un halo de luz aditivo (más pequeño al apagarse) que ilumina
  // un instante el suelo y al propio jugador. (x, y) = boca del arma en coordenadas locales (ctx ya girado).
  drawMuzzleGlow(ctx, x, y) {
    const k = clamp(this.muzzle / 0.06, 0, 1);
    if (k <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18 * k;
    ctx.fillStyle = '#ffbe0b';
    pixelDisc(ctx, x, y, 9, WORLD_PX);
    ctx.globalAlpha = 0.4 * k;
    ctx.fillStyle = '#ffe08a';
    pixelDisc(ctx, x, y, 5, WORLD_PX);
    ctx.globalAlpha = 0.8 * k;
    ctx.fillStyle = '#ffffff';
    pixelDisc(ctx, x, y, 2, WORLD_PX);
    ctx.restore();
  }

  // El personaje que NO se controla (el compañero del relevo): solo anima la cola de caballo y recupera el enfriamiento; queda quieto, visible y vulnerable.
  idleUpdate(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.updateTail(dt, false);
  }

  // Cola de caballo (solo aspecto femenino): se balancea de lado a lado al correr y se queda atrás al girar, y vuelve a
  // su sitio al pararse. Es solo dibujo: no afecta a la física ni a nada jugable.
  updateTail(dt, moving) {
    const turn = angleDiff(this.angle, this.prevAngle);
    this.prevAngle = this.angle;
    const t = performance.now() / 1000;
    const target = clamp(-turn * 5, -0.8, 0.8) + (moving ? Math.sin(t * 18) * 0.3 : Math.sin(t * 2) * 0.04);
    this.tailA += (target - this.tailA) * Math.min(1, dt * 14);
  }

  // Mientras pisa sangre las suelas se mantienen empapadas (y no se imprime nada, no se vería);
  // al salir empieza la secuencia: una huella cada STEP_DIST de camino real (si choca con una
  // pared no avanza y no pisa), alternando pie, orientada según el rumbo. La intensidad baja de
  // 1 en la primera a 1 - SOLE_FADE en la última.
  updateSoles(game, moved) {
    if (!game.goreOn) { this.soles = 0; return; } // sin sangre: ni suelas manchadas ni huellas
    const fluid = game.bloodUnderfoot(this.x, this.y); // 0 nada · 1 sangre roja · 2 sangre verde
    if (fluid) {
      this.wetSoles();
      this.soleTox = fluid === 2; // el último charco pisado manda: rojo o verde
      game.soak(fluid === 2, this.angle); // pisar un charco también te mancha (y tiñe la máscara del HUD con su color)
      return;
    }
    if (this.soles <= 0 || moved <= 0) return;
    this.stride += moved;
    while (this.stride >= STEP_DIST && this.soles > 0) {
      this.stride -= STEP_DIST;
      const k = this.solesMax - this.soles;
      this.soles--;
      this.foot = -this.foot;
      const intensity = 1 - SOLE_FADE * Math.pow(k / Math.max(1, this.solesMax - 1), 0.85);
      game.prints.add(this.x - this.hy * this.foot * FOOT_SPREAD, this.y + this.hx * this.foot * FOOT_SPREAD,
        Math.atan2(this.hy, this.hx), intensity, this.soleTox);
    }
  }

  // Al cruzar el umbral del edificio se pone la máscara que llevaba en la mano: una ráfaga de neón
  // y un clic. Desde ese momento llevan su efecto las pasivas que dependen de ella: el arma
  // inicial de BLADE solo se da si no se ha cogido ya otra por el camino.
  putOnMask(game) {
    if (this.masked) return;
    this.masked = true;
    const start = this.perks.startWeapon;
    if (start && !this.weapon) this.weapon = { type: start, ammo: WEAPON_DEFS[start].maxAmmo || 0 };
    game.particles.neon(this.x, this.y, this.angle, 14, Math.PI);
    game.sfx.play('maskOn');
  }

  // --- Culpa: vómito ---------------------------------------------------------------------------
  // Tras matar a un civil el jugador se quita la máscara (queda en su mano) y vomita tres arcadas en el suelo, a unos 2,7 s en total:
  // sin movimiento, ataque ni recoger/lanzar, y vulnerable (el juego es de un golpe). Al acabar se vuelve a poner la máscara.
  // Cerrar la puerta principal al entrar (`close`: se gira, da un paso hacia ella y tira de la hoja; se cierra y se bloquea a mitad de la animación) y abrirla al despejar
  // el piso (`open`: al llegar a ella). ~0,9 s sin control; el arma se guarda un momento. La hoja se mueve en `fired` (0,5 s): ver Door.lock / unlock.
  startDoorAnim(game, kind, door) {
    if (!game.doorAnimOn || this.doorAnim || !this.alive) { if (kind === 'close') door.lock(); else door.unlock(); return; } // (sin animación —opción— o si no se puede, el efecto se aplica igual)
    this.doorAnim = { kind, t: 0, dur: 0.8, door, fired: false };
    this.moving = false; this.swing = 0; this.recoil = 0; this.muzzle = 0;
  }

  updateDoorAnim(dt, game) {
    const a = this.doorAnim, d = a.door;
    a.t += dt;
    this.cooldown = Math.max(this.cooldown, 0.3);
    const to = Math.atan2(d.cy - this.y, d.cx - this.x);
    this.angle += clamp(angleDiff(to, this.angle), -14 * dt, 14 * dt);                  // se gira hacia la puerta
    if (a.t > 0.2 && a.t < 0.55 && Math.hypot(d.cx - this.x, d.cy - this.y) > DOOR_REACH) {     // y da un paso hacia ella (sin entrar en el barrido de la hoja: al cerrarse empujaría hacia la calle)
      const k = 130 * dt;
      moveAndSlide(game.map, this, Math.cos(to) * k, Math.sin(to) * k);
    }
    if (!a.fired && a.t >= 0.5) {
      a.fired = true;
      if (a.kind === 'close') {
        d.lock();
        if (this.y > d.cy - DOOR_REACH * 0.7) { this.y = d.cy - DOOR_REACH; moveAndSlide(game.map, this, 0, 0); } // salvaguarda: si por lo que sea queda pegado a la hoja o fuera, se le deja dentro
      }
      else {
        d.unlock();
        game.sfx.play('unlock');
        game.showCallout('SALIDA ABIERTA', COLORS.player, 1.8, `${AGENTS[this.gender].name} ABRE LA PUERTA`); // el objetivo «REGRESA A LA MOTO» sale al apagarse
      }
    }
    if (a.t >= a.dur) { this.doorAnim = null; this.cooldown = Math.max(this.cooldown, 0.15); }
  }

  // `shock`: vómito de IMPACTO al ver la pila de cuerpos del piso 5 (lore.js): misma animación, pero NO viene de la culpa (no toca el karma ni la puntuación).
  startVomit(game, shock = false) {
    if (this.vomit || !this.alive) return;
    this.vomit = { t: 0, dur: 2.7, spurts: 0, wasMasked: this.masked, shock };
    this.masked = false;
    this.moving = false; this.swing = 0; this.recoil = 0; this.muzzle = 0;
    game.sfx.play('maskOn', 0.6);
    game.addFloat(this.x, this.y - 20, 'NO PUEDO MÁS...', '#c6d65a', 1, 1.6);
  }

  updateVomit(dt, game) {
    const v = this.vomit;
    v.t += dt;
    this.cooldown = Math.max(this.cooldown, 0.3);
    const times = [0.75, 1.3, 1.85];
    if (v.spurts < times.length && v.t >= times[v.spurts]) {
      const k = v.spurts++, a = this.angle;
      const mx = this.x + Math.cos(a) * 14, my = this.y + Math.sin(a) * 14;
      game.sfx.play('retch', 0.9);
      game.particles.blood(mx, my, a, 10, 0.45, VOMIT);
      game.vomitSplat(mx + Math.cos(a) * 6 * k, my + Math.sin(a) * 6 * k, a, 0.55 + 0.12 * k);
      game.camera.addShake(3);
      if (k === 0) game.addFloat(mx, my - 14, '¡BLEEEH!', '#c6d65a', 1, 1.2);
    }
    if (v.t >= v.dur) {
      this.vomit = null;
      if (!v.shock && game.lore) game.lore.onGuiltVomitEnd(); // la frase fría de CENTRAL: solo tras el vómito por culpa
      if (v.wasMasked) { this.masked = true; game.particles.neon(this.x, this.y, this.angle, 8, Math.PI); game.sfx.play('maskOn'); }
      this.cooldown = 0.4;
    }
  }

  // Cuánto se echa el cuerpo hacia delante al vomitar (se encorva, con sacudidas en cada arcada).
  vomitLean() {
    const t = this.vomit.t;
    const base = t < 0.3 ? 3 * (t / 0.3) : t > 2.3 ? 3 * (1 - (t - 2.3) / 0.4) : 3;
    return base + (t > 0.6 && t < 2.2 ? 1.5 * Math.sin(t * 20) : 0);
  }

  // --- Ejecución (remate de un enemigo derribado) --------------------------------------------
  // El derribado más cercano a tiro de remate: en rango cuerpo a cuerpo, a la vista (ni una pared
  // ni una puerta se atraviesan) y que no esté ya siendo rematado. Lo usan el ataque, la tecla E y
  // el indicador del HUD, así que lo que se marca en pantalla es exactamente a quien se golpea.
  executionTarget(game) {
    let best = null, bestDist = FINISH_RANGE;
    for (const e of game.enemies) {
      if (!e.alive || e.state !== 'down' || e.executing) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y) - e.r;
      if (d < bestDist && lineOfSight(game.map, this.x, this.y, e.x, e.y)) { best = e; bestDist = d; }
    }
    return best;
  }

  // Empieza la ejecución: el jugador se queda clavado mirando al objetivo. El estilo sale del arma:
  // sin arma pisotón; bate (swing enorme), tubo (dos golpes), cuchillo (tres puñaladas); con balas pistola
  // (a quemarropa), escopeta (descarga) y subfusil (ráfaga de tres); un arma de fuego vacía, a culatazos.
  startExecution(game, target) {
    const w = this.weapon, def = this.def;
    let style = 'stomp';
    if (w) {
      if (def.melee) style = w.type === 'cleaver' ? 'cleaver' : STYLE_ALIAS[w.type] || w.type; // bat | pipe | knife | cleaver
      else if (w.ammo > 0) style = { gun: 'shoot', shotgun: 'blast', smg: 'burst' }[w.type] || 'shoot';
      else style = 'smash';
    }
    this.exec = { target, t: 0, hit: false, hitIdx: 0, style, spec: EXEC_STYLES[style] };
    target.executing = true; // congela su aturdimiento: no se levanta a mitad del golpe
    this.swing = 0;
    this.moving = false;
    this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    game.sfx.play('execWind');
  }

  // Se suelta al objetivo y se libera al jugador (la secuencia terminó o se interrumpió).
  cancelExecution() {
    if (!this.exec) return;
    this.exec.target.executing = false;
    this.exec = null;
  }

  updateExecution(dt, game) {
    const ex = this.exec, e = ex.target, hits = ex.spec.hits;
    this.recoil = Math.max(0, this.recoil - dt);
    this.muzzle = Math.max(0, this.muzzle - dt);
    // Si el objetivo desaparece antes del último golpe (lo mató otra cosa, se reinició...), se aborta limpio.
    if (!ex.hit && (!e.alive || e.state !== 'down')) { this.cancelExecution(); return; }
    this.angle = Math.atan2(e.y - this.y, e.x - this.x);
    ex.t += dt;
    while (this.exec && ex.hitIdx < hits.length && ex.t >= hits[ex.hitIdx]) {
      const last = ex.hitIdx === hits.length - 1;
      ex.hitIdx++;
      if (last) ex.hit = true;
      this.landExecution(game, ex, last);
    }
    if (this.exec && ex.t >= ex.spec.time) {
      this.cancelExecution();
      this.cooldown = 0.12;
    }
  }

  // Un golpe de la ejecución. Los intermedios (tubo, cuchillo, ráfaga) solo hieren; el último es la baja
  // con todo el feedback (hit-stop, sacudida, crujido, charco grande y puntos de EJECUCIÓN van en
  // `killEnemy`) y, de la parte del jugador, las suelas empapadas.
  landExecution(game, ex, last) {
    const e = ex.target, def = this.def, style = POSE_STYLE[ex.style] || ex.style;
    const angle = Math.atan2(e.y - this.y, e.x - this.x);
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    const gun = style === 'shoot' || style === 'blast' || style === 'burst';
    if (gun) {
      this.weapon.ammo--;
      game.particles.sparks(this.x + cos * 18, this.y + sin * 18, this.angle, style === 'blast' ? 16 : 9, style === 'blast' ? 0.9 : 0.5);
      game.particles.shell(this.x + cos * 6, this.y + sin * 6, this.angle + Math.PI / 2);
      game.sfx.play(def.sound);
      this.muzzle = 0.07;
      const rc = RECOIL[this.weapon.type];
      this.recoil = this.recoilMax = rc.time;
      game.makeNoise(this.x, this.y, def.noise);
      if (style === 'blast') { game.camera.addShake(18); game.fx.kick(0.9); }
    } else {
      game.makeNoise(this.x, this.y, EXEC_NOISE);
      if (style === 'bat' && last) game.camera.addShake(16);
    }
    game.particles.dust(e.x, e.y, last ? 8 : 4);
    if (!last) {
      // Golpe intermedio: hiere (no mata). La víctima salpica y el aire se llena de chispas.
      game.woundEnemy(e, angle, style);
      return;
    }
    const tox = game.isToxicKill(e, 'execution');
    game.killEnemy(e, angle, 'execution');
    this.wetSoles();
    this.soleTox = tox; // rematar con un arma oxidada (o a un intoxicado) deja huellas verdes
  }

  // Suelas empapadas: entre SOLE_MIN y SOLE_MAX huellas al andar.
  wetSoles() {
    this.soles = this.solesMax = SOLE_MIN + Math.floor(Math.random() * (SOLE_MAX - SOLE_MIN + 1));
    this.stride = STEP_DIST / 2; // el primer paso al salir llega pronto
  }

  startSwing(def) {
    this.swing = this.swingDur = def.swingTime || 0.14;
    this.punchSide *= -1;
  }

  attack(game) {
    const def = this.def;
    this.cooldown = def.cooldown * (game.buff ? BUFF_COOLDOWN : 1);

    // 1) Remate: con cualquier arma, si hay un derribado a tiro empieza la ejecución (en vez de
    //    un golpe al aire).
    const target = this.executionTarget(game);
    if (target) {
      this.startExecution(game, target);
      return;
    }

    // 2) Golpe cuerpo a cuerpo: los puños derriban, el bate mata.
    if (def.melee) {
      this.startSwing(def);
      game.sfx.play('swing');
      let hit = false;
      for (const e of game.enemies) {
        if (!e.alive || e.state === 'down') continue;
        // INICIATIVA: quien golpea primero gana. Un enemigo que ya prepara su golpe o su disparo (windup/aim) se alcanza
        // con un arco más amplio y 6 u más de alcance: tu golpe conecta antes de que él lo complete.
        const reachDef = e.windup > 0 || e.aim > 0 ? { ...def, range: def.range + 6, arc: Math.min(Math.PI * 1.2, def.arc * 1.3) } : def;
        if (inMeleeArc(this.x, this.y, this.angle, reachDef, e) && lineOfSight(game.map, this.x, this.y, e.x, e.y)) {
          // Con la máscara OSO los puños también matan al instante.
          if (def.knockdown && !(this.perks.meleeLethal && !this.weapon)) { // (la pasiva de BRUTE solo mata con los puños, no con la palanca)
            game.knockDown(e, this.angle, 'fists');
            game.stainWeapon(0.5, !!e.toxic); // (la palanca derriba: se mancha un poco)
            if (def.downMul && e.state === 'down') e.timer *= def.downMul;
          } else if (def.poison && !e.guardKill) { game.poisonEnemy(e, this.angle, def.poisonTime); game.stainWeapon(0.8, true); } // armas oxidadas: noquean e intoxican (y se manchan de verde)
          else game.killEnemy(e, this.angle, 'melee');
          hit = true;
        }
      }
      // Los civiles de la calle también reciben el golpe (huyen y penalizan al final del piso: ver StreetLife.meleeHit).
      if (!game.sewerRun && game.street.meleeHit(this, def)) hit = true; // (en el túnel de la alcantarilla no hay civiles ni rehenes: sus posiciones son las de la calle)
      if (!game.sewerRun && game.hostages.meleeHit(this, def)) hit = true; // rehén: el primer golpe lo tumba (aviso), el segundo lo mata
      // Si no hay a quién pegar pero hay una puerta delante, el golpe es una patada.
      const kicked = !hit && game.kickDoor(this);
      if (!kicked) game.recordAttack(this.weapon ? this.weapon.type : 'fists', hit); // estadísticas: golpe y si conectó
      game.camera.addShake(def.shake);
      return;
    }

    // 3) Disparo (pistola: 1 bala; escopeta: varios perdigones de alcance corto).
    if (this.weapon.ammo <= 0) {
      this.noAmmoFlash = 0.6;
      game.sfx.play('empty');
      return;
    }
    this.weapon.ammo--;
    const shotId = game.recordAttack(this.weapon.type, false); // estadísticas: un disparo (acierta si alguna bala suya alcanza a alguien)
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    let bx = this.x + cos * 14, by = this.y + sin * 14;
    if (isSolidAt(game.map, bx, by)) { bx = this.x; by = this.y; }
    for (let i = 0; i < def.pellets; i++) {
      const a = this.angle + (Math.random() - 0.5) * def.spread * this.perks.spreadMul * 2;
      const speed = def.bulletSpeed * this.perks.bulletSpeedMul * (def.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
      const bl = new Bullet(bx, by, a, speed, 'player', def.range);
      bl.src = this.weapon.type; // el jefe distingue el arma (ver Boss.guardKill)
      bl.shot = shotId;
      game.bullets.push(bl);
    }
    game.particles.sparks(this.x + cos * 22, this.y + sin * 22, this.angle, def.pellets > 1 ? 14 : 7, 0.45);
    game.particles.shell(this.x + cos * 6, this.y + sin * 6, this.angle + Math.PI / 2);
    game.sfx.play(def.sound);
    this.muzzle = 0.05;
    const rc = RECOIL[this.weapon.type];
    if (rc) this.recoil = this.recoilMax = rc.time;
    game.camera.addShake(def.shake);
    game.fx.kick(def.pellets > 1 ? 0.45 : 0.25);
    game.makeNoise(this.x, this.y, def.noise);
  }

  kick(game) {
    if (game.kickDoor(this)) {
      this.cooldown = KICK_COOLDOWN;
      game.makeNoise(this.x, this.y, NOISE_RADIUS_KICK);
    }
  }

  throwOrPickup(game) {
    if (this.weapon) {
      let px = this.x + Math.cos(this.angle) * 12;
      let py = this.y + Math.sin(this.angle) * 12;
      if (isSolidAt(game.map, px, py)) { px = this.x; py = this.y; }
      const p = new Pickup(this.weapon.type, px, py, this.weapon.ammo);
      p.angle = this.angle;
      p.blood = this.weapon.blood || null; // lanzada, sigue manchada
      p.throwAt(this.angle, THROW_SPEED);
      game.pickups.push(p);
      game.sfx.play('throw');
      this.weapon = null;
      this.cooldown = 0.15;
      return;
    }

    let best = null, bestDist = PICKUP_RADIUS;
    for (const p of game.pickups) {
      if (p.flying) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < bestDist) { best = p; bestDist = d; }
    }
    if (best) {
      this.weapon = { type: best.type, ammo: best.ammo, blood: best.blood || null }; // recogida, conserva su sangre
      best.alive = false;
      game.sfx.play('pickup');
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    const def = this.def;
    const pose = this.exec ? this.execPose() : null;
    let bodyLean = 0; // empuje del cuerpo en el ataque normal (swing, retroceso)
    // Sin máscara puesta la lleva en la mano izquierda (el lado -Y), con el puño agarrándola.
    const inHand = () => { if (!this.masked) drawSprite(ctx, maskHead(this.maskId), 11, -8, 0.3); };

    if (this.doorAnim) {
      // Cerrando / abriendo la puerta: el arma se guarda y las dos manos se adelantan hacia la hoja y tiran de ella (se echan atrás al cerrarse / abrirse).
      const t = this.doorAnim.t, reach = t < 0.5 ? 6 + 10 * Math.min(1, t / 0.4) : 16 - 8 * Math.min(1, (t - 0.5) / 0.3);
      drawSprite(ctx, 'fist', reach, 6);
      drawSprite(ctx, 'fist', reach, -6);
    } else if (pose) {
      if (!pose.raised) this.drawExecTool(ctx, pose);
    } else if (this.weapon) {
      // Cada arma tiene su gesto: el bate y el tubo barren un arco (el bate arranca lento y acaba
      // fuerte), el cuchillo puñala hacia delante sin girar, y las de fuego retroceden (la escopeta,
      // además, bombea). El cuerpo acompaña con un pequeño empuje (`bodyLean`).
      const type = this.weapon.type;
      let swingOffset = 0, wx = 10, wy = 6;
      if (def.melee && this.swing > 0) {
        const t = 1 - this.swing / this.swingDur;
        if ((STYLE_ALIAS[type] || type) === 'knife') {
          const p = Math.sin(t * Math.PI);
          wx += 11 * p; wy -= 2 * p;
          swingOffset = 0.12 * this.punchSide * p;
          bodyLean = 2 * p;
        } else {
          const e = (STYLE_ALIAS[type] || type) === 'bat' ? Math.pow(t, 1.6) : t;
          swingOffset = (e - 0.5) * def.arc * this.punchSide;
          bodyLean = ((STYLE_ALIAS[type] || type) === 'bat' ? 3 : 2) * Math.sin(t * Math.PI);
        }
      } else if (this.recoil > 0 && RECOIL[type]) {
        const rc = RECOIL[type], u = this.recoil / this.recoilMax; // 1 → 0
        wx -= rc.kick * u * u;
        bodyLean = -rc.lean * u * u;
        if (rc.pump && u < 0.6) wx -= 3 * Math.sin(((0.6 - u) / 0.6) * Math.PI); // bombeo de la corredera
      }
      ctx.save();
      ctx.rotate(swingOffset);
      drawSprite(ctx, 'fist', wx, wy);
      drawWeaponShape(ctx, type, wx, wy, 0, def.maxAmmo > 0 && this.weapon.ammo <= 0, undefined, this.weapon.blood);
      if (this.muzzle > 0) {
        drawSprite(ctx, 'muzzle', wx + sprites()[type].width * 2, wy);
        this.drawMuzzleGlow(ctx, wx + sprites()[type].width * 2 + 4, wy);
      }
      ctx.restore();
    } else {
      // Puños: el que golpea se adelanta.
      const t = this.swing > 0 ? Math.sin((1 - this.swing / this.swingDur) * Math.PI) : 0;
      for (const side of [1, -1]) {
        const reach = side === this.punchSide ? t * 12 : 0;
        drawSprite(ctx, 'fist', 10 + reach, side * 8);
      }
    }
    if (!pose) inHand();
    if (this.vomit) bodyLean = this.vomitLean();

    // Cuerpo (con la ropa y la sangre que toquen) y encima la cabeza de la máscara, ya en el eje
    // de apuntado. En la ejecución el cuerpo se echa atrás al cargar y hacia delante al golpear.
    ctx.translate(pose ? pose.lean : bodyLean, 0);
    const female = this.gender === 'female';
    drawSprite(ctx, playerBody(this.maskId, this.bloodLevel, this.gender), 0, 0);
    // Cola de caballo: detrás de la cabeza (la base queda bajo ella) y rotada alrededor de su base.
    if (female) drawSprite(ctx, 'ponytail', -3, 0, this.tailA, { ox: 10, oy: 2.5 });
    if (this.handT > 0) { // mirándose la mano (con una moneda): la cabeza se inclina hacia ella y la moneda asoma en el puño
      const k = Math.sin(Math.PI * Math.min(1, 1 - this.handT / 1)) ;
      ctx.rotate(0.45 * k);
      drawMaskHead(ctx, this.masked ? this.maskId : (female ? 'bare_f' : 'bare'), this.bloodLevel);
      ctx.rotate(-0.45 * k);
      ctx.fillStyle = '#140a24'; pixelRect(ctx, 9, 5, 4, 4); ctx.fillStyle = '#ffbe0b'; pixelRect(ctx, 10, 6, 2, 2); ctx.fillStyle = '#7a5300'; pixelRect(ctx, 11, 7, 1, 1);
    } else drawMaskHead(ctx, this.masked ? this.maskId : (female ? 'bare_f' : 'bare'), this.bloodLevel);
    ctx.translate(pose ? -pose.lean : -bodyLean, 0);
    if (pose) {
      // Levantada, la herramienta está más cerca de la cámara: va POR ENCIMA del jugador.
      if (pose.raised) this.drawExecTool(ctx, pose);
    }
    ctx.restore();
  }

  // Pose de la ejecución en coordenadas locales (mirando al objetivo, +X). Cada golpe es un ciclo de
  // carga (de 0 a 1 hasta que cae) y recogida. En vista cenital "arriba" es hacia la cámara: lo que se
  // levanta (pisotón, bate, tubo, culatazo) se ve al doble de tamaño y va POR ENCIMA del jugador. El
  // cuchillo no se levanta: se echa atrás y puñala hacia delante; las armas de fuego apuntan y retroceden.
  execPose() {
    const ex = this.exec, spec = ex.spec, style = POSE_STYLE[ex.style] || ex.style, hits = spec.hits;
    const d = Math.hypot(ex.target.x - this.x, ex.target.y - this.y);
    const reach = Math.max(10, d - 2);
    // Ciclo actual: i = golpe que toca; start = cuándo empezó su carga.
    const i = Math.min(ex.hitIdx, hits.length - 1);
    const start = i > 0 ? hits[i - 1] : 0;
    const landed = ex.t >= hits[i];
    const wind = landed ? 1 : Math.min(1, (ex.t - start) / Math.max(0.001, hits[i] - start));
    const recTime = i < hits.length - 1 ? 0.05 : Math.max(0.05, spec.time - hits[i]);
    const rec = landed ? Math.min(1, (ex.t - hits[i]) / recTime) : 0;
    const k = wind * wind, out = (1 - rec) * (1 - rec);
    const pose = { style, x: 10, y: 6, angle: 0, scale: WORLD_PX, raised: false, lean: 0 };
    const gun = style === 'shoot' || style === 'blast' || style === 'burst';
    if (!landed) {
      pose.lean = -(style === 'bat' ? 5 : 3) * k;
      if (gun) {
        pose.x = 10 + 3 * k;
        pose.y = 6 * (1 - k);
      } else if (style === 'knife') {
        pose.x = 10 - 7 * k;       // el brazo se echa atrás
        pose.y = 5 - 3 * k;
        pose.angle = -0.35 * k;
      } else {
        // La herramienta se levanta ADELANTE, sobre la víctima (si no, tapa al jugador).
        pose.x = style === 'stomp' ? 10 + 12 * k : 10 - 8 * k;
        pose.y = style === 'stomp' ? 0 : 6 - 2 * k;
        pose.angle = style === 'stomp' ? 0 : (style === 'bat' ? -1.3 : -0.9) * k;
        pose.raised = wind > 0.5;
        if (pose.raised) pose.scale = WORLD_PX * (style === 'bat' ? 2.4 : 2);
      }
    } else if (gun) {
      const rc = RECOIL[this.weapon.type];
      pose.lean = -rc.lean * out;
      pose.x = 13 - rc.kick * out;
      pose.y = 6 * rec;
    } else if (style === 'knife') {
      pose.lean = 5 * out;
      pose.x = 10 + (reach - 10) * out;   // la estocada llega hasta la víctima y vuelve
      pose.y = 2 + 4 * rec;
    } else {
      pose.lean = (style === 'bat' ? 7 : 5) * out;
      pose.x = 10 + (reach - 10) * out;
      pose.y = style === 'stomp' ? 0 : 6 * rec;
    }
    return pose;
  }

  drawExecTool(ctx, pose) {
    if (pose.style === 'stomp') {
      for (const side of [1, -1]) drawSprite(ctx, 'fist', 10, side * 8);
      drawSprite(ctx, 'boot', pose.x, pose.y, pose.angle, { scale: pose.scale });
      return;
    }
    drawSprite(ctx, 'fist', pose.x, pose.y, 0, { scale: pose.scale });
    drawWeaponShape(ctx, this.weapon.type, pose.x, pose.y, pose.angle, false, pose.scale, this.weapon.blood);
    if ((pose.style === 'shoot' || pose.style === 'blast' || pose.style === 'burst') && this.muzzle > 0) {
      drawSprite(ctx, 'muzzle', pose.x + sprites()[this.weapon.type].width * 2, pose.y);
      this.drawMuzzleGlow(ctx, pose.x + sprites()[this.weapon.type].width * 2 + 4, pose.y);
    }
  }

  // Indicador de apuntado (PC y móvil), en el mundo y en píxeles:
  // - armas de fuego: línea de puntos desde el arma hasta la primera pared, puerta o enemigo,
  //   limitada al alcance; la escopeta añade dos líneas tenues con su apertura; sin munición
  //   la línea se apaga;
  // - cuerpo a cuerpo: arco de puntos con el alcance y la amplitud del golpe.
  drawAim(ctx, game) {
    const def = this.def;
    ctx.save();
    ctx.fillStyle = COLORS.player;
    if (def.melee) {
      const r = def.range + 4;
      const steps = Math.max(5, Math.round((def.arc * r) / 5));
      ctx.globalAlpha = 0.75;
      for (let i = 0; i <= steps; i++) {
        const a = this.angle - def.arc / 2 + (def.arc * i) / steps;
        pixelRect(ctx, this.x + Math.cos(a) * r - 1, this.y + Math.sin(a) * r - 1);
      }
      ctx.restore();
      return;
    }

    const empty = this.weapon.ammo <= 0;
    const reach = Math.min(def.range, AIM_MAX_DIST);
    const lineLength = (angle, stopAtEnemies) => {
      let len = Math.min(castRay(game.map, this.x, this.y, angle, reach), reach);
      if (!stopAtEnemies) return len;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (const e of game.enemies) {
        if (!e.alive) continue;
        const dx = e.x - this.x, dy = e.y - this.y;
        const along = dx * cos + dy * sin;
        if (along > 0 && along < len && Math.abs(dy * cos - dx * sin) < e.r) len = along;
      }
      return len;
    };
    // size = lado del punto en píxeles internos.
    const dots = (angle, len, spacing, alpha, size) => {
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (let d = AIM_START; d < len; d += spacing) {
        ctx.globalAlpha = alpha * (1 - (d / len) * 0.4);
        pixelRect(ctx, this.x + cos * d - size, this.y + sin * d - size, size, size);
      }
    };

    if (empty) ctx.fillStyle = '#7d6f98';
    const len = lineLength(this.angle, true);
    dots(this.angle, len, AIM_DOT_SPACING, empty ? 0.45 : 0.95, 2);
    if (def.pellets > 1 && !empty) {
      const spread = def.spread * this.perks.spreadMul;
      for (const side of [-1, 1]) dots(this.angle + spread * side, lineLength(this.angle + spread * side, false), AIM_DOT_SPACING, 0.6, 1);
    }
    // Mira al final de la línea (donde impactaría): esquinas de un cuadrado de 9×9 píxeles con
    // contorno oscuro para que se lea sobre cualquier suelo.
    if (!empty) {
      const ex = this.x + Math.cos(this.angle) * len, ey = this.y + Math.sin(this.angle) * len;
      const part = (dx, dy, w, h) => pixelRect(ctx, ex + dx * WORLD_PX, ey + dy * WORLD_PX, w, h);
      const shapes = [
        [-4, -4, 3, 1], [-4, -4, 1, 3], [2, -4, 3, 1], [4, -4, 1, 3],
        [-4, 4, 3, 1], [-4, 2, 1, 3], [2, 4, 3, 1], [4, 2, 1, 3], [0, 0, 1, 1],
      ];
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#140a24';
      for (const [dx, dy, w, h] of shapes) part(dx - 1, dy - 1, w + 2, h + 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.player;
      for (const [dx, dy, w, h] of shapes) part(dx, dy, w, h);
    }
    ctx.restore();
  }

  drawDebug(ctx) {
    const def = this.def;
    ctx.strokeStyle = COLORS.debug;
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x - this.r, this.y - this.r, this.r * 2, this.r * 2);
    if (def.melee) {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.arc(this.x, this.y, def.range, this.angle - def.arc / 2, this.angle + def.arc / 2);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(this.x, this.y, PICKUP_RADIUS, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = COLORS.blood;
    ctx.beginPath();
    ctx.arc(this.x, this.y, FINISH_RANGE + this.r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (this.exec) {
      drawText(ctx, `EJECUCION ${this.exec.style} ${this.exec.t.toFixed(2)}/${EXEC_TIME}${this.exec.hit ? ' GOLPE' : ''}`,
        this.x, this.y - this.r - 14, { color: COLORS.blood, scale: WORLD_PX, align: 'center' });
    }
  }
}
