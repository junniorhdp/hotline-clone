import { findPath, moveAndSlide } from './map.js';
import { segmentPointDistance, inMeleeArc } from './weapons.js';
import { ExtractionCar } from './extraction.js';
import { pixelRect, WORLD_PX, drawSprite, drawMaskHead, playerBody } from './sprites.js';
import { AGENTS } from './portraits.js';
import { drawText, measureText } from './pixelfont.js';
import { COLORS } from './utils.js';

// Rehenes atados a sillas en algunas salas del edificio (los coloca loadLevel: ver placeHostages en map.js).
//   · Se LIBERAN con PATEAR/INTERACTUAR (Espacio / F; en táctil el botón de la bota) estando cerca: +1500 puntos y corren a la entrada del edificio.
//   · GOLPES cuerpo a cuerpo (clic / ATACAR; no la patada, que es la acción de liberar): el PRIMERO no lo mata: lo tumba en su silla con una sacudida de
//     cámara y una burbuja de dolor (aviso); un segundo golpe (pasada 0,8 s de gracia) lo MATA. Un DISPARO lo mata siempre. Matar a un rehén = −2000
//     al final del piso y la culpa del protagonista (se quita la máscara y vomita, ver Game.guilt). Las balas enemigas y las armas lanzadas los atraviesan.
//   · EXTRACCIÓN: al despejar el piso y salir el jugador a la calle, los rehenes liberados salen del edificio: UNO espera junto a la moto y se sube detrás
//     del protagonista en la fuga; DOS O MÁS esperan a un AUTO de extracción (extraction.js) que llega junto a la acera, los recoge y se va mientras el
//     jugador se marcha en su moto. La fuga no arranca hasta que están a bordo (extractionBusy).
// Estados: tied → freed (corre a la entrada) → waiting (espera en la entrada) → exiting (sale a la calle) → ready (esperando moto/auto) →
//          boarding → boarded (en el auto) | riding (en la moto) · dead.
const RESCUE_POINTS = 1500, KILL_PENALTY = 2000;
const INTERACT_GAP = 22;        // distancia al borde del rehén para liberarlo
const RUN_SPEED = 120, WALK_SPEED = 95;
const GRACE = 0.8;              // s tras un golpe en los que otro golpe no cuenta (el aviso se nota)
const BOARD_TIME = 0.5;
const DOOR_STOP = 22;           // distancia (hacia dentro) a la que se detienen ante la puerta principal si está cerrada
const STUCK_TIME = 14;          // si tras salir a la calle un rehén no llega en este tiempo, se coloca solo

const TIED = ['¡MMMPH! ¡MMM!', '¡MMM-MMM!', '(SOLLOZOS...)', '¡MMMPH!', '¡MMM! ¡MMM!'];
const FREED = ['¡GRACIAS!', '¡ME SALVASTE!', '¡CUIDADO, HAY MÁS!', '¡NO ME DEJES AQUÍ!'];
const RELIEF = ['¡POR FIN LIBRES!', '¡VÁMONOS DE AQUÍ!', '¡GRACIAS POR TODO!'];
const HIT = '¡MMMPH!!';
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join(''); };
// COMPAÑERO del prólogo (`partner`): rehén herido que no pelea. Mientras `protected`, tus golpes y balas lo ignoran (ni muere ni penaliza); al liberarlo pasa a `follow`
// (te sigue cojeando, sin acercarse más de FOLLOW_GAP) y, con el piso despejado, a `freed`: sale con el flujo normal de extracción (moto, detrás de ti).
const FOLLOW_GAP = 26, FOLLOW_SPEED = 80, FOLLOW_FAST = 110, FOLLOW_FAR = 130;
const PARTNER_TIED = ['(TOS...) ¡AQUÍ!', '¡CUIDADO CON ELLOS!', '¡SUÉLTAME!'];
const PARTNER_FREED = ['TARDASTE...', 'ESTOY BIEN. VÁMONOS.'];
const TARGETABLE = new Set(['tied', 'follow', 'freed', 'waiting', 'exiting', 'ready']);

