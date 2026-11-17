import { moveAndSlide, lineOfSight, thickLineClear, castRay, findPath, tileKey, isSolidAt, isWallTile, TILE } from './map.js';
import { ENEMY_WEAPONS, ENEMY_MELEE, WEAPON_DEFS, drawWeaponShape, weaponCategory } from './weapons.js';
import { COLORS, TAU, angleDiff, clamp } from './utils.js';
import { drawSprite, pixelRect, pixelDisc, maskHead, WORLD_PX } from './sprites.js';
import { drawText } from './pixelfont.js';
import { spotLine, corpseLine } from './barks.js';

export const VIEW_DIST = 340;
export const FOV = Math.PI * 0.6;
// Ritmo de la IA (entre paréntesis, el valor anterior): más tensa al patrullar y mucho más
// rápida en cuanto te ve. El jugador sigue siendo más veloz que CHASE_SPEED, pero por poco.
const CLOSE_SENSE = 44;      // a esta distancia te detectan aunque estés a su espalda (36)
const PATROL_SPEED = 84;     // (70)
const PATROL_WAIT = 0.7;     // pausa mirando alrededor en cada punto de la ruta (1)
const INVESTIGATE_SPEED = 144; // (120)
const CHASE_SPEED = 192;     // (172)
const REACTION_TIME = 0.18;  // pausa entre verte y empezar a perseguir (0,3)
const ATTACK_REACH = 14;     // hueco entre cuerpos para poder golpear
const WINDUP = 0.17;         // preparación del puñetazo (ventana para esquivar) (0,22)
const ATTACK_COOLDOWN = 0.3; // (0,4)
const SEARCH_TIME = 3.2;     // cuánto te buscan tras perderte (2,5)
const DOWN_TIME = 3.2;       // segundos noqueado antes de levantarse
const KNOCKBACK = 14;
const ARRIVE_DIST = 6;
const REPATH_TIME = 0.4;
// Puertas: al toparse con una, el enemigo se para un instante antes de empujarla (despacio, ver
// ENEMY_PUSH_SPEED en doors.js) en vez de abrirla de golpe como si tuviera superfuerza.
const DOOR_PAUSE = 0.45;        // patrullando / investigando
const DOOR_PAUSE_CHASE = 0.25;  // persiguiendo
const DOOR_PUSH_WINDOW = 1.2;   // s durante los que puede empujar tras la pausa

// Presupuesto de IA por fotograma (lo repone Game.update): como mucho N búsquedas de ruta (BFS) y 1 búsqueda de cobertura entre TODOS los enemigos, así
// una alarma que despierta a varios a la vez reparte el coste en varios fotogramas en vez de gastarlo de golpe (importante en móvil). Lo que se queda sin
// presupuesto sigue por línea recta o con su ruta anterior y reintenta en el fotograma siguiente.
let pathBudget = 99, coverBudget = 99;
export function resetAiBudget(touch) { pathBudget = touch ? 2 : 4; coverBudget = 1; }
const takeCoverBudget = () => (coverBudget > 0 ? (coverBudget--, true) : false);
const COVER_RADIUS = 6;        // casillas a la redonda en las que busca cobertura
const COVER_MIN_PLAYER = 110;  // no se cubre pegado al jugador
const COVER_CYCLES = 3;        // veces que se oculta y asoma antes de lanzarse al ataque
const ALARM_REACH = 18;        // casillas de recorrido (a través de puertas) a las que llega un grito de alerta
const HEARD_MUFFLE = 0.6;      // un ruido tras una pared o puerta cerrada se oye con este radio relativo

// Portadores de máscara: color del aura neón de cada una.
const CARRIER_AURA = { guepardo: '#ff9d2e', tiburon: '#9fb0d6', buho: '#b36bff' };

