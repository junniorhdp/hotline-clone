import { moveAndSlide, lineOfSight, findPath, isSolidAt } from './map.js';
import { renderFloor, renderWalls, renderProps } from './decor.js';

const SEWER_PAL = { brick: ['#10281a', '#09160f', '#1d4a2e'], neon: ['#39ff6a', '#1a9a40'], glow: '#39ff6a' }; // paredes de alcantarilla: ladrillo verdoso y tubo neón verde tóxico
import { drawSprite, pixelRect, pixelDisc, WORLD_PX } from './sprites.js';
import { drawText } from './pixelfont.js';
import { COLORS, angleDiff, rand } from './utils.js';
import { buildTunnelMap } from './tunnel-map.js';
import { Ambience, paintStatics } from './tunnel-ambience.js';

// TRAMO DE ALCANTARILLA del piso 3 (estado 'sewer'). Al forzar la tapa de la entrada con la palanca se baja a un túnel corto con colisiones: pilares de piedra, un canal de
// agua, tuberías y una escalera al otro extremo que sube al cuarto de servicio del edificio. Un COCODRILO (invulnerable) hace la ronda por el túnel:
//   · patrulla despacio por la fila despejada (`patrol`, barriendo la cabeza) y te ve si estás en su cono con línea de visión (o muy cerca, aunque le des la espalda); también OYE ruidos (`hear`);
//   · si te ve pero un pilar le estropearía la embestida, te rodea (`stalk`) hasta tener un carril limpio; tras fallar o perderte te busca (`search`) donde te vio por última vez;
//   · al verte se detiene y avisa (`alert`, línea roja en el suelo; el rumbo se bloquea en el último tramo del aviso) y EMBISTE en línea recta (`charge`, 420 u/s);
//   · si choca con un pilar o una pared queda aturdido (`crash`) y puedes pasar; si no choca, recupera el aliento (`recover`) y vuelve a la ronda;
//   · un arma LANZADA a sus ojos lo CIEGA (`blind`; la palanca 5 s, otra arma 2,5 s): ya no te ve y no hace daño; es la salida más segura.
// Tocarlo con la ronda, el aviso, la embestida o al recuperarse es mortal (R reaparece en la calle: no se había entrado todavía). Aquí no hay enemigos ni armas del suelo.
const VIEW = 230, CONE = 1.05, NEAR = 78;      // alcance de la vista, medio ángulo del cono (rad) y radio de «lo oigo/lo huelo» aunque esté a su espalda
const FEED_SENSE = 120;                        // comiendo: radio al que te nota
const PATROL_SPEED = 56, CHARGE_SPEED = 420, STALK_SPEED = 150, SEARCH_SPEED = 110;
const WINDUP = 0.7, LOCK_AT = 0.45, CHARGE_MAX = 0.95, RECOVER = 0.8, CRASH = 2.3;
const BLIND_CROWBAR = 5, BLIND_OTHER = 2.5;
const HEAD = 24;                               // distancia del centro a la cabeza
const BODY_R = 13, HEAD_R = 11, EYE_R = 14;    // radios de contacto (cuerpo y cabeza) y de la zona de los ojos para el arma lanzada
const LADDER_REACH = 44;                       // distancia al centro de la escalera para poder subir

class Croc {
  constructor(map) {
    this.map = map;
    this.x = map.crocStart.x; this.y = map.crocStart.y + 12;
    this.r = BODY_R - 1;                       // semitamaño de colisión con las paredes (moveAndSlide)
    this.angle = -Math.PI / 2;
    this.mode = 'feed';                        // empieza DEVORANDO un cuerpo (ver tunnel-ambience.js): solo te nota si te acercas mucho o haces ruido
    this.feedT = 0;
    this.t = 0;
    this.clock = 0;
    this.leg = 0; this.dirStep = 1;            // ronda: índice del tramo y sentido
    this.lock = 0;                             // rumbo bloqueado de la embestida
    this.hold = 0;                             // pausa al girar en los extremos de la ronda
    this.charged = 0;
    this.blindT = 0;
    this.wander = 0;
    this.searchT = 0;
    this.path = null; this.repath = 0;         // ruta de `stalk` / `search`
    this.last = null;                          // última posición en la que te vio u oyó
    this.pv = { x: 0, y: 0 }; this.pp = null;  // velocidad estimada del jugador (para adelantar la embestida)
  }