class Hostage {
  constructor(d) {
    this.x = d.x; this.y = d.y;
    this.look = d.look;
    this.partner = !!d.partner;   // compañero del prólogo
    this.agent = d.agent || 'female'; this.maskId = d.maskId || 'neon'; this.maskName = d.maskName || ''; this.masked = false; // aspecto del agente; la máscara se la cedes al liberarlo
    this.protected = this.partner; // tus golpes y balas no le hacen nada
    this.facing = d.facing;
    this.r = 7;
    this.state = 'tied';
    this.say = null; this.sayT = 0; this.sayCd = 0.5 + Math.random();
    this.path = null; this.pathT = 0;
    this.shiver = Math.random() * 6;
    this.hits = 0;            // golpes cuerpo a cuerpo recibidos (1 = tumbado, 2 = muerto)
    this.hitCd = 0;           // gracia tras un golpe
    this.down = false;        // tumbado (con la silla, si sigue atado)
    this.downT = 0;
    this.target = null;       // adónde va al salir a la calle
    this.slot = 0;
    this.boardT = 0;
    this.ride = null;
    this.fade = 1;
  }
  get alive() { return TARGETABLE.has(this.state); }
}

const lerp = (a, b, t) => a + (b - a) * t;

export class Hostages {
  constructor(game, data = []) {
    this.game = game;
    this.list = data.map((d) => new Hostage(d));
    this.clock = 0;
    this.planned = false;       // ¿ya se ha decidido cómo salen (moto o auto)?
    this.outside = false;       // el jugador ya ha salido a la calle con el piso despejado (a partir de ahí se planifica la extracción)
    this.mode = null;           // null | 'bike' | 'car'
    this.group = [];            // los rehenes que salen
    this.car = null;
    this.plannedAt = 0;
  }

  get total() { return this.list.length; }