export class Enemy {
  // weapon: null (cuerpo a cuerpo) o { type: 'gun', ammo } para el enemigo armado
  // kind: 'grunt' (el de siempre) | 'runner' (corredor ágil, cuerpo a cuerpo) | 'heavy' (guardia pesado con
  // escopeta) | el jefe es una subclase (boss.js).
  constructor(x, y, patrol, weapon = null, kind = 'grunt', meleeWeapon = null) {
    this.x = x;
    this.y = y;
    this.r = kind === 'heavy' ? 11 : 10;
    this.patrol = patrol;
    this.weapon = weapon;
    this.armed = !!weapon;  // el sprite con chaleco se mantiene aunque suelte el arma
    this.kind = kind;
    this.carrier = null;    // id de la máscara bloqueada que lleva (portador; ver setCarrier)
    this.aura = null;
    this.scuffleBonus = 1;  // multiplica su resistencia en los forcejeos (BLADE)
    // Corredor: patrulla y persigue más rápido (aún un poco por debajo del jugador) y golpea antes.
    // Pesado: más lento y robusto (hitbox mayor), dispara una escopeta con mucho aviso.
    this.speedMul = kind === 'runner' ? 1.16 : kind === 'heavy' ? 0.88 : 1;
    this.patrolMul = kind === 'runner' ? 1.5 : 1;
    this.meleeWeapon = meleeWeapon; // 'bat' | 'pipe' | 'knife' | null (ver ENEMY_MELEE)
    this.swingT = 0;        // s restantes del gesto del golpe (para dibujarlo)
    this.noPanic = 0;       // s sin poder entrar en pánico (tras acorralarlo)
    this.panicT = 0;
    this.cornered = 0;
    this.fleeTarget = null;
    this.fleeRepath = 0;
    this.refreshMelee();
    this.radioT = 0;        // (operador) s que le quedan de aviso por el walkie-talkie
    this.sprite = kind === 'operator' ? 'enemyOperator' : kind === 'runner' ? 'enemyRunner' : kind === 'heavy' ? 'enemyHeavy' : (weapon ? 'enemyArmed' : 'enemy');
    this.corpseSprite = kind === 'runner' ? 'runnerCorpse' : kind === 'heavy' ? 'heavyCorpse' : (weapon ? 'armedCorpse' : 'enemyCorpse');
    this.gunDef = weapon ? ENEMY_WEAPONS[weapon.type] : null;
    this.burstLeft = 0;     // balas que quedan de la ráfaga en curso
    this.burstTimer = 0;
    this.doorWait = 0;      // pausa ante una puerta (s)
    this.doorPushTime = 0;  // ventana en la que ya puede empujarla (s)
    this.wp = 0;
    this.wait = 0.5;
    this.state = 'patrol'; // patrol | alert | chase | investigate | search | down
    this.alive = true;
    this.executing = false; // el jugador lo está rematando: mientras tanto no se levanta
    this.target = null;    // última posición conocida del jugador / del ruido
    this.timer = 0;
    this.sees = false;
    this.windup = 0;       // preparación del golpe cuerpo a cuerpo
    this.aim = 0;          // preparación del disparo (enemigo armado)
    this.attackCd = 0;
    this.path = null;
    this.pathKey = -1;
    this.repath = Math.random() * REPATH_TIME; // desfasados: no repiten ruta todos en el mismo fotograma
    this.listenT = 0;       // pausa mirando hacia el ruido antes de ir a investigarlo
    this.hurry = false;     // alarma: va a la carrera (velocidad de persecución)
    this.alarmed = false;   // en estado de combate por un grito: reacciona antes si te ve
    this.shoutCd = 0;       // no grita dos veces seguidas
    this.corpseT = Math.random() * 0.4;
    this.found = false;     // (cadáver) otro enemigo ya lo ha descubierto: ¡CADÁVER! solo lo grita el primero
    this.seenCorpses = new Set(); // cadáveres ya vistos por este enemigo (no vuelve a reaccionar a ellos)
    this.spotted = false;   // ya ha gritado al avistar al jugador
    this.coverOk = kind !== 'boss' && !!weapon && Math.random() < 0.8; // los armados se cubren (el 80 %)
    this.cover = null; this.cmode = null; this.cT = 0; this.hideFor = 0; this.cycles = 0; this.fired = false; this.coverCool = 0; this.coverSearchCd = 0;
    const first = patrol[0];
    this.angle = Math.atan2(first.y - y, first.x - x) || 0;
    // Actividad mientras no sabe de ti (estado 'patrol'): patrullar la ruta, vigilar un punto girando la mirada, fumar o estar sentado a una mesa.
    this.activity = 'patrol';
    this.home = { x, y, angle: this.angle };
    this.seated = false;       // sentado (dibuja la silla y los brazos sobre la mesa)
    this.relaxDelay = 0;       // s extra que tarda en reaccionar al verte si lo pillas relajado
    this.scanT = 0; this.scanAngle = this.angle;
    this.smokeT = Math.random() * 4; this.smoking = false; this.puffed = false; this.tipT = 0;
  }

  // Asigna la actividad inicial (la elige loadLevel al azar por partida y piso). 'sit' lleva el rumbo hacia la mesa.
  setActivity(kind, angle = null) {
    this.activity = kind || 'patrol';
    if (angle !== null) { this.angle = angle; this.home.angle = angle; }
    else this.home.angle = this.angle;
    this.home.x = this.x; this.home.y = this.y;
    this.seated = kind === 'sit';
    this.relaxDelay = kind === 'smoke' ? 0.35 : kind === 'sit' ? 0.5 : 0; // fumando o sentado te ven más tarde
    this.scanAngle = this.home.angle;
  }

  // Alcance y preparación del golpe según lo que lleve (puños, bate, tubo o cuchillo); el corredor es más rápido.
  refreshMelee() {
    const m = ENEMY_MELEE[this.meleeWeapon];
    this.reach = m ? m.reach : ATTACK_REACH;
    this.windupTime = (m ? m.windup : WINDUP) * (this.kind === 'runner' ? 0.7 : 1) * (this.carrier === 'tiburon' ? 0.6 : 1);
  }

  get isUnarmed() {
    return !this.weapon && !this.meleeWeapon;
  }

  // Categoría de su armamento (matriz de combate): 'unarmed' | 'blunt' | 'blade' | 'gun'.
  get category() {
    return this.weapon ? 'gun' : this.meleeWeapon ? weaponCategory(this.meleeWeapon) : 'unarmed';
  }

  // Convierte al enemigo en PORTADOR de una máscara bloqueada: la lleva puesta (cabeza + aura neón) y tiene su ventaja, como élite:
  //   STRIKE (guepardo): +30 % de velocidad al patrullar, investigar y perseguir.
  //   BLADE (tiburón): golpes cuerpo a cuerpo un 40 % más rápidos de preparar y +30 % de fuerza en los forcejeos (scuffleBonus).
  //   GHOST (búho): sus balas van un 25 % más rápidas y con la mitad de dispersión.
  setCarrier(maskId) {
    this.carrier = maskId;
    this.aura = CARRIER_AURA[maskId] || '#ffffff';
    if (maskId === 'guepardo') { this.speedMul *= 1.3; this.patrolMul *= 1.3; }
    if (maskId === 'tiburon') { this.windupTime *= 0.6; this.scuffleBonus = 1.3; }
    if (maskId === 'buho' && this.gunDef) this.gunDef = { ...this.gunDef, bulletSpeed: this.gunDef.bulletSpeed * 1.25, spread: this.gunDef.spread * 0.5 };
  }

  get standing() {
    return this.alive && this.state !== 'down';
  }

