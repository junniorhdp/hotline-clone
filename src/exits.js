import { TILE, isWallTile } from './map.js';

// Salida de la moto al acabar el piso (cinemática de fuga, ver Game.startLeaving / updateCine). La calle está rodeada de una valla, así que
// la moto ya no puede irse "a través" de ella: cada vez se elige AL AZAR (33 % cada una) una de tres salidas:
//   'gate'  PORTÓN: un sector de la valla sur se abre (dos hojas que se deslizan), la moto gira y cruza hacia la carretera de fuera.
//   'lane'  CARRIL LATERAL: la moto acelera en línea recta por el callejón despejado y sale por el extremo este de la calle (la valla se abre).
//   'jump'  SALTO: aparece una rampa improvisada pegada a la valla sur y la moto vuela por encima de ella (con sacudida, chispas y cartel).
// Todo es visual (la cinemática no usa colisiones): `place()` coloca la moto sobre una trayectoria precalculada con un perfil de aceleración,
// `drawRoad()` pinta la carretera de fuera (y la rampa) y `drawOver()` lo que va ENCIMA de la valla (portón, abertura). La cámara amplía sus límites
// EXIT_EXTRA unidades en la dirección de la salida para poder seguir a la moto fuera del mapa.
export const EXIT_KINDS = ['gate', 'lane', 'jump'];
export const EXIT_EXTRA = 340;

const RADIUS = 44;          // radio de la curva al girar hacia el sur
const GATE_W = 3;           // casillas de ancho del portón
const JUMP_HEIGHT = 80;     // altura máxima del salto (unidades)
const JUMP_FLIGHT = 210;    // distancia recorrida en el aire
const RAMP_LEN = 64, RAMP_W = 56;
const ASPHALT = '#14111f', FENCE = '#15111f', BAR = '#3e3960', RAIL = '#2c2840';

const R = (ctx, c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

// Trayectoria: polilínea con las esquinas suavizadas (curva de Bézier cuadrática) y longitud acumulada.
function buildPath(points, radius) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], a = points[i - 1], c = points[i + 1];
    const din = Math.hypot(p[0] - a[0], p[1] - a[1]), dout = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const rin = Math.min(radius, din / 2), rout = Math.min(radius, dout / 2);
    const A = [p[0] + ((a[0] - p[0]) / din) * rin, p[1] + ((a[1] - p[1]) / din) * rin];
    const B = [p[0] + ((c[0] - p[0]) / dout) * rout, p[1] + ((c[1] - p[1]) / dout) * rout];
    out.push(A);
    for (let k = 1; k < 8; k++) {
      const t = k / 8, u = 1 - t;
      out.push([u * u * A[0] + 2 * u * t * p[0] + t * t * B[0], u * u * A[1] + 2 * u * t * p[1] + t * t * B[1]]);
    }
    out.push(B);
  }
  out.push(points[points.length - 1]);
  const pts = []; let s = 0;
  out.forEach((q, i) => { if (i) s += Math.hypot(q[0] - out[i - 1][0], q[1] - out[i - 1][1]); pts.push({ x: q[0], y: q[1], s }); });
  return { pts, length: s };
}

export class BikeExit {
  // Elige una de las tres salidas con la misma probabilidad; si la elegida no cabe (sin columna libre al sur), sale por el carril lateral.
  static random(game) {
    const e = new BikeExit(EXIT_KINDS[Math.floor(Math.random() * EXIT_KINDS.length)], game);
    return e.ok ? e : new BikeExit('lane', game);
  }