  // El rehén atado más cercano que se puede liberar desde donde está el jugador (o null).
  nearTarget() {
    const p = this.game.player;
    let best = null, bd = INTERACT_GAP;
    for (const h of this.list) {
      if (h.state !== 'tied') continue;
      const d = Math.hypot(p.x - h.x, p.y - h.y) - h.r;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.clock += dt;
    if (this.list.length === 0) return;
    const hot = g.enemies.some((e) => e.alive && (e.state === 'chase' || e.state === 'alert')); // hay pelea: tiemblan más
    for (const h of this.list) {
      h.sayT = Math.max(0, h.sayT - dt);
      h.sayCd = Math.max(0, h.sayCd - dt);
      h.hitCd = Math.max(0, h.hitCd - dt);
      if (h.down && h.state !== 'tied') { h.downT -= dt; if (h.downT <= 0) h.down = false; }  // los que no están atados se levantan
      if (h.state === 'tied') {
        h.shiver += dt * (hot ? 45 : 14);
        // Gimen amordazados cuando el jugador está cerca.
        if (p.alive && h.sayCd <= 0 && h.sayT <= 0 && !(h.partner && g.comms.cur) && Math.hypot(p.x - h.x, p.y - h.y) < 150) { { const L = h.partner ? PARTNER_TIED : TIED; h.say = L[Math.floor(Math.random() * L.length)]; } h.sayT = 2.2; h.sayCd = 4 + Math.random() * 3; }
      } else if (h.state === 'follow') {
        h.shiver += dt * 5;
        if (g.state === 'cleared') { h.state = 'freed'; h.path = null; }  // piso despejado: sigue la extracción de siempre
        else if (!h.down && p.alive) {
          if (Math.hypot(p.x - h.x, p.y - h.y) > FOLLOW_GAP) this.walk(h, dt, p.x, p.y, Math.hypot(p.x - h.x, p.y - h.y) > FOLLOW_FAR ? FOLLOW_FAST : FOLLOW_SPEED, FOLLOW_GAP, () => {});
          else h.path = null;
        }
      } else if (h.state === 'freed') {
        h.shiver += dt * 30;
        if (!h.down) this.walk(h, dt, g.entry.x, g.entry.y, RUN_SPEED, 26, () => {
          h.state = this.planned && this.group.includes(h) ? 'exiting' : 'waiting';
          if (h.state === 'exiting') this.aim(h);
          h.say = RELIEF[Math.floor(Math.random() * RELIEF.length)]; h.sayT = 2; h.sayCd = 8;
        });
      } else if (h.state === 'exiting') {
        h.shiver += dt * 10;
        if (!h.down && h.target) this.walk(h, dt, h.target.x, h.target.y, WALK_SPEED, 12, () => { h.state = 'ready'; h.path = null; });
      }
    }
    // Con el piso despejado y el jugador ya en la calle se decide cómo salen los rehenes liberados.
    this.refresh(false);
    this.stepExtraction(dt);
    // Liberar: PATEAR/INTERACTUAR (Espacio / F; en táctil el botón de la bota) junto a un rehén atado.
    if ((g.state === 'playing' || g.state === 'cleared') && p.alive && !g.panel && !p.exec && !p.vomit && (g.keys.pressed('kick') || g.keys.pressed('execute'))) {
      const t = this.nearTarget();
      if (t) this.free(t);
    }
  }

  // Camina hacia (tx, ty) por el mapa (BFS) y llama a `done` al llegar a `arrive` unidades.
  walk(h, dt, tx, ty, speed, arrive, done) {
    const g = this.game, map = g.map;
    if (Math.hypot(tx - h.x, ty - h.y) < arrive) { done(); return; }
    h.pathT -= dt;
    if (!h.path || h.pathT <= 0) { h.path = findPath(map, h.x, h.y, tx, ty); h.pathT = 0.6; }
    const path = h.path;
    if (path) {
      while (path.length && Math.hypot(path[0].x - h.x, path[0].y - h.y) < 8) path.shift();
      if (path.length) {
        const dx = path[0].x - h.x, dy = path[0].y - h.y, d = Math.hypot(dx, dy) || 1;
        const py = h.y;
        moveAndSlide(map, h, (dx / d) * speed * dt, (dy / d) * speed * dt);
        // La puerta principal bloqueada (o cerrándose) no se cruza hacia la calle: se queda dentro, esperando a que el agente la abra.
        const door = g.mainDoor;
        if (door && (door.locked || door.closing) && py <= door.cy - DOOR_STOP && h.y > door.cy - DOOR_STOP) h.y = py;
        h.facing = Math.atan2(dy, dx);
      }
    }
  }

  // --- Extracción ---------------------------------------------------------------------------------
  // Rehenes liberados que aún no van en la moto ni en el auto (corriendo a la entrada, esperando o saliendo).
  rescued() { return this.list.filter((h) => h.state === 'freed' || h.state === 'waiting' || h.state === 'exiting' || h.state === 'ready'); }

  // Rehenes que siguen atados (sin rescatar): el aviso al irse del piso.
  pending() { return this.list.filter((h) => h.state === 'tied').length; }

  // Replanifica la extracción con los rehenes rescatados AHORA (se llama cada fotograma y al arrancar la fuga; `force` = el jugador ya está en la moto). Regla estricta:
  // rescatados === 1 → ese único rehén va en la moto; rescatados >= 2 → NINGUNO va en la moto: todos esperan al auto de extracción. Si cambia el número (se libera
  // otro tras decidirlo, o muere uno), se vuelve a repartir, así ningún rehén se queda sin plaza («rehén fantasma»). Mientras suben al auto no se toca el grupo.
  refresh(force) {
    const g = this.game, p = g.player;
    if (!this.outside && (force || (g.state === 'cleared' && p.alive && p.y > g.entry.y + 88)) && !g.mainDoor.locked) this.outside = true; // (con la puerta cerrada nadie sale)
    if (!this.outside) return;
    if (this.car && (this.car.phase === 'board' || this.car.phase === 'hold')) return;
    const cur = this.rescued();
    if (this.planned && cur.length === this.group.length && cur.every((h) => this.group.includes(h))) return;
    this.plan(cur);
  }

  plan(group) {
    const g = this.game;
    this.planned = true;
    this.plannedAt = this.clock;
    this.group = group;
    this.mode = group.length >= 2 ? 'car' : group.length === 1 ? 'bike' : null;
    if (this.mode === 'car') { if (!this.car || this.car.phase === 'depart' || this.car.phase === 'gone') this.car = new ExtractionCar(g); }
    else if (this.car && (this.car.phase === 'wait' || this.car.phase === 'arrive' || this.car.phase === 'idle')) this.car = null; // ya no hacen falta dos o más: sin auto
    group.forEach((h, i) => { h.slot = i; if (h.state === 'waiting' || h.state === 'exiting' || h.state === 'ready') { h.state = 'exiting'; this.aim(h); } });
  }

  // Punto al que sale el rehén: junto a la moto (uno) o a la acera donde para el auto (varios).
  aim(h) {
    const g = this.game, b = g.bike;
    h.path = null;
    h.target = this.mode === 'car' && this.car ? this.car.slot(h.slot, this.group.length) : { x: b.park.x - 30, y: b.park.y - 44 };
  }

  allReady() { return this.group.every((h) => h.state === 'ready' || h.state === 'dead' || h.state === 'boarding' || h.state === 'boarded'); }
  allBoarded() { return this.group.every((h) => h.state === 'boarded' || h.state === 'dead'); }

  startBoarding() {
    this.group.forEach((h, i) => { if (h.state === 'ready' || h.state === 'exiting') { h.state = 'boarding'; h.boardT = -i * 0.35; h.boardFrom = { x: h.x, y: h.y }; } });
  }

  // Avanza el auto y la subida de los rehenes (también durante la cinemática de fuga: el auto arranca mientras el jugador se va en la moto).
  stepExtraction(dt) {
    const g = this.game;
    if (this.planned && this.mode) {
      // Los que se atascan (puerta, ruta) se colocan solos pasado un tiempo.
      if (this.clock - this.plannedAt > STUCK_TIME && !(g.mainDoor && (g.mainDoor.locked || g.mainDoor.closing))) {
        for (const h of this.group) if (h.state === 'freed' || h.state === 'waiting' || h.state === 'exiting') { this.aim(h); if (h.target) { h.x = h.target.x; h.y = h.target.y; } h.state = 'ready'; }
      }
    }
    if (this.car) this.car.update(dt, g, this);
    for (const h of this.list) {
      if (h.state !== 'boarding' || !this.car) continue;
      h.boardT += dt / BOARD_TIME;
      if (h.boardT < 0) continue;
      if (!h.sound) { h.sound = true; g.playAt('carDoor', this.car.x, this.car.y, 0.9); }
      const k = Math.min(1, h.boardT), e = k * k * (3 - 2 * k);
      h.x = lerp(h.boardFrom.x, this.car.x, e); h.y = lerp(h.boardFrom.y, this.car.y - 8, e); h.fade = 1 - e;
      if (k >= 1) h.state = 'boarded';
    }
  }

  // ¿Hay que esperar a que los rehenes estén a bordo antes de arrancar la fuga? (moto: que el rehén esté junto a ella; auto: que estén todos subidos)
  extractionBusy() {
    if (!this.planned || !this.mode) return false;
    if (this.mode === 'bike') return !this.group.every((h) => h.state === 'ready' || h.state === 'riding' || h.state === 'dead');
    return this.car ? this.car.busy : false;
  }

  // El jugador arranca la fuga: el rehén que espera junto a la moto se sube detrás de él.
  boardBike() {
    for (const h of this.group) if (this.mode === 'bike' && h.state === 'ready') { h.state = 'riding'; h.ride = { x0: h.x, y0: h.y }; h.shiver = 0; }
  }

  // Durante la fuga (updateCine): el que va en la moto se coloca detrás del protagonista (k: 0..1 mientras se sube, 1 después).
  rideUpdate(k, bike) {
    const a = bike.angle || 0, z = bike.z || 0;
    for (const h of this.list) {
      if (h.state !== 'riding') continue;
      const rx = bike.x - 18 * Math.cos(a), ry = bike.y - 18 * Math.sin(a) - z;
      h.x = lerp(h.ride.x0, rx, k); h.y = lerp(h.ride.y0, ry, k);
      h.facing = a;
    }
  }

  // --- Liberar, golpes y balas ----------------------------------------------------------------------
  free(h) {
    const g = this.game;
    if (h.partner) {
      h.state = 'follow'; h.down = false; h.path = null;
      h.say = PARTNER_FREED[Math.floor(Math.random() * PARTNER_FREED.length)]; h.sayT = 2.4; h.sayCd = 6;
      g.sfx.play('unlock');
      g.sfx.play('pickup', 0.8);
      g.addFloat(h.x, h.y - 20, '¡COMPAÑERO LIBRE!', '#9be32a', 1, 1.8);
      g.particles.dust(h.x, h.y, 6);
      h.masked = true;                                       // le cedes la otra máscara (solo visual)
      g.sfx.play('maskOn');
      g.particles.neon(h.x, h.y, -Math.PI / 2, 10, 2);
      g.addFloat(h.x, h.y - 34, `MÁSCARA CEDIDA: ${h.maskName}`, '#05d9e8', 1, 2);
      if (g.prologue) g.prologueLine('free');
      if (g.comms.cur || g.comms.queue.length) { h.say = null; h.sayT = 0; }   // sus líneas de comunicación sustituyen a la frase genérica
      return;
    }
    h.state = 'freed';
    h.down = false;
    h.say = FREED[Math.floor(Math.random() * FREED.length)]; h.sayT = 2.4; h.sayCd = 6;
    g.score.addBonus(RESCUE_POINTS);
    g.sfx.play('unlock');
    g.sfx.play('pickup', 0.8);
    g.addFloat(h.x, h.y - 20, `¡REHÉN LIBERADO! +${RESCUE_POINTS}`, '#9be32a', 1, 1.8);
    g.particles.dust(h.x, h.y, 6);
  }

  // Golpe cuerpo a cuerpo del jugador (clic / ATACAR; la patada es la acción de liberar): el primero tumba al rehén en su silla con un micro-temblor de
  // cámara y una burbuja de dolor (advertencia); el segundo lo mata. Devuelve true si golpeó a alguien.
  meleeHit(p, def) {
    let hit = false;
    for (const h of this.list) {
      if (!h.alive || h.protected || !inMeleeArc(p.x, p.y, p.angle, def, h)) continue;
      hit = true;
      if (h.hitCd > 0) continue;                       // pasado un instante del primer golpe: el aviso se nota, no se remata en el mismo tirón
      h.hits++;
      if (h.hits === 1) this.knock(h, p.angle);
      else this.kill(h, p.angle);
    }
    return hit;
  }

  knock(h, angle) {
    const g = this.game;
    h.down = true; h.downT = 1.4; h.hitCd = GRACE;
    h.say = HIT; h.sayT = 2; h.sayCd = 3;
    g.camera.addShake(4);
    g.sfx.play('hit', 0.7);
    g.particles.dust(h.x, h.y, 5);
    if (h.state !== 'tied') h.path = null;
  }

  // Una bala del jugador: la bala se detiene en el rehén y lo mata (sin aviso previo). Devuelve true si le dio a alguien.
  bulletHit(b) {
    for (const h of this.list) {
      if (!h.alive || h.protected || segmentPointDistance(b.px, b.py, b.x, b.y, h.x, h.y) >= h.r + b.r) continue;
      this.kill(h, Math.atan2(b.vy, b.vx));
      return true;
    }
    return false;
  }

  kill(h, angle) {
    const g = this.game;
    h.state = 'dead';
    h.down = true;
    h.say = null; h.sayT = 0;
    g.bleed(h.x, h.y, angle, 1, 0.8);
    if (Math.hypot(g.player.x - h.x, g.player.y - h.y) < 120) g.stainPlayer(0.8, angle);
    g.camera.addShake(8);
    g.sfx.play('hit');
    g.addFloat(h.x, h.y - 22, `¡REHÉN ABATIDO! -${KILL_PENALTY} AL FINAL`, COLORS.blood, 1, 2.2);
    g.street.startGuilt(); // culpa: a los 3 s el protagonista se quita la máscara y vomita (ver Game.guilt)
  }

  // Resumen para el final del piso.
  summary() {
    const saved = this.list.filter((h) => h.state !== 'tied' && h.state !== 'dead').length;
    const killed = this.list.filter((h) => h.state === 'dead').length;
    return { total: this.list.length, saved, killed, penalty: killed * KILL_PENALTY };
  }

  // --- Dibujo ---------------------------------------------------------------------------------------
  // Mundo (bajo los personajes). Los que van en la moto o en el auto no se dibujan aquí.
  draw(ctx, time) {
    for (const h of this.list) {
      if (h.state === 'riding' || h.state === 'boarded') continue;
      this.drawOne(ctx, h);
    }
  }

  // Encima de las paredes: el auto de extracción (con las aberturas de la valla por donde entra y sale).
  drawOver(ctx, time) {
    if (this.car) this.car.draw(ctx, time, this.game);
  }

  // El rehén que va en la moto, detrás del protagonista (se dibuja tras la moto y antes del jugador).
  drawRiding(ctx) {
    for (const h of this.list) if (h.state === 'riding') this.drawOne(ctx, h);
  }

  // El compañero del prólogo (`partner`): el otro agente, con su cuerpo y cabeza de personaje (herido: sangre nivel 2), atado a la silla hasta que lo liberas;
  // sin máscara hasta que le cedes la otra (h.masked). Se dibuja girado hacia donde mira, como el jugador.
  drawPartner(ctx, h) {
    const g = this.game, x = Math.round(h.x), y = Math.round(h.y), tied = h.state === 'tied', female = h.agent === 'female', lvl = g.goreOn ? 2 : 0;
    ctx.save();
    ctx.globalAlpha = h.state === 'boarding' ? Math.max(0, h.fade) : 1;
    ctx.fillStyle = 'rgba(5,0,15,0.5)'; pixelRect(ctx, x - 12, y + 8, 14, 4);                // sombra
    ctx.translate(x, y);
    ctx.rotate(h.facing);
    if (tied) {                                                                              // silla (respaldo detrás) y asiento
      ctx.fillStyle = '#14100a'; pixelRect(ctx, -16, -10, 5, 20);
      ctx.fillStyle = '#5b4a2a'; pixelRect(ctx, -15, -9, 3, 18);
      ctx.fillStyle = '#3a2f1a'; pixelRect(ctx, -12, -8, 14, 16);
    }
    drawSprite(ctx, playerBody(h.maskId, lvl, h.agent), 0, 0);
    if (female) drawSprite(ctx, 'ponytail', -3, 0, 0, { ox: 10, oy: 2.5 });
    drawMaskHead(ctx, h.masked ? h.maskId : (female ? 'bare_f' : 'bare'), lvl);
    if (tied) { ctx.fillStyle = '#b8864a'; ctx.fillRect(-4, -12, 3, 24); ctx.fillRect(4, -12, 3, 24); } // cuerdas
    ctx.restore();
    const a = AGENTS[h.agent];
    if (tied) { ctx.fillStyle = '#ffbe0b'; pixelRect(ctx, x, y - 26, 1, 3); pixelRect(ctx, x, y - 20, 1, 1); } // «!» de socorro
    drawText(ctx, a.name, x, y - 34, { color: a.color, scale: WORLD_PX, align: 'center' });
  }

  // Rehén (no el compañero del prólogo): aspecto urbano generado en map.js (`hostageLook`): prenda, peinado, piel, gafas, bufanda y marcas de maltrato; los hombres y las mujeres
  // se distinguen por el peinado y por un torso algo más estrecho. Atado: cuerdas, mordaza, «!» de socorro, sudor y temblor; tumbado o muerto: de lado con su silla volcada.
  drawOne(ctx, h) {
    if (h.partner) { this.drawPartner(ctx, h); return; }
    const L = h.look, x = Math.round(h.x), y = Math.round(h.y);
    const garment = L.garment || 'tee', style = L.style || 'short', fem = L.gender === 'f', ol = '#14100a', sk = L.skin, top = L.shirt, t2 = L.shirt2 || shade(top, 0.7);
    const tied = h.state === 'tied', dead = h.state === 'dead';
    const moving = h.state === 'freed' || h.state === 'exiting' || h.state === 'riding' || h.state === 'follow';
    const sh = (tied || moving || h.state === 'waiting') ? Math.round(Math.sin(h.shiver) * (h.state === 'waiting' ? 0.6 : 1)) : 0;
    ctx.save();
    ctx.globalAlpha = h.state === 'boarding' ? Math.max(0, h.fade) : 1;
    const px = (ox, oy, w, hh, col) => { ctx.fillStyle = col; pixelRect(ctx, x + (ox + sh) * WORLD_PX, y + oy * WORLD_PX, w, hh); };
    if (dead || h.down) {                           // tumbado (muerto, oscuro; o aturdido por un golpe, con su silla volcada si sigue atado)
      px(-8, 3, 16, 5, 'rgba(5,0,15,0.5)');
      if (tied || dead) { px(-10, -4, 4, 11, ol); px(-9, -3, 2, 9, '#5b4a2a'); }  // silla volcada
      px(-4, -3, 12, 7, ol); px(-3, -2, 10, 5, garment === 'tank' ? sk : top);
      if (garment === 'stripes') { px(-1, -2, 1, 5, t2); px(3, -2, 1, 5, t2); }
      if (garment === 'jacket') px(-3, -2, 10, 1, t2);
      if (garment === 'vest') px(-1, -2, 4, 5, top);
      px(8, -2, 4, 5, ol); px(8, -1, 3, 3, sk);
      if (style !== 'bald' && style !== 'buzz') px(7, -2, 3, 2, style === 'cap' || style === 'beanie' ? L.hat : L.hair);
      if (style === 'long' || style === 'bob' || fem) px(6, 1, 4, 2, L.hair);
      if (dead) { px(-3, -2, 10, 5, 'rgba(0,0,0,0.4)'); px(8, -1, 3, 3, 'rgba(0,0,0,0.4)'); }
      else if (tied) { px(-3, -1, 10, 1, '#b8864a'); px(9, -1, 2, 1, '#e8e4f0'); }       // cuerdas y mordaza
      ctx.restore();
      return;
    }
    px(-6, 4, 14, 4, 'rgba(5,0,15,0.5)');                                    // sombra
    if (tied) {                                  // silla (respaldo detrás) y asiento
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(h.facing);
      ctx.fillStyle = ol; pixelRect(ctx, -16, -10, 5, 20);
      ctx.fillStyle = '#5b4a2a'; pixelRect(ctx, -15, -9, 3, 18);
      ctx.fillStyle = '#3a2f1a'; pixelRect(ctx, -12, -8, 14, 16);
      ctx.restore();
    }
    // cuerpo: contorno, prenda y sombreado (las mujeres, torso algo más estrecho)
    const bx = fem ? -5 : -6, bw = fem ? 10 : 12;
    px(bx, -5, bw, 10, ol);
    px(bx + 1, -4, bw - 2, 8, garment === 'tank' ? sk : (garment === 'vest' || garment === 'jacket') ? t2 : top);
    if (garment === 'hoodie') { px(-4, -6, 8, 2, shade(top, 0.7)); px(-1, -3, 1, 3, '#e8e4f0'); px(1, -3, 1, 3, '#e8e4f0'); px(-3, 1, 6, 2, shade(top, 0.8)); }
    else if (garment === 'jacket') { px(bx + 1, -4, 3, 8, top); px(bx + bw - 4, -4, 3, 8, top); px(0, -4, 1, 8, shade(top, 0.55)); }
    else if (garment === 'tank') px(-2, -4, 5, 8, top);
    else if (garment === 'stripes') { for (const oy of [-3, 0, 3]) px(bx + 1, oy, bw - 2, 1, t2); }
    else if (garment === 'vest') { px(-3, -4, 6, 8, top); px(-3, -1, 6, 1, '#e8e4f0'); }
    px(bx + 1, -4, bw - 2, 1, 'rgba(255,255,255,0.18)'); px(bx + 1, 3, bw - 2, 1, 'rgba(0,0,0,0.25)');
    for (let i = 0; i < (L.dirt || 0); i++) px(((L.dirtSeed || 7) * (i + 3)) % 7 - 3, ((L.dirtSeed || 7) * (i + 5)) % 6 - 3, 2, 1, 'rgba(20,10,5,0.4)'); // roña
    if (L.scarf) px(-3, -3, 7, 2, L.scarf);
    if (style === 'long' || style === 'bob') px(-3, -3, 7, style === 'long' ? 3 : 1, L.hair);          // pelo sobre los hombros
    if (style === 'ponytail') { px(0, -3, 2, 4, L.hair); px(0, -3, 2, 1, '#ff2a85'); }
    // cabeza
    px(-3, -8, 7, 6, ol);
    if (style === 'bald') { px(-2, -7, 5, 4, sk); px(-2, -7, 5, 1, 'rgba(255,255,255,0.25)'); }
    else if (style === 'buzz') px(-2, -7, 5, 4, shade(sk, 0.55));
    else if (style === 'mohawk') { px(-2, -7, 5, 4, sk); px(0, -9, 2, 6, L.hair); }
    else if (style === 'cap') { px(-2, -7, 5, 4, L.hat); px(Math.cos(h.facing) >= 0 ? 2 : -3, -6, 2, 2, shade(L.hat, 0.6)); }
    else if (style === 'beanie') { px(-3, -8, 7, 5, L.hat); px(-3, -5, 7, 1, shade(L.hat, 1.5)); }
    else px(-2, -7, 5, 4, L.hair);
    if (style === 'bun') px(-1, -10, 3, 3, L.hair);
    if (style === 'long') { px(-4, -7, 1, 8, L.hair); px(4, -7, 1, 8, L.hair); }
    else if (style === 'bob') { px(-4, -7, 1, 5, L.hair); px(4, -7, 1, 5, L.hair); }
    const fx = Math.cos(h.facing) >= 0 ? 1 : -2;
    px(fx, -6, 2, 2, sk);
    if (L.glasses) px(fx, -6, 2, 1, '#14141e'); else px(fx + (fx > 0 ? 1 : 0), -6, 1, 1, '#140a08'); // gafas u ojo
    if (L.bruise) px(fx, -5, 2, 1, '#6b2f5a');                              // moretón
    if (tied) {
      px(fx, -5, 2, 1, '#e8e4f0');                                           // mordaza
      px(bx, -3, bw, 1, '#b8864a'); px(bx, 1, bw, 1, '#b8864a');             // cuerdas
      px(-7, -1, 2, 3, sk);                                                  // manos atadas a la espalda
      px(0, -12, 1, 3, '#ffbe0b'); px(0, -8, 1, 1, '#ffbe0b');              // «!» de socorro
      const sp = Math.floor(h.shiver * 0.35) % 4;                           // gota de sudor frío que resbala por la sien
      if (sp < 2) px(fx > 0 ? 4 : -5, -7 + sp, 1, 1, '#9ff6ff');
    } else {
      const ax = fem ? 1 : 0, bare = garment === 'tank';                     // brazos sueltos (mangas de la prenda o piel)
      px(-8 + ax, -2, 2, 4, bare ? sk : top); px(6 - ax, -2, 2, 4, bare ? sk : top);
      px(-8 + ax, 1, 2, 1, sk); px(6 - ax, 1, 2, 1, sk);
    }
    ctx.restore();
  }

  // Pantalla: aviso informativo junto a la moto cuando quedan rehenes atados (el rescate es opcional): cuántos faltan y cómo irse igualmente.
  drawLeaveAsk(ctx, w, h) {
    const g = this.game, n = g.leaveAsk;
    if (!n || g.state !== 'cleared') return;
    const pa = g.prologue ? this.list.find((x) => x.partner && x.state === 'tied') : null;   // en el prólogo el que falta es el compañero: se le nombra
    const msg = pa ? `Esperas a ${AGENTS[pa.agent].name}: sigue dentro.` : n === 1 ? 'Falta 1 rehén por rescatar.' : `Faltan ${n} rehenes por rescatar.`;
    const sub = g.hint(`${g.keys.label('kick')} · IRTE IGUALMENTE`, 'TOCA LA MOTO (BOTA) · IRTE IGUALMENTE');
    const s = g.camera.worldToScreen(g.bike.x, g.bike.y - 34);
    const tw = Math.max(measureText(msg), measureText(sub)), bw = tw + 12, bh = 27;
    const p = g.keepOnScreen(s.x, s.y - bh, bw, bh, 6);
    const bx = Math.round(p.x - bw / 2), by = Math.round(p.y);
    ctx.fillStyle = 'rgba(13, 2, 33, 0.92)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#ffbe0b';
    ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
    drawText(ctx, msg, bx + bw / 2, by + 4, { color: '#ffbe0b', align: 'center', shadow: null });
    drawText(ctx, sub, bx + bw / 2, by + 15, { color: COLORS.text, align: 'center', shadow: null });
  }

  // Pantalla: aviso de liberar y burbujas (frases amordazadas / de dolor / de gratitud).
  drawHud(ctx, w, h) {
    const g = this.game;
    const talking = !!(g.comms && (g.comms.cur || g.comms.queue.length)); // hay una línea de comunicación: el compañero no dice nada más a la vez
    if (this.list.length === 0 || (g.state !== 'playing' && g.state !== 'cleared' && g.state !== 'leaving')) return;
    const cam = g.camera;
    const t = g.state !== 'leaving' && g.player.alive && !g.panel ? this.nearTarget() : null;
    if (t) {
      const txt = `${g.hint(g.keys.label('kick'), 'BOTA')} · LIBERAR`;
      const s = cam.worldToScreen(t.x, t.y + 20);
      const p = g.keepOnScreen(s.x, s.y, measureText(txt), 8);
      drawText(ctx, txt, p.x, p.y, { color: '#9be32a', align: 'center', shadow: COLORS.background });
    }
    for (const hs of this.list) {
      if (hs.state === 'dead' || hs.state === 'boarded' || hs.sayT <= 0 || !hs.say || (hs.partner && talking)) continue;
      const s = cam.worldToScreen(hs.x, hs.y - 26);
      if (s.x < -4 || s.x > w + 4 || s.y < -4 || s.y > h + 4) continue;
      const tw = measureText(hs.say), bp = g.keepOnScreen(s.x, s.y - 3, tw + 8, 13, 6);
      const bx = Math.round(bp.x - (tw + 8) / 2), by = Math.round(bp.y);
      ctx.fillStyle = 'rgba(13, 2, 33, 0.92)'; ctx.fillRect(bx, by, tw + 8, 13);
      ctx.fillStyle = hs.say === HIT ? COLORS.blood : hs.state === 'tied' ? '#ffbe0b' : '#9be32a';
      ctx.fillRect(bx, by, tw + 8, 1); ctx.fillRect(bx, by + 12, tw + 8, 1); ctx.fillRect(bx, by, 1, 13); ctx.fillRect(bx + tw + 7, by, 1, 13);
      drawText(ctx, hs.say, bx + 4, by + 3, { color: COLORS.text, shadow: null });
    }
  }
}