  get head() { return { x: this.x + Math.cos(this.angle) * HEAD, y: this.y + Math.sin(this.angle) * HEAD }; }
  get lethal() { return this.mode === 'feed' || this.mode === 'patrol' || this.mode === 'alert' || this.mode === 'charge' || this.mode === 'recover' || this.mode === 'stalk' || this.mode === 'search'; }
  get look() { return this.mode === 'patrol' ? this.angle + Math.sin(this.clock * 1.4) * 0.45 : this.angle; } // en la ronda barre la cabeza de un lado a otro

  // ¿Ve al jugador? Cono delante (que barre), con línea de visión, o muy cerca (le des o no la espalda).
  sees(p) {
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (this.mode === 'feed') return d < FEED_SENSE && lineOfSight(this.map, this.x, this.y, p.x, p.y); // comiendo, solo te nota de cerca (a cualquier lado)
    if (d > VIEW || !lineOfSight(this.map, this.x, this.y, p.x, p.y)) return false;
    if (d < NEAR) return true;
    return Math.abs(angleDiff(Math.atan2(p.y - this.y, p.x - this.x), this.look)) < CONE;
  }

  // ¿Hay un carril limpio (del ancho del cuerpo) hasta el punto? Si no, la embestida acabaría en un pilar y quedaría aturdido: la IA se recoloca antes de embestir.
  lane(tx, ty) {
    const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
    for (let k = 20; k < d; k += 12) for (const o of [-11, 0, 11]) if (isSolidAt(this.map, this.x + (dx / d) * k + nx * o, this.y + (dy / d) * k + ny * o)) return false;
    return true;
  }

  // Punto al que apunta la embestida: donde estarás en ~0,3 s si sigues corriendo (adelanto limitado).
  lead(p) {
    const c = (v) => Math.max(-70, Math.min(70, v * 0.3));
    return { x: p.x + c(this.pv.x), y: p.y + c(this.pv.y) };
  }

  blind(seconds, run, game) {
    this.mode = 'blind'; this.t = 0; this.blindT = seconds; this.wander = 0; this.path = null;
    game.playAt('crocDown', this.x, this.y, 1);
    game.addFloat(this.x, this.y - 30, '¡EN LOS OJOS!', '#ffffff', 2, 1.2);
    game.camera.addShake(8); game.fx.kick(0.4);
    game.particles.sparks(this.head.x, this.head.y, this.angle, 10, 0.6);
  }

  // Oye un ruido (disparo, golpe, arma lanzada): si patrulla o busca, va a investigar el origen.
  hear(x, y, radius) {
    if (this.mode !== 'patrol' && this.mode !== 'search' && this.mode !== 'feed') return;
    if (Math.hypot(x - this.x, y - this.y) > Math.min(radius, 520) * 0.8) return;
    this.last = { x, y }; this.mode = 'search'; this.t = 0; this.searchT = 0; this.path = null; this.repath = 0;
  }

  // Sigue una ruta de casillas a `speed` hacia (tx, ty); devuelve true al llegar.
  follow(dt, speed, tx, ty) {
    this.repath -= dt;
    if (!this.path || this.repath <= 0) { this.path = findPath(this.map, this.x, this.y, tx, ty) || []; this.repath = 0.4; }
    while (this.path.length && Math.hypot(this.path[0].x - this.x, this.path[0].y - this.y) < 12) this.path.shift();
    const w = this.path[0] || { x: tx, y: ty };
    const want = Math.atan2(w.y - this.y, w.x - this.x);
    this.angle += angleDiff(want, this.angle) * Math.min(1, dt * 7);
    moveAndSlide(this.map, this, Math.cos(this.angle) * speed * dt, Math.sin(this.angle) * speed * dt);
    return !this.path.length && Math.hypot(tx - this.x, ty - this.y) < 16;
  }