  constructor(kind, game) {
    const m = game.map, b = game.bike;
    this.kind = kind;
    this.W = m.pixelW; this.H = m.pixelH;
    this.rowT = Math.floor(b.park.y / TILE);   // fila de la moto (primera de asfalto)
    this.rowE = m.h - 2;                       // última fila de calle (junto a la valla sur)
    this.x0 = b.park.x; this.y0 = b.park.y;
    this.tx0 = Math.floor(b.park.x / TILE);
    this.ok = true;
    this.fired = {};
    this.open = 0;                             // 0..1: portón abierto / abertura visible / rampa en pie
    const free = (tx, ty) => !isWallTile(m, tx, ty);
    if (kind === 'lane') {
      const clear = (r) => { for (let tx = this.tx0 + 2; tx < m.w - 1; tx++) if (!free(tx, r)) return false; return true; };
      let row = this.rowT;
      if (!clear(row)) { for (let r = this.rowT + 1; r <= this.rowE; r++) if (clear(r)) { row = r; break; } }
      this.laneRow = row;
      const y = row * TILE + TILE / 2;
      const pts = row === this.rowT ? [[this.x0, this.y0], [this.W + 160, this.y0]] : [[this.x0, this.y0], [this.x0 + 110, y], [this.W + 160, y]];
      this.path = buildPath(pts, 40);
      this.dur = 1.35;
    } else {
      // Columna al este con la fila de la moto y la columna hasta la valla despejadas (y, para el salto, sitio para la rampa).
      let gx = null;
      for (let tx = this.tx0 + 3; tx <= m.w - 5 && gx === null; tx++) {
        let ok = true;
        for (let ty = this.rowT; ty <= this.rowE && ok; ty++) if (!free(tx, ty)) ok = false;
        for (let t = this.tx0 + 1; t <= tx && ok; t++) if (!free(t, this.rowT)) ok = false;
        if (kind === 'jump') for (let dx = -1; dx <= 1 && ok; dx++) for (let ty = this.rowE - 2; ty <= this.rowE && ok; ty++) if (!free(tx + dx, ty)) ok = false;
        if (ok) gx = tx;
      }
      if (gx === null) { this.ok = false; return; }
      this.gx = gx;
      this.cx = gx * TILE + TILE / 2;
      this.path = buildPath([[this.x0, this.y0], [this.cx, this.y0], [this.cx, this.H + EXIT_EXTRA * 0.85]], RADIUS);
      this.dur = 2.3;
    }
    this.length = this.path.length;
    if (kind === 'jump') {
      // El despegue es donde la trayectoria llega al borde de la rampa (a un tile de la valla sur): bisección sobre la trayectoria.
      const yF = this.H - TILE - 16;
      let lo = 0, hi = this.length;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (this.at(mid).y >= yF) hi = mid; else lo = mid; }
      this.sF = hi;
    }
  }

  // Posición sobre la trayectoria a `s` unidades del inicio.
  at(s) {
    const pts = this.path.pts;
    if (s >= this.length) { const a = pts[pts.length - 2], b = pts[pts.length - 1]; return { x: b.x, y: b.y, a: Math.atan2(b.y - a.y, b.x - a.x) }; }
    let i = 1;
    while (i < pts.length - 1 && pts[i].s < s) i++;
    const a = pts[i - 1], b = pts[i], k = (s - a.s) / Math.max(0.0001, b.s - a.s);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  // Coloca la moto (`bike`: x, y, angle, z = altura del salto, sc = tamaño) `t2` segundos después de montarse. Perfil de aceleración
  // constante: la distancia crece con el cuadrado del tiempo y llega al final justo cuando acaba la cinemática.
  place(t2, bike, game) {
    const s = this.length * Math.min(1, (t2 / this.dur) ** 2);
    const q = this.at(s);
    bike.x = q.x; bike.y = q.y; bike.angle = q.a; bike.z = 0; bike.sc = 1;
    if (this.kind === 'jump') {
      const u = (s - this.sF) / JUMP_FLIGHT;
      if (u > 0 && u < 1) {
        bike.z = JUMP_HEIGHT * 4 * u * (1 - u);
        bike.sc = 1 + 0.5 * Math.sin(Math.PI * u);
        bike.angle += Math.sin(u * Math.PI * 2) * 0.3;   // se balancea en el aire
        if (!this.fired.takeoff) {
          this.fired.takeoff = true;
          game.addFloat(q.x, q.y - 90, '¡SALTO ÉPICO!', '#ffbe0b', 2, 1.6);
          game.camera.addShake(10);
          game.fx.kick(0.6);
          game.particles.neon(q.x, q.y, q.a + Math.PI, 14, 0.8);
        }
      }
    }
    // Apertura del portón / aparición de la rampa y de la abertura: animación por tiempo, con su sonido y polvo.
    const k = Math.min(1, Math.max(0, (t2 - 0.1) / 0.5));
    this.open = k;
    if (k > 0 && !this.fired.start) {
      this.fired.start = true;
      if (this.kind === 'gate') game.sfx.play('unlock');
      else if (this.kind === 'jump') { game.sfx.play('knock'); game.camera.addShake(3); game.particles.dust(this.cx, this.H - TILE - 40, 12); }
      else game.sfx.play('unlock', 0.6);
    }
  }

  // --- Dibujo (en coordenadas del mundo) -------------------------------------------------------

  // Carretera de fuera del mapa (bajo la moto) y la rampa del salto.
  drawRoad(ctx) {
    const W = this.W, H = this.H;
    if (this.kind === 'lane') {
      const y0 = this.rowT * TILE, y1 = (this.rowE + 1) * TILE, w = EXIT_EXTRA;
      R(ctx, ASPHALT, W, y0, w, y1 - y0);
      for (let x = W + 8; x < W + w; x += 64) R(ctx, '#a89420', x, (y0 + y1) / 2 - 2, 32, 4);
      // paredes del callejón arriba y abajo, con su tubo de neón
      R(ctx, '#2a0d3a', W, y0 - 96, w, 96); R(ctx, '#ff2a85', W, y0 - 2, w, 2);
      R(ctx, '#2a0d3a', W, y1, w, 96); R(ctx, '#ff2a85', W, y1, w, 2);
      return;
    }
    const w = W;
    R(ctx, '#3a3552', 0, H, w, 22);                       // acera
    R(ctx, '#26223a', 0, H + 20, w, 2);
    R(ctx, ASPHALT, 0, H + 22, w, EXIT_EXTRA - 22);        // carretera
    for (let x = 16; x < w; x += 96) R(ctx, '#a89420', x, H + 150, 48, 4);
    for (let x = 40; x < w; x += 70) { R(ctx, '#1b1729', x, H + 60 + ((x * 7) % 90), 6, 2); R(ctx, '#0d0a16', x + 20, H + 90 + ((x * 13) % 120), 8, 2); }
    if (this.kind === 'jump') this.drawRamp(ctx);
  }

  // Rampa improvisada: cae desde arriba al empezar (se encoge desde el cielo), con tablones sobre cajas y un borde de aviso.
  drawRamp(ctx) {
    const k = this.open;
    if (k <= 0) return;
    const yEnd = this.H - TILE - 16, cx = this.cx;
    const yOff = (1 - k) * -90, a = k;
    ctx.save();
    ctx.globalAlpha = a;
    const x0 = cx - RAMP_W / 2, y0 = yEnd - RAMP_LEN + yOff;
    R(ctx, 'rgba(5,0,15,0.5)', x0 + 4, y0 + 6, RAMP_W, RAMP_LEN);                    // sombra
    R(ctx, '#3a2412', x0 - 2, y0, RAMP_W + 4, 14);                                   // cajas de apoyo
    R(ctx, '#6b4428', x0, y0 + 2, RAMP_W / 2 - 2, 12); R(ctx, '#6b4428', cx + 2, y0 + 2, RAMP_W / 2 - 2, 12);
    R(ctx, '#8a5a34', x0, y0 + 2, RAMP_W / 2 - 2, 3); R(ctx, '#8a5a34', cx + 2, y0 + 2, RAMP_W / 2 - 2, 3);
    // plano inclinado: tablones cada vez más claros hacia el borde de despegue
    for (let i = 0; i < 8; i++) {
      const y = y0 + 14 + i * ((RAMP_LEN - 14) / 8), shade = ['#4a2e1a', '#5a3820', '#6b4428', '#7a4e2e', '#8a5a34', '#9a6a40', '#aa7a4a', '#c9a066'][i];
      R(ctx, shade, x0, y, RAMP_W, (RAMP_LEN - 14) / 8 + 1);
      R(ctx, '#2c1a0e', x0, y + (RAMP_LEN - 14) / 8, RAMP_W, 1);
    }
    for (let i = 0; i < 6; i++) { R(ctx, i % 2 ? '#140a24' : '#ffbe0b', x0 - 3, y0 + 14 + i * 8, 3, 8); R(ctx, i % 2 ? '#140a24' : '#ffbe0b', x0 + RAMP_W, y0 + 14 + i * 8, 3, 8); } // franjas de aviso
    ctx.restore();
  }

  // Lo que va ENCIMA de la valla: las hojas del portón que se deslizan y la abertura (o el hueco del carril).
  drawOver(ctx) {
    const H = this.H, W = this.W, k = this.open;
    if (this.kind === 'gate') {
      const cx = this.cx, y = H - TILE, half = (GATE_W * TILE) / 2, ow = GATE_W * TILE * k;
      R(ctx, ASPHALT, cx - ow / 2, y, ow, TILE);                                       // el hueco que deja el portón
      const leaf = (x) => {                                                            // hoja de reja
        R(ctx, FENCE, x, y, half, TILE); R(ctx, RAIL, x, y + 4, half, 2); R(ctx, RAIL, x, y + TILE - 8, half, 2);
        for (let i = 3; i < half; i += 6) R(ctx, BAR, x + i, y, 2, TILE);
        R(ctx, '#0a0812', x, y + TILE - 2, half, 2);
      };
      leaf(cx - ow / 2 - half); leaf(cx + ow / 2);
      if (k > 0 && k < 1 && Math.floor(performance.now() / 120) % 2) { R(ctx, '#ff7a1a', cx - ow / 2 - 3, y - 6, 6, 6); R(ctx, '#ff7a1a', cx + ow / 2 - 3, y - 6, 6, 6); } // luces de aviso
    } else if (this.kind === 'lane') {
      const y0 = this.rowT * TILE, h = (this.rowE + 1 - this.rowT) * TILE;
      ctx.save();
      ctx.globalAlpha = k;
      R(ctx, ASPHALT, W - TILE, y0, TILE, h);                                          // la valla se abre: el callejón
      R(ctx, '#a89420', W - TILE + 8, y0 + h / 2 - 2, 24, 4);
      R(ctx, BAR, W - TILE, y0 - 6, TILE, 6); R(ctx, BAR, W - TILE, y0 + h, TILE, 6);   // postes a los lados
      ctx.restore();
    }
  }

  // La entrada de la moto (llegada): la valla del extremo oeste de la calle se abre un momento para que pase.
  static drawArrivalGap(ctx, game) {
    const m = game.map, b = game.bike;
    const rowT = Math.floor(b.park.y / TILE), rowE = m.h - 2, y0 = rowT * TILE, h = (rowE + 1 - rowT) * TILE;
    R(ctx, ASPHALT, 0, y0, TILE, h);
    R(ctx, '#a89420', 8, y0 + h / 2 - 2, 24, 4);
    R(ctx, BAR, 0, y0 - 6, TILE, 6); R(ctx, BAR, 0, y0 + h, TILE, 6);
  }
}