  canSee(p, map) {
    const dx = p.x - this.x, dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    // Penumbra (pisos oscuros): a oscuras te ven a la mitad de distancia, salvo que acabes de hacer ruido (disparo, golpe) y delates tu posición.
    const dk = map.dark;
    const lim = dk && !(map.reveal > 0) && dk[tileKey(map, p.x, p.y)] ? VIEW_DIST * 0.5 : VIEW_DIST;
    if (d > lim) return false;
    if (d > CLOSE_SENSE && Math.abs(angleDiff(Math.atan2(dy, dx), this.angle)) > FOV / 2) return false;
    return lineOfSight(map, this.x, this.y, p.x, p.y);
  }

  // Un ruido (disparo, golpe, patada): se detiene, mira hacia allí (0,35 s) y va a investigarlo. Con un ruido nuevo durante la investigación se queda
  // con el más cercano a él. Los que ya te persiguen o están derribados lo ignoran.
  hear(x, y) {
    if (this.state === 'chase' || this.state === 'alert' || this.state === 'down' || this.state === 'panic') return;
    if (this.state === 'investigate' && this.target && Math.hypot(this.target.x - this.x, this.target.y - this.y) < Math.hypot(x - this.x, y - this.y)) return;
    this.target = { x, y };
    this.state = 'investigate';
    this.listenT = 0.35;
    this.path = null;
  }

  // Grito de un compañero (te ha visto o ha encontrado un cadáver): se pone en estado de combate y corre hacia la zona.
  answerAlarm(x, y, delay) {
    if (this.state === 'chase' || this.state === 'alert' || this.state === 'down' || this.state === 'panic') return;
    this.target = { x, y };
    this.state = 'investigate';
    this.listenT = 0.25 + delay;
    this.hurry = true;
    this.alarmed = true;
    this.path = null;
  }

  // Busca cadáveres a la vista (cada ~0,35 s): descubrir uno da la alarma.
  scanCorpses(game) {
    for (const o of game.enemies) {
      if (o === this || o.alive || this.seenCorpses.has(o)) continue;
      const dx = o.x - this.x, dy = o.y - this.y, d = Math.hypot(dx, dy);
      if (d > VIEW_DIST * 0.8) continue;
      if (d > CLOSE_SENSE && Math.abs(angleDiff(Math.atan2(dy, dx), this.angle)) > FOV / 2) continue;
      if (!lineOfSight(game.map, this.x, this.y, o.x, o.y)) continue;
      this.seenCorpses.add(o); // cada enemigo reacciona a cada cadáver una sola vez
      if (!o.found) {
        // El primero que lo encuentra: ¡CADÁVER! (una sola vez por cadáver) y da la alarma.
        o.found = true;
        game.bark(this, '¡CADÁVER!', true);
        this.answerAlarm(o.x, o.y, 0.3);
        game.raiseAlarm(this, o.x, o.y);
        return;
      }
      // Los siguientes: frases de tensión (a veces) o silencio en guardia; nunca repiten el grito ni la alarma.
      const line = corpseLine(game.lastBark);
      if (line) game.bark(this, line);
    }
  }

  // Derribado: suelta el arma (lo gestiona Game) y queda en el suelo un rato.
  knockDown(angle, map) {
    this.state = 'down';
    this.timer = DOWN_TIME;
    this.windup = this.aim = this.burstLeft = 0;
    this.doorWait = this.doorPushTime = 0;
    this.path = null;
    this.angle = angle;
    moveAndSlide(map, this, Math.cos(angle) * KNOCKBACK, Math.sin(angle) * KNOCKBACK);
  }

  update(dt, game) {
    // Veneno del tubo oxidado: el enemigo está NOQUEADO (ver Game.poisonEnemy) y muere solo cuando se acaba el veneno.
    if (this.poison > 0) {
      this.poison -= dt;
      this.poisonTick = (this.poisonTick || 0) - dt;
      if (this.poisonTick <= 0) { this.poisonTick = 0.4; game.particles.blood(this.x, this.y, Math.random() * 6.28, 2, 3, true); } // gotitas verdes
      if (this.poison <= 0) { game.killEnemy(this, this.poisonAngle || 0, 'poison'); return; }
    }
    if (this.state === 'down') {
      if (this.executing) return; // el temblor del golpe que viene: el aturdimiento se congela
      if (this.poison > 0) return; // intoxicado: no se levanta (agoniza hasta morir o hasta que lo remates)
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'alert';
        this.timer = REACTION_TIME;
        this.target = { x: game.player.x, y: game.player.y };
      }
      return;
    }

    const p = game.player;
    this.sees = p.alive && this.canSee(p, game.map);
    if (this.state !== 'patrol') { this.seated = false; this.smoking = false; } // se levanta / tira el cigarrillo en cuanto pasa algo
    if (this.sees) {
      this.target = { x: p.x, y: p.y };
      if (this.state !== 'alert' && this.state !== 'chase' && this.state !== 'panic') {
        const relaxed = this.state === 'patrol' ? this.relaxDelay : 0; // pillado fumando o sentado: tarda más en reaccionar
        this.state = 'alert';
        this.timer = this.alarmed ? REACTION_TIME * 0.4 : REACTION_TIME + relaxed; // en estado de combate (alarma) reacciona al instante
        game.playAt('alert', this.x, this.y);
        game.raiseAlarm(this, p.x, p.y); // da la voz a las salas contiguas
        if (!this.spotted) { this.spotted = true; game.bark(this, spotLine(game.gender, game.mask && game.mask.id, game.lastBark)); }
      }
    }
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.shoutCd = Math.max(0, this.shoutCd - dt);
    if (this.state === 'patrol' || this.state === 'search' || this.state === 'investigate') {
      this.corpseT -= dt;
      if (this.corpseT <= 0) { this.corpseT = 0.3 + Math.random() * 0.2; this.scanCorpses(game); }
    }
    if (this.carrier && Math.random() < 0.07) game.particles.neon(this.x, this.y, Math.random() * TAU, 1, 3.14);
    // PÁNICO: un enemigo desarmado (nunca tuvo arma o la perdió) que te ve con CUALQUIER arma en la mano no se lanza
    // a puñetazos: retrocede, busca un arma del suelo o se cubre. Vuelve a atacar al recoger una o si te quedas sin arma.
    this.noPanic = Math.max(0, this.noPanic - dt);
    if (this.isUnarmed && p.alive && p.weapon && this.noPanic <= 0 && this.state !== 'panic' && (this.sees || this.state === 'chase')) {
      this.state = 'panic';
      this.panicT = 0;
      this.cornered = 0;
      this.fleeTarget = null;
      this.fleeRepath = 0;
      this.windup = 0;
      game.playAt('alert', this.x, this.y);
    }
    if (this.doorWait > 0) {
      this.doorWait -= dt;
      if (this.doorWait <= 0) this.doorPushTime = DOOR_PUSH_WINDOW;
    } else {
      this.doorPushTime = Math.max(0, this.doorPushTime - dt);
    }