  // Ha visto al jugador: embiste si tiene carril limpio y está a tiro; si no, se recoloca rodeando los pilares.
  engage(p, game) {
    const d = Math.hypot(p.x - this.x, p.y - this.y), a = this.lead(p);
    this.last = { x: p.x, y: p.y };
    if (d < 320 && this.lane(p.x, p.y) && this.lane(a.x, a.y)) {
      this.mode = 'alert'; this.t = 0; this.path = null;
      game.playAt('crocUp', this.x, this.y, 1); game.addFloat(this.x, this.y - 30, '¡GRRR!', '#ff2e55', 2, 0.9);
      if (!game.sewerRun.hinted) {
        game.sewerRun.hinted = true;
        game.addFloat(p.x, p.y - 34, p.weapon ? `LÁNZALE ${p.weapon.type === 'crowbar' ? 'LA PALANCA' : 'EL ARMA'} A LOS OJOS · ${game.hint(game.keys.label('throw'), 'LANZAR')}` : 'ESQUIVA: QUE SE ESTRELLE CONTRA UN PILAR', '#ffffff', 1, 2.6);
      }
    } else { this.mode = 'stalk'; this.t = 0; this.path = null; this.repath = 0; }
  }

  toSearch() { this.mode = 'search'; this.t = 0; this.searchT = 0; this.path = null; this.repath = 0; }

  update(dt, p, run, game) {
    this.t += dt; this.clock += dt;
    const m = this.map;
    if (this.pp) {
      const vx = (p.x - this.pp.x) / dt, vy = (p.y - this.pp.y) / dt, k = Math.min(1, dt * 8);
      if (Math.hypot(vx, vy) > 700) { this.pv.x = 0; this.pv.y = 0; }           // (un salto de posición no es una carrera)
      else { this.pv.x += (vx - this.pv.x) * k; this.pv.y += (vy - this.pv.y) * k; }
    }
    this.pp = { x: p.x, y: p.y };
    const step = (speed, ang) => moveAndSlide(m, this, Math.cos(ang) * speed * dt, Math.sin(ang) * speed * dt);
    const sees = this.sees(p);
    if (this.mode === 'feed') {                        // devorando: sacude la cabeza contra el cuerpo y salpica sangre
      this.angle = -Math.PI / 2 + Math.sin(this.clock * 3.4) * 0.22;
      this.feedT -= dt;
      if (this.feedT <= 0) { this.feedT = rand(0.4, 0.9); const h = this.head; run.amb.splat(h.x, h.y - 6, -Math.PI / 2); }
      if (sees) this.engage(p, game);
    } else if (this.mode === 'patrol') {
      const tgt = m.route[this.leg];
      if (this.hold > 0) this.hold -= dt;
      else {
        const dx = tgt.x - this.x, dy = tgt.y - this.y, d = Math.hypot(dx, dy);
        if (d < 8) {                                   // fin del tramo: espera, gira y sigue por el siguiente
          const next = this.leg + this.dirStep;
          if (next < 0 || next >= m.route.length) this.dirStep = -this.dirStep;
          this.leg = Math.max(0, Math.min(m.route.length - 1, this.leg + this.dirStep));
          this.hold = 0.9;
        } else {
          const want = Math.atan2(dy, dx);
          this.angle += angleDiff(want, this.angle) * Math.min(1, dt * 4);
          step(PATROL_SPEED, this.angle);
        }
      }
      if (sees) this.engage(p, game);
    } else if (this.mode === 'stalk') {                // rodea los pilares hasta tener un carril limpio hacia ti
      if (sees) {
        this.last = { x: p.x, y: p.y };
        const a = this.lead(p);
        if (Math.hypot(p.x - this.x, p.y - this.y) < 320 && this.lane(p.x, p.y) && this.lane(a.x, a.y)) { this.engage(p, game); return; }
      }
      const tgt = sees ? p : this.last;
      if (this.follow(dt, STALK_SPEED, tgt.x, tgt.y) || this.t > 5) this.toSearch();
    } else if (this.mode === 'search') {               // va a donde te vio o te oyó por última vez y mira alrededor
      if (sees) { this.engage(p, game); return; }
      const L = this.last || { x: this.x, y: this.y };
      if (Math.hypot(L.x - this.x, L.y - this.y) > 22 && this.t < 7) this.follow(dt, SEARCH_SPEED, L.x, L.y);
      else {
        this.angle += Math.sin(this.clock * 2.2) * 1.6 * dt;
        this.searchT += dt;
        if (this.searchT > 2.6) { this.mode = 'patrol'; this.t = 0; this.leg = this.nearestLeg(); this.hold = 0; }
      }
    } else if (this.mode === 'alert') {
      const a = this.lead(p), aim = Math.atan2(a.y - this.y, a.x - this.x);
      if (this.t < LOCK_AT) this.angle += angleDiff(aim, this.angle) * Math.min(1, dt * 14); // se encara contigo (adelantándose a tu carrera)
      else this.lock = this.angle;
      if (this.t >= WINDUP) { this.mode = 'charge'; this.t = 0; this.charged = 0; this.lock = this.angle; game.camera.addShake(3); }
    } else if (this.mode === 'charge') {
      const ang = this.lock;
      this.angle = ang;
      const hit = step(CHARGE_SPEED, ang);
      this.charged += dt;
      if (Math.random() < 0.7) game.particles.dust(this.x - Math.cos(ang) * 26 + rand(-4, 4), this.y - Math.sin(ang) * 26 + rand(-4, 4), 1);
      if (hit.hitX || hit.hitY) {                      // choca con un pilar o una pared: aturdido
        this.mode = 'crash'; this.t = 0;
        game.camera.addShake(14); game.fx.kick(0.5);
        game.playAt('knock', this.x, this.y, 1);
        game.particles.dust(this.x + Math.cos(ang) * 20, this.y + Math.sin(ang) * 20, 12);
        game.particles.sparks(this.x + Math.cos(ang) * 24, this.y + Math.sin(ang) * 24, ang + Math.PI, 8, 0.5);
        game.addFloat(this.x, this.y - 30, '¡AL PILAR!', '#ffbe0b', 2, 1.1);
      } else if (this.charged >= CHARGE_MAX) { this.mode = 'recover'; this.t = 0; }
    } else if (this.mode === 'recover') {
      if (this.t >= RECOVER) this.toSearch();           // tras fallar, te busca donde te vio por última vez
    } else if (this.mode === 'crash') {
      if (this.t >= CRASH) this.toSearch();
    } else if (this.mode === 'blind') {
      this.blindT -= dt;
      this.wander -= dt;
      if (this.wander <= 0) { this.wander = rand(0.3, 0.7); this.angle += rand(-1.4, 1.4); }
      step(34, this.angle);                            // tambalea sin rumbo
      if (this.blindT <= 0) this.toSearch();
    }
    this.bite(p, game);
  }