    switch (this.state) {
      case 'patrol': this.updatePatrol(dt, game.map, game); break;
      case 'alert':
        this.turnTowards(Math.atan2(this.target.y - this.y, this.target.x - this.x), 14, dt);
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'chase';
        break;
      case 'chase': this.updateChase(dt, game); break;
      case 'panic': this.updatePanic(dt, game); break;
      case 'investigate':
        if (this.listenT > 0) { // se para a escuchar y mira hacia el ruido
          this.listenT -= dt;
          this.turnTowards(Math.atan2(this.target.y - this.y, this.target.x - this.x), 9, dt);
          break;
        }
        if (this.goTo(this.target.x, this.target.y, (this.hurry ? CHASE_SPEED * 0.92 : INVESTIGATE_SPEED) * this.speedMul, dt, game.map)) this.startSearch();
        break;
      case 'search':
        this.angle += 2.2 * dt;
        this.timer -= dt;
        if (this.timer <= 0) { this.state = 'patrol'; this.path = null; this.hurry = false; this.alarmed = false; }
        break;
    }
  }

  startSearch() {
    this.state = 'search';
    this.timer = SEARCH_TIME;
    this.windup = this.aim = this.burstLeft = 0;
  }

  // Actividad en reposo (vigilar, fumar, sentado): se queda en su sitio (vuelve a él si lo ha dejado tras investigar o perseguir) y hace lo suyo.
  updateActivity(dt, map, game) {
    const h = this.home;
    if (Math.hypot(h.x - this.x, h.y - this.y) > ARRIVE_DIST + 2) {
      this.seated = false; this.smoking = false;
      this.goTo(h.x, h.y, PATROL_SPEED, dt, map);
      return;
    }
    if (this.activity === 'sit') {
      this.seated = true;
      this.turnTowards(h.angle + Math.sin(game.time * 0.6 + h.x) * 0.12, 3, dt); // mira la mesa, con pequeños movimientos de cabeza
    } else if (this.activity === 'watch') {
      // Vigilancia orgánica: cada pocos segundos fija la mirada en otro punto de su sector (±80°) y gira despacio hacia él.
      this.scanT -= dt;
      if (this.scanT <= 0) { this.scanT = 1.1 + Math.random() * 1.9; this.scanAngle = h.angle + (Math.random() - 0.5) * 2.8; }
      this.turnTowards(this.scanAngle, 2.4, dt);
    } else if (this.activity === 'smoke') {
      // Ciclo de 4,2 s: quieto · sube el cigarrillo · calada (humo) · lo baja · pausa. Mira distraído hacia un lado.
      this.smokeT = (this.smokeT + dt) % 4.2;
      this.smoking = this.smokeT > 1.9 && this.smokeT < 3.9;
      this.turnTowards(h.angle + Math.sin(this.smokeT * 0.7) * 0.5, 1.2, dt);
      const mx = this.x + Math.cos(this.angle) * 12, my = this.y + Math.sin(this.angle) * 12;
      if (this.smokeT > 2.9 && !this.puffed) { this.puffed = true; for (let i = 0; i < 3; i++) game.particles.smoke(mx, my); }
      if (this.smokeT < 0.2) this.puffed = false;
      this.tipT -= dt;
      if (this.tipT <= 0) { this.tipT = 0.5; game.particles.smoke(this.x + Math.cos(this.angle) * 14 - Math.sin(this.angle) * 8, this.y + Math.sin(this.angle) * 14 + Math.cos(this.angle) * 8); }
    }
  }

  updatePatrol(dt, map, game) {
    if (this.activity !== 'patrol') { this.updateActivity(dt, map, game); return; }
    if (this.wait > 0) {
      this.wait -= dt;
      // Barrido de la mirada más amplio (±26°): vigilan en vez de quedarse mirando al frente.
      this.angle += Math.sin(this.wait * 7) * dt * 3.2;
      return;
    }
    const wp = this.patrol[this.wp];
    if (this.goTo(wp.x, wp.y, PATROL_SPEED * this.patrolMul, dt, map)) {
      this.wp = (this.wp + 1) % this.patrol.length;
      this.wait = PATROL_WAIT;
    }
  }

  updateChase(dt, game) {
    const p = game.player;
    // Sin jugador vivo o sin última posición conocida (no debería ocurrir): a buscar.
    if (!p.alive || !this.target) { this.startSearch(); return; }
    this.hurry = false;
    if (this.coverOk && this.updateCover(dt, game)) return; // táctica: cubrirse, asomar, disparar y volver a cubrirse

    // Si te pierde de vista, el wind-up se cancela: por eso cubrirse tras una esquina funciona.
    if (!this.sees) {
      // Una ráfaga cortada a medias deja un pequeño respiro antes de volver a apuntar.
      if (this.burstLeft > 0) this.attackCd = this.gunDef.cooldown * 0.5;
      this.windup = this.aim = this.burstLeft = 0;
      if (this.goTo(this.target.x, this.target.y, CHASE_SPEED * this.speedMul, dt, game.map)) this.startSearch();
      return;
    }

    const angleToPlayer = Math.atan2(p.y - this.y, p.x - this.x);
    const d = Math.hypot(p.x - this.x, p.y - this.y);

    if (this.weapon) {
      const def = this.gunDef;
      // Ráfaga en curso (subfusil): sigue disparando mientras te vea, girando despacio.
      if (this.burstLeft > 0) {
        this.turnTowards(angleToPlayer, 5, dt);
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
          game.enemyShoot(this);
          this.burstLeft--;
          this.burstTimer = def.burstInterval;
          if (this.burstLeft === 0) this.attackCd = def.cooldown;
        }
        return;
      }
      if (d < def.range) {
        this.turnTowards(angleToPlayer, 9, dt);
        if (this.attackCd <= 0) {
          if (this.aim === 0) game.playAt('aim', this.x, this.y);
          this.aim += dt;
          if (this.aim >= def.windup) {
            this.aim = 0;
            this.burstLeft = def.burst;
            this.burstTimer = 0;
          }
        }
        return;
      }
      this.aim = 0;
      this.goTo(p.x, p.y, CHASE_SPEED * this.speedMul, dt, game.map);
      return;
    }

    if (d < this.r + p.r + this.reach) {
      this.turnTowards(angleToPlayer, 16, dt);
      if (this.attackCd <= 0) {
        this.windup += dt;
        if (this.windup >= this.windupTime) {
          this.windup = 0;
          this.attackCd = ATTACK_COOLDOWN;
          this.swingT = 0.15;
          game.enemyStrike(this, angleToPlayer); // frontal = forcejeo; por la espalda mata
        }
      }
      return;
    }
    this.windup = 0;
    this.goTo(p.x, p.y, CHASE_SPEED * this.speedMul, dt, game.map);
  }

  // --- Cobertura ------------------------------------------------------------------------------------
  // Un enemigo armado que te ve a distancia no corre en línea recta hacia ti: busca una casilla cercana pegada a un mueble o una esquina que lo oculte
  // de ti (`findCover`, una vez por entrada en combate y con presupuesto) y juega al «asomar»: se oculta 0,5-1,4 s, sale a una casilla contigua con
  // visión, dispara su arma y vuelve a cubrirse. Tras COVER_CYCLES ciclos, o si te pegas a él (< 80 u), deja la cobertura y se lanza al ataque.
  // Devuelve true si ha gestionado el fotograma (y el resto de la persecución no debe correr).
  updateCover(dt, game) {
    const p = game.player, def = this.gunDef, map = game.map;
    this.coverCool = Math.max(0, this.coverCool - dt);
    if (this.cmode === 'peek' && this.burstLeft > 0) this.fired = true;
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (this.coverCool > 0 || d < 80) { this.cover = null; return false; }
    if (this.burstLeft > 0) return false; // una ráfaga en curso no se interrumpe
    if (!this.cover) {
      if (!this.sees || d > def.range * 1.4) return false;
      this.coverSearchCd -= dt;
      if (this.coverSearchCd > 0 || !takeCoverBudget()) return false;
      this.coverSearchCd = 1;
      const c = this.findCover(game);
      if (!c) { this.coverCool = 3; return false; }
      this.cover = c; this.cmode = 'seek'; this.cT = 0; this.cycles = 0;
    }
    const c = this.cover;
    this.cT += dt;
    if (this.cmode === 'seek') {
      if (this.cT > 3.5) { this.cover = null; this.coverCool = 5; return false; }
      if (this.goTo(c.sx, c.sy, CHASE_SPEED * this.speedMul, dt, map)) { this.cmode = 'hide'; this.cT = 0; this.hideFor = 0.5 + Math.random() * 0.9; this.aim = 0; }
      return true;
    }
    if (this.cmode === 'hide') {
      this.aim = 0; this.windup = 0;
      this.turnTowards(Math.atan2(p.y - this.y, p.x - this.x), 6, dt);
      if (this.cT >= this.hideFor) {
        if (++this.cycles > COVER_CYCLES) { this.cover = null; this.coverCool = 6; return false; }
        this.cmode = 'peek'; this.cT = 0; this.fired = false;
      }
      return true;
    }
    // peek: sale a la casilla contigua con visión y dispara; tras la ráfaga (o si tarda demasiado) vuelve a ocultarse
    if ((this.fired && this.attackCd > 0) || this.cT > 2.4) {
      this.cmode = 'hide'; this.cT = 0; this.hideFor = 0.7 + Math.random() * 0.9; this.fired = false; this.aim = 0;
      if (lineOfSight(map, c.sx, c.sy, p.x, p.y)) this.cover = null; // el jugador ha rodeado la cobertura: elige otra
      return true;
    }
    if (this.sees && d < def.range * 0.95) return false; // ve al jugador: dispara desde donde está
    this.goTo(c.px, c.py, CHASE_SPEED * this.speedMul, dt, map);
    return true;
  }

  // La mejor cobertura cercana: casilla libre pegada a una pared o mueble (≤ COVER_RADIUS casillas), oculta del jugador, con una casilla contigua desde la
  // que se le ve a tiro, alcanzable en línea recta y no ocupada por otro enemigo. Gana la más cercana al enemigo.
  findCover(game) {
    const map = game.map, p = game.player, def = this.gunDef;
    const ex = Math.floor(this.x / TILE), ey = Math.floor(this.y / TILE);
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = null, bestD = Infinity;
    for (let ty = ey - COVER_RADIUS; ty <= ey + COVER_RADIUS; ty++) {
      for (let tx = ex - COVER_RADIUS; tx <= ex + COVER_RADIUS; tx++) {
        if (isWallTile(map, tx, ty)) continue;
        const sx = tx * TILE + TILE / 2, sy = ty * TILE + TILE / 2;
        const de = Math.hypot(sx - this.x, sy - this.y);
        if (de >= bestD || de > COVER_RADIUS * TILE) continue;
        let walled = false;
        for (const [dx, dy] of N4) if (isWallTile(map, tx + dx, ty + dy)) { walled = true; break; }
        if (!walled) continue;
        const dp = Math.hypot(sx - p.x, sy - p.y);
        if (dp < COVER_MIN_PLAYER || dp > def.range * 1.1) continue;
        if (lineOfSight(map, sx, sy, p.x, p.y)) continue; // debe quedar oculto
        let peek = null;
        for (const [dx, dy] of N4) {
          if (isWallTile(map, tx + dx, ty + dy)) continue;
          const qx = sx + dx * TILE, qy = sy + dy * TILE;
          if (Math.hypot(qx - p.x, qy - p.y) < def.range * 0.95 && lineOfSight(map, qx, qy, p.x, p.y)) { peek = { px: qx, py: qy }; break; }
        }
        if (!peek) continue;
        if (game.enemies.some((o) => o !== this && o.alive && o.cover && Math.hypot(o.cover.sx - sx, o.cover.sy - sy) < 40)) continue;
        if (!thickLineClear(map, this.x, this.y, sx, sy, this.r)) continue;
        best = { sx, sy, px: peek.px, py: peek.py }; bestD = de;
      }
    }
    return best;
  }

  // --- Pánico ---------------------------------------------------------------------------------------
  // 1) Si hay un arma usable en el suelo cerca (y no pegada a ti), corre a por ella y se arma. 2) Si no, huye: de
  // 16 rumbos elige el punto que más lo aleja de ti, mejor si queda fuera de tu línea de visión. 3) Si lo
  // acorralas (< 42 u durante 1 s) se rinde a pelear con los puños (`noPanic` 4 s). Si te quedas sin arma, vuelve a atacar.
  updatePanic(dt, game) {
    const p = game.player;
    if (!p.alive || !p.weapon || !this.isUnarmed) { this.state = 'chase'; this.target = { x: p.x, y: p.y }; this.attackCd = 0.3; return; }
    this.panicT += dt;
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    const pk = this.nearestWeapon(game);
    if (pk) {
      if (Math.hypot(pk.x - this.x, pk.y - this.y) < 14) { this.takeWeapon(pk, game); return; }
      this.goTo(pk.x, pk.y, CHASE_SPEED * 1.05, dt, game.map);
      return;
    }
    this.cornered = d < 42 ? this.cornered + dt : Math.max(0, this.cornered - dt);
    if (this.cornered > 1) { this.noPanic = 4; this.state = 'chase'; this.target = { x: p.x, y: p.y }; this.attackCd = 0.2; return; }
    this.fleeRepath -= dt;
    if (!this.fleeTarget || this.fleeRepath <= 0 || Math.hypot(this.fleeTarget.x - this.x, this.fleeTarget.y - this.y) < 10) {
      this.fleeTarget = this.pickFlee(game);
      this.fleeRepath = 0.5;
    }
    if (this.fleeTarget) this.goTo(this.fleeTarget.x, this.fleeTarget.y, CHASE_SPEED, dt, game.map);
  }

  // El arma suelta más cercana que merece la pena: cuerpo a cuerpo o de fuego con balas, a ≤ 360 u, alcanzable
  // en línea recta o por ruta, y no pegada al jugador.
  nearestWeapon(game) {
    const p = game.player;
    let best = null, bestD = 360;
    for (const k of game.pickups) {
      if (!k.alive || k.flying) continue;
      const def = WEAPON_DEFS[k.type];
      if (!def || (!def.melee && !(k.ammo > 0)) || (def.melee && !ENEMY_MELEE[k.type])) continue;
      if (Math.hypot(k.x - p.x, k.y - p.y) < 40) continue;
      const d = Math.hypot(k.x - this.x, k.y - this.y);
      if (d >= bestD) continue;
      if (!thickLineClear(game.map, this.x, this.y, k.x, k.y, this.r) && !findPath(game.map, this.x, this.y, k.x, k.y)) continue;
      best = k; bestD = d;
    }
    return best;
  }

  takeWeapon(k, game) {
    k.alive = false;
    const def = WEAPON_DEFS[k.type];
    if (def.melee) { this.meleeWeapon = k.type; this.refreshMelee(); }
    else { this.weapon = { type: k.type, ammo: k.ammo }; this.gunDef = ENEMY_WEAPONS[k.type]; this.armed = true; }
    this.state = 'chase';
    this.attackCd = 0.5; // un respiro antes de usarla
    this.windup = this.aim = 0;
    game.playAt('pickup', this.x, this.y);
  }

  pickFlee(game) {
    const p = game.player, map = game.map;
    const away = Math.atan2(this.y - p.y, this.x - p.x);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      for (const len of [90, 150, 220]) {
        const tx = this.x + Math.cos(a) * len, ty = this.y + Math.sin(a) * len;
        if (isSolidAt(map, tx, ty) || !thickLineClear(map, this.x, this.y, tx, ty, this.r)) continue;
        const score = Math.hypot(tx - p.x, ty - p.y) + (lineOfSight(map, tx, ty, p.x, p.y) ? 0 : 140) - Math.abs(angleDiff(a, away)) * 20;
        if (score > bestScore) { bestScore = score; best = { x: tx, y: ty }; }
      }
    }
    return best;
  }

  // Va hacia (tx, ty): en línea recta si el cuerpo cabe, si no siguiendo una ruta BFS.
  // Devuelve true al llegar.
  goTo(tx, ty, speed, dt, map) {
    if (Math.hypot(tx - this.x, ty - this.y) < ARRIVE_DIST) return true;
    let nx = tx, ny = ty;
    if (thickLineClear(map, this.x, this.y, tx, ty, this.r)) {
      this.path = null;
    } else {
      const key = tileKey(map, tx, ty);
      this.repath -= dt;
      if (!this.path || key !== this.pathKey || this.repath <= 0) {
        if (pathBudget > 0) { // sin presupuesto este fotograma: sigue con la ruta anterior (o recto) y reintenta en el siguiente
          pathBudget--;
          this.path = findPath(map, this.x, this.y, tx, ty);
          this.pathKey = key;
          this.repath = REPATH_TIME;
        }
      }
      const path = this.path;
      if (path) {
        while (path.length && Math.hypot(path[0].x - this.x, path[0].y - this.y) < ARRIVE_DIST) path.shift();
        while (path.length > 1 && thickLineClear(map, this.x, this.y, path[1].x, path[1].y, this.r)) path.shift();
        if (path.length) { nx = path[0].x; ny = path[0].y; }
      }
    }
    this.moveToward(nx, ny, speed, dt, map);
    return false;
  }

  // Llamado por la puerta al tocarla: ¿puede empujarla ya? Si no, empieza la pausa.
  doorContact() {
    if (this.doorPushTime > 0) return true;
    if (this.doorWait <= 0) this.doorWait = this.state === 'chase' ? DOOR_PAUSE_CHASE : DOOR_PAUSE;
    return false;
  }

  moveToward(tx, ty, speed, dt, map) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    // Parado ante una puerta: solo se gira hacia donde va.
    if (this.doorWait > 0) {
      if (d > 0.001) this.turnTowards(Math.atan2(dy, dx), 7, dt);
      return;
    }
    if (d < 0.001) return;
    const step = Math.min(speed * dt, d);
    this.turnTowards(Math.atan2(dy, dx), this.state === 'chase' ? 12 : 7, dt);
    moveAndSlide(map, this, (dx / d) * step, (dy / d) * step);
  }

  turnTowards(target, rate, dt) {
    this.angle += clamp(angleDiff(target, this.angle), -rate * dt, rate * dt);
  }

  draw(ctx, time, game) {
    if (this.state === 'down') { this.drawDown(ctx, time); return; }

    // Mira láser durante el wind-up del disparo: avisa de que va a disparar.
    if (this.aim > 0) {
      // Línea de puntos pixelada que se va llenando: avisa de que va a disparar.
      const t = this.aim / this.gunDef.windup;
      const len = castRay(game.map, this.x, this.y, this.angle, this.gunDef.range + 80);
      const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
      ctx.save();
      ctx.fillStyle = COLORS.laser;
      ctx.globalAlpha = 0.35 + t * 0.65;
      const gap = t > 0.7 ? 4 : 8;
      for (let d = 16; d < len; d += gap) pixelRect(ctx, this.x + cos * d, this.y + sin * d);
      ctx.restore();
    }

    // Aura neón del portador: halo aditivo que late, bajo el enemigo.
    if (this.carrier) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const k = 0.5 + 0.5 * Math.sin(time * 6);
      ctx.fillStyle = this.aura;
      ctx.globalAlpha = 0.12 + 0.1 * k;
      pixelDisc(ctx, this.x, this.y, 12 + Math.round(k * 2), WORLD_PX);
      ctx.globalAlpha = 0.22 + 0.12 * k;
      pixelDisc(ctx, this.x, this.y, 8, WORLD_PX);
      ctx.restore();
    }
    // Pánico: tiembla (1 px) y suda.
    const trem = this.state === 'panic' ? (Math.floor(time * 30) % 2 ? WORLD_PX : -WORLD_PX) : 0;
    ctx.save();
    ctx.translate(this.x + trem, this.y);
    ctx.save();
    ctx.rotate(this.angle);
    // Sentado: silla detrás y los dos puños sobre la mesa; fumando: cigarrillo con brasa (se lleva a la boca durante la calada).
    const resting = this.state === 'patrol';
    if (resting && this.seated) {
      ctx.fillStyle = '#14100a'; pixelRect(ctx, -15, -9, 5, 19);
      ctx.fillStyle = '#5b4a2a'; pixelRect(ctx, -14, -8, 3, 17);
      ctx.fillStyle = '#3a2f1a'; pixelRect(ctx, -10, -7, 4, 15);
    }
    // Puños; durante la preparación del golpe el brazo se echa hacia atrás.
    const wind = this.windup / this.windupTime;
    if (resting && this.seated) {
      drawSprite(ctx, 'fist', 11, 6);
      drawSprite(ctx, 'fist', 11, -6);
      if (this.kind === 'operator') { // auricular y, al dar el aviso, el walkie-talkie junto a la cara (con la antena roja parpadeando)
        ctx.fillStyle = '#05d9e8'; pixelRect(ctx, -1, -7, 1, 3);
        if (this.radioT > 0) { ctx.fillStyle = '#14141e'; pixelRect(ctx, 6, -10, 4, 6); ctx.fillStyle = Math.floor(time * 8) % 2 ? '#ff2a4a' : '#9d8fb8'; pixelRect(ctx, 8, -12, 1, 2); }
      }
    } else if (resting && this.activity === 'smoke') {
      const up = this.smoking ? Math.min(1, Math.min(this.smokeT - 1.9, 3.9 - this.smokeT) / 0.4) : 0; // 0 abajo · 1 en la boca
      drawSprite(ctx, 'fist', 10 - 3 * up, 8 - 5 * up);
      drawSprite(ctx, 'fist', 10, -8);
      ctx.fillStyle = '#eeeeee'; pixelRect(ctx, 11 - 3 * up, 7 - 5 * up, 3, 1);
      ctx.fillStyle = Math.floor(time * 6) % 3 ? '#ff7a1a' : '#ffd166'; pixelRect(ctx, 17 - 3 * up, 7 - 5 * up, 1, 1);
    } else if (this.weapon) {
      drawSprite(ctx, 'fist', 10, 6);
      drawWeaponShape(ctx, this.weapon.type, 10, 6, 0);
    } else if (this.meleeWeapon) {
      // Arma en la mano: se levanta al prepararse y barre hacia delante al golpear.
      const ang = this.swingT > 0 ? 0.9 * (this.swingT / 0.15) : -1.1 * wind;
      drawSprite(ctx, 'fist', 10 - wind * 6, 8);
      drawWeaponShape(ctx, this.meleeWeapon, 10 - wind * 6, 8, ang);
      drawSprite(ctx, 'fist', 10, -8);
    } else {
      drawSprite(ctx, 'fist', 10 - wind * 8, 8);
      drawSprite(ctx, 'fist', 10, -8);
    }
    drawSprite(ctx, this.sprite, 0, 0);
    // Portador: lleva puesta la máscara bloqueada sobre la cabeza.
    if (this.carrier) drawSprite(ctx, maskHead(this.carrier), 2, 0, 0, { ox: 3, oy: 3 });
    ctx.restore();

    if (this.state === 'panic') {
      ctx.fillStyle = '#9ff6ff';
      for (let i = 0; i < 2; i++) {
        const f = (time * 3 + i * 0.5) % 1;
        pixelRect(ctx, (i ? 7 : -9) , -this.r - 4 - f * 8, 1, 2);
      }
    }
    const icon = this.state === 'panic' ? '!' : this.state === 'alert' || this.state === 'chase' ? '!'
      : this.state === 'investigate' || this.state === 'search' ? '?' : '';
    if (icon) {
      const bob = Math.round(Math.sin(time * 10)) * WORLD_PX;
      drawText(ctx, icon, 0, -this.r - 22 + bob, { color: this.state === 'panic' ? '#9ff6ff' : icon === '!' ? COLORS.blood : COLORS.enemy, scale: WORLD_PX, align: 'center' });
    }
    ctx.restore();
  }

  // Tumbado boca arriba con "estrellitas" pixeladas girando: se puede rematar.
  drawDown(ctx, time) {
    // Mientras lo rematan tiembla (1 píxel a cada lado).
    const shake = this.executing ? (Math.floor(time * 40) % 2 ? WORLD_PX : -WORLD_PX) : 0;
    drawSprite(ctx, 'enemyDown', this.x + shake, this.y, this.angle);
    ctx.save();
    ctx.fillStyle = COLORS.spark;
    for (let i = 0; i < 3; i++) {
      const a = time * 6 + (i * TAU) / 3;
      pixelRect(ctx, this.x + Math.cos(a) * 9, this.y - 16 + Math.sin(a) * 3);
    }
    ctx.restore();
  }

  drawDebug(ctx, game) {
    ctx.lineWidth = 2;
    if (this.state === 'down') {
      ctx.strokeStyle = COLORS.debug;
      ctx.strokeRect(this.x - this.r, this.y - this.r, this.r * 2, this.r * 2);
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (this.timer / DOWN_TIME));
      ctx.stroke();
      drawText(ctx, `${this.executing ? 'EJECUTANDO' : 'DOWN'} ${this.timer.toFixed(1)}`, this.x, this.y + this.r + 4, { color: COLORS.debug, scale: WORLD_PX, align: 'center' });
      return;
    }

    const map = game.map;
    // Cono de visión recortado por paredes y puertas.
    const rays = 28;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    for (let i = 0; i <= rays; i++) {
      const a = this.angle - FOV / 2 + (FOV * i) / rays;
      const d = castRay(map, this.x, this.y, a, VIEW_DIST);
      ctx.lineTo(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d);
    }
    ctx.closePath();
    ctx.fillStyle = this.sees ? 'rgba(217, 4, 41, 0.18)' : 'rgba(255, 190, 11, 0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 190, 11, 0.5)';
    ctx.stroke();

    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(this.x, this.y, CLOSE_SENSE, 0, TAU);
    ctx.stroke();
    if (this.weapon) {
      ctx.strokeStyle = 'rgba(217, 4, 41, 0.35)';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.gunDef.range, 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Línea de visión hacia el jugador.
    const p = game.player;
    if (p.alive && Math.hypot(p.x - this.x, p.y - this.y) < VIEW_DIST) {
      ctx.strokeStyle = this.sees ? COLORS.debug : 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    if (this.path && this.path.length) {
      ctx.strokeStyle = COLORS.weapon;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      for (const n of this.path) ctx.lineTo(n.x, n.y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 190, 11, 0.6)';
    for (const w of this.patrol) {
      ctx.beginPath();
      ctx.moveTo(w.x - 3, w.y - 3); ctx.lineTo(w.x + 3, w.y + 3);
      ctx.moveTo(w.x + 3, w.y - 3); ctx.lineTo(w.x - 3, w.y + 3);
      ctx.stroke();
    }

    ctx.strokeStyle = COLORS.debug;
    ctx.strokeRect(this.x - this.r, this.y - this.r, this.r * 2, this.r * 2);
    const extra = this.aim > 0 ? ` AIM ${this.aim.toFixed(2)}` : this.windup > 0 ? ` WINDUP ${this.windup.toFixed(2)}` : '';
    drawText(ctx, this.state + (this.activity !== 'patrol' ? ` [${this.activity.toUpperCase()}]` : '') + (this.weapon ? ' [GUN]' : '') + extra, this.x, this.y + this.r + 4, { color: COLORS.debug, scale: WORLD_PX, align: 'center' });
  }
}