  nearestLeg() {
    let best = 0, bd = Infinity;
    this.map.route.forEach((r, i) => { const d = Math.hypot(r.x - this.x, r.y - this.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // Mordisco: solo con el cocodrilo en condiciones de hacerlo (no aturdido ni ciego).
  bite(p, game) {
    if (!p.alive || !this.lethal) return;
    const h = this.head;
    if (Math.hypot(p.x - this.x, p.y - this.y) < BODY_R + p.r - 2 || Math.hypot(p.x - h.x, p.y - h.y) < HEAD_R + p.r - 2) this.chomp(p, game);
  }

  chomp(p, game) {
    const ang = Math.atan2(p.y - this.y, p.x - this.x);
    game.playAt('crocSnap', this.x, this.y, 1);
    game.addFloat(this.x, this.y - 30, '¡CLAC!', '#ffffff', 2, 0.9);
    game.deathMsg = 'DEVORADO POR EL COCODRILO';
    game.killPlayer(ang);
  }

  draw(ctx, clock) {
    drawSprite(ctx, 'croc', this.x, this.y, this.angle);
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const at = (f, l) => ({ x: this.x + ca * f - sa * l, y: this.y + sa * f + ca * l });
    ctx.fillStyle = '#b0102a';                          // hocico y mandíbula manchados de sangre
    for (const [f, l] of [[30, -3], [32, -2], [33, 0], [31, 3], [34, 2], [29, -5], [28, 5], [35, -1]]) { const q = at(f, l); pixelRect(ctx, q.x - 1, q.y - 1, 1, 1); }
    ctx.fillStyle = '#6a0818';
    for (const [f, l] of [[31, -4], [33, 2], [30, 1], [26, -5], [27, 4]]) { const q = at(f, l); pixelRect(ctx, q.x - 1, q.y - 1, 1, 1); }
    if (this.mode === 'alert') {                        // línea de aviso en el suelo hasta donde va a embestir
      const blink = Math.floor(clock * 14) % 2 === 0;
      ctx.fillStyle = blink ? '#ff2e55' : '#ff7a9a';
      for (let d = HEAD + 6; d < 300; d += 10) { const q = at(d, 0); pixelRect(ctx, q.x - 1, q.y - 1, 1, 1); }
      const a = at(10, 0); drawText(ctx, '!', a.x, a.y - 34, { color: '#ff2e55', scale: WORLD_PX, align: 'center' });
    } else if (this.mode === 'stalk' || this.mode === 'search') {   // olfatea: signo de interrogación ámbar
      if (Math.floor(clock * 3) % 2 === 0) { const a = at(10, 0); drawText(ctx, '?', a.x, a.y - 34, { color: '#ffbe0b', scale: WORLD_PX, align: 'center' }); }
    } else if (this.mode === 'blind') {                 // ojos tapados y estrellitas
      ctx.fillStyle = '#ffffff';
      for (const s of [-1, 1]) { const e = at(19, s * 4); pixelRect(ctx, e.x - 1, e.y - 1, 2, 2); }
      for (let k = 0; k < 3; k++) { const ph = clock * 5 + k * 2.1; const q = at(14, 0); pixelRect(ctx, q.x + Math.cos(ph) * 14, q.y + Math.sin(ph) * 14 - 8, 1, 1); }
    } else if (this.mode === 'crash') {
      ctx.fillStyle = '#ffbe0b';
      for (let k = 0; k < 4; k++) { const ph = clock * 4 + k * 1.6; const q = at(14, 0); pixelRect(ctx, q.x + Math.cos(ph) * 16, q.y + Math.sin(ph) * 10 - 12, 2, 1); }
    }
  }
}

// Estado del tramo: el mapa del túnel, sus capas ya dibujadas, el cocodrilo y la escalera de subida.
export class SewerRun {
  constructor(game) {
    this.map = buildTunnelMap();
    this.clock = 0;
    this.nearLadder = false;
    this.lootNear = false; this.looted = false;  // el cuerpo con la máscara secreta de RICK
    this.hinted = false;                       // el aviso de «lánzale el arma» sale una sola vez
    this.croc = new Croc(this.map);
    this.amb = new Ambience(this.map, this.map.crocStart);
    this.build();
    // Reflejos en el agua (posiciones fijas con fase propia).
    this.glints = [];
    for (let i = 0; i < 46; i++) this.glints.push({ x: 70 + Math.random() * (this.map.pixelW - 140), y: 5 * 32 + 6 + Math.random() * 3 * 32 - 12, ph: Math.random() * 6 });
  }

  // Capas estáticas (suelo, paredes con tuberías, muebles) y las de sangre (a media resolución, como las del piso).
  build() {
    const m = this.map, PX = 16;
    this.floorLayer = renderFloor(m);
    const fc = this.floorLayer.getContext('2d');
    for (const [y, up] of [[5 * PX, true], [8 * PX - 2, false]]) {          // bordillos del canal: piedra oscura con moho y goteo de limo
      fc.fillStyle = '#0a140d'; fc.fillRect(2 * PX, y - (up ? 2 : 0), (m.w - 4) * PX, 2);
      fc.fillStyle = '#3f9a2a'; for (let x = 2 * PX; x < (m.w - 2) * PX; x += 7) fc.fillRect(x + ((x >> 3) % 3), y - (up ? 2 : 0) + (up ? 0 : 1), 3, 1);
    }
    this.propsLayer = renderProps(m);
    const { walls, glow } = renderWalls(m, SEWER_PAL);
    const wc = walls.getContext('2d');
    wc.fillStyle = '#05030a';                                             // el borde del mapa (la «valla» de la calle) aquí es roca negra
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) if (tx === 0 || ty === 0 || tx === m.w - 1 || ty === m.h - 1) wc.fillRect(tx * PX, ty * PX, PX, PX);
    for (const ty of [1, m.h - 2]) {                                      // tuberías a lo largo de las dos paredes largas, con juntas y válvulas
      for (let tx = 2; tx < m.w - 2; tx++) {
        const x0 = tx * PX, y0 = ty * PX + (ty === 1 ? 5 : 3);
        wc.fillStyle = '#140a08'; wc.fillRect(x0, y0 - 1, PX, 6);
        wc.fillStyle = '#7a4a2a'; wc.fillRect(x0, y0, PX, 4);                    // tubería oxidada
        wc.fillStyle = '#b8743c'; wc.fillRect(x0, y0, PX, 1);
        wc.fillStyle = '#3a2014'; wc.fillRect(x0, y0 + 3, PX, 1);
        if ((tx * 7 + ty) % 5 === 0) { wc.fillStyle = '#c2682a'; wc.fillRect(x0 + 3, y0 + 1, 2, 1); wc.fillRect(x0 + 10, y0 + 2, 1, 1); }
        if (tx % 6 === 2) { wc.fillStyle = '#3a2014'; wc.fillRect(x0 + 6, y0 - 2, 3, 8); wc.fillStyle = '#a8321e'; wc.fillRect(x0 + 5, y0 - 4, 5, 2); wc.fillStyle = '#d8582e'; wc.fillRect(x0 + 6, y0 - 4, 3, 1); } // válvula con rueda roja
        if (tx % 6 === 2 && ty === 1) { wc.fillStyle = '#2f6a35'; wc.fillRect(x0 + 7, y0 + 5, 1, 4); wc.fillStyle = '#6fb83a'; wc.fillRect(x0 + 7, y0 + 8, 1, 2); } // reguero de la gotera
      }
    }
    for (const ty of [1, m.h - 2]) {                                      // desagües con regueros de limo verde
      for (let tx = 5; tx < m.w - 3; tx += 7) {
        const x0 = tx * PX, y0 = ty * PX + (ty === 1 ? 6 : 1);
        wc.fillStyle = '#05100a'; wc.fillRect(x0 + 3, y0, 10, 6);
        wc.fillStyle = '#2a3a30'; for (let k = 0; k < 4; k++) wc.fillRect(x0 + 4 + k * 2, y0 + 1, 1, 4);
        wc.fillStyle = '#3f9a2a'; wc.fillRect(x0 + 6, y0 + 6, 3, ty === 1 ? 5 : 0);
        wc.fillStyle = '#7fcf3a'; wc.fillRect(x0 + 7, y0 + 6, 1, ty === 1 ? 7 : 0);
      }
    }
    paintStatics(fc, wc, m, this.amb.bodies);                              // rejillas, tapas, moho, bolsas rotas y rastros rojos del canal
    this.wallLayer = walls;
    this.glowLayer = glow;
    this.bloodLayer = document.createElement('canvas');
    this.bloodLayer.width = m.pixelW / WORLD_PX; this.bloodLayer.height = m.pixelH / WORLD_PX;
    this.bloodCtx = this.bloodLayer.getContext('2d'); this.bloodCtx.imageSmoothingEnabled = false;
    this.wallBloodLayer = document.createElement('canvas');
    this.wallBloodLayer.width = this.bloodLayer.width; this.wallBloodLayer.height = this.bloodLayer.height;
    this.wallBloodCtx = this.wallBloodLayer.getContext('2d'); this.wallBloodCtx.imageSmoothingEnabled = false;
  }

  update(dt, game) {
    this.clock += dt;
    const p = game.player;
    // Arma lanzada a los ojos: ciega al cocodrilo (la palanca más tiempo) y rebota. El cuerpo no sufre daño: es invulnerable.
    const c = this.croc;
    for (const w of game.pickups) {
      if (!w.flying || !w.hurts || !w.alive) continue;
      const h = c.head;
      if (Math.hypot(w.x - h.x, w.y - h.y) < EYE_R + w.r) {
        c.blind(w.type === 'crowbar' ? BLIND_CROWBAR : BLIND_OTHER, this, game);
        w.bounce();
      } else if (Math.hypot(w.x - c.x, w.y - c.y) < BODY_R + w.r) { w.bounce(); game.sfx.play('ricochet', 0.6); game.particles.sparks(w.x, w.y, Math.atan2(-w.vy, -w.vx), 5, 0.4); }
    }
    if (p.alive) c.update(dt, p, this, game);
    this.amb.update(dt, game);
    const l = this.map.ladder;
    this.nearLadder = p.alive && Math.hypot(p.x - l.x, p.y - l.y) < LADDER_REACH;
    // El cuerpo que devoraba el cocodrilo (con la máscara secreta de RICK): solo se puede registrar si el cocodrilo ya no está comiendo ni pegado a él (se fue a por ti, está ciego o aturdido).
    const body = this.amb.bodies.find((b) => b.feed);
    const away = c.mode !== 'feed' && (c.mode === 'blind' || c.mode === 'crash' || Math.hypot(c.x - body.x, c.y - body.y) > 75);
    this.lootNear = p.alive && !this.looted && away && Math.hypot(p.x - body.x, p.y - body.y) < 44;
    if (this.nearLadder && (game.keys.pressed('kick') || game.keys.pressed('execute'))) game.climbLadder();
    else if (this.lootNear && (game.keys.pressed('kick') || game.keys.pressed('execute'))) game.lootRick();
  }

  // Capas bajo los personajes: reflejos del agua y la luz que cae por el pozo de la escalera de subida.
  drawBelow(ctx) {
    ctx.fillStyle = '#9bff5a';
    ctx.globalAlpha = 0.45;
    for (const g of this.glints) if (Math.sin(this.clock * 2.4 + g.ph) > 0.55) pixelRect(ctx, g.x, g.y, 3, 1);
    ctx.globalAlpha = 1;
    this.amb.drawBelow(ctx, this.croc);
    this.amb.drawLight(ctx);
    const l = this.map.ladder;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffe08a';
    for (const [r, a] of [[26, 0.05], [18, 0.07], [11, 0.1]]) { ctx.globalAlpha = a + 0.015 * Math.sin(this.clock * 3); pixelDisc(ctx, l.x / WORLD_PX, l.y / WORLD_PX, r, WORLD_PX); }
    ctx.restore();
  }

  drawCroc(ctx) { this.croc.draw(ctx, this.clock); }
}
