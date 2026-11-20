import { LEVELS, loadLevel, isWallTile, isStructuralWall } from './map.js';
import { drawText, measureText, CELL_H } from './pixelfont.js';
import { drawTouchButton } from './touch.js';
import { COLORS, clamp } from './utils.js';
import { prologueSeen } from './prologue.js';
import { MASKS, maskIcon } from './masks.js';

// Menú principal estilo arcade. Vive en `game.state === 'menu'` con tres subpantallas:
//   'title'   logo + JUGAR / SELECCIONAR PISO / RÉCORDS / OPCIONES (modal de options-menu.js)
//   'floors'  tarjetas de pisos con miniatura, récord y rango (bloqueados hasta completar el anterior)
//   'records' Top 5 histórico
// Los cambios de pantalla pasan por `game.transition()` (fundido).
// El CAMPO DE PRUEBAS (testrange.js) es EXCLUSIVO DEL EQUIPO: no tiene opción en el título (ni en la versión publicada ni en desarrollo); se abre solo con `npm run dev` (ver main.js).
const TITLE_OPTIONS = [
  { label: 'JUGAR', action: (g) => g.transition(() => g.startRunAt(0, !prologueSeen())) }, // la primera vez, el prólogo
  { label: 'PRÓLOGO', action: (g) => g.transition(() => g.startRunAt(0, true)) },
  { label: 'SELECCIONAR PISO', action: (g) => g.transition(() => g.menu.open('floors'), 0.15) },
  { label: 'RÉCORDS', action: (g) => g.transition(() => g.menu.open('records'), 0.15) },
  { label: 'OPCIONES', action: (g) => g.openOptions() },
];
const RANK_COLORS = { S: COLORS.player, A: COLORS.weapon, B: COLORS.enemy, C: COLORS.blood };
const DIM = '#7d6f98';
/* global __APP_VERSION__ */
// Lo define vite.config.js en el build (commit publicado o "dev").
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
// iPhone/iPad (incluido el iPad que se presenta como Mac con pantalla táctil).
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// --- Utilidades del fondo animado -----------------------------------------------------------------------------------------------------------------------------------------
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (a, b, k) => { const A = hexRGB(a), B = hexRGB(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
function seeded(seed) { let t = seed >>> 0; return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
const NEONS = ['#05d9e8', '#ff2a85', '#ffbe0b', '#b45cff'];
const BEAT = 2.5;   // pulso a 150 BPM (el de la música de combate): el fondo late a su ritmo
const PAD = 48;     // margen de las capas del fondo para el parallax

// Miniatura de un piso: 1 píxel por casilla (paredes neón, puertas, salida y enemigos).
const thumbs = new Map();
function floorThumb(index) {
  if (thumbs.has(index)) return thumbs.get(index);
  const L = loadLevel(index);
  const { map } = L;
  const c = document.createElement('canvas');
  c.width = map.w;
  c.height = map.h;
  const ctx = c.getContext('2d');
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      // Paredes en neón; muebles sólidos en tono apagado.
      ctx.fillStyle = isStructuralWall(map, tx, ty) ? COLORS.wall : isWallTile(map, tx, ty) ? '#4a3a66' : '#1c0c33';
      ctx.fillRect(tx, ty, 1, 1);
    }
  }
  const dot = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(Math.floor(x / 32), Math.floor(y / 32), 1, 1); };
  for (const d of L.doors) { ctx.fillStyle = COLORS.door; ctx.fillRect(d.tx, d.ty, 1, 1); }
  for (const e of L.enemies) dot(e.x, e.y, COLORS.enemy);
  dot(L.player.x, L.player.y, COLORS.player);
  dot(L.bike.x, L.bike.y, COLORS.debug);
  const info = { canvas: c, enemies: L.enemies.length, armed: L.enemies.filter((e) => e.armed).length };
  thumbs.set(index, info);
  return info;
}

export class Menu {
  constructor(game) {
    this.game = game;
    this.screen = 'title';
    this.index = 0;
    this.floorIndex = 0;
    this.mouse = { x: 0, y: 0 };
    this.enterAt = performance.now() / 1000; // para la entrada escalonada del título
    this.hot = TITLE_OPTIONS.map(() => 0);   // 0..1 por opción: cuánto está resaltada (transición suave)
    this.press = TITLE_OPTIONS.map(() => 0); // destello al pulsar
    this.par = 0;                            // parallax suavizado (-1..1)
    this.sceneCache = null;
  }

  open(screen = 'title') {
    this.screen = screen;
    if (screen === 'title') { this.index = 0; this.enterAt = performance.now() / 1000; this.hot.fill(0); this.press.fill(0); }
    if (screen === 'floors') { this.floorIndex = 0; this.floorFirst = null; }
    // Solo un movimiento real del ratón cambia la selección.
    this.mouse = this.game.mouseInternal();
  }

  // --- Entrada ---------------------------------------------------------------------------

  update() {
    const g = this.game, input = g.input;
    const confirm = input.wasPressed('Enter') || input.wasPressed('Space') || input.wasPressed('NumpadEnter');
    const back = input.wasPressed('Escape') || input.wasPressed('Backspace');
    const m = g.mouseInternal();
    const moved = Math.hypot(m.x - this.mouse.x, m.y - this.mouse.y) > 0.5;
    this.mouse = m;
    const inside = (r) => r && m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h;

    if (this.screen === 'title') {
      const n = TITLE_OPTIONS.length, prev = this.index;
      if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.index = (this.index + n - 1) % n;
      if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.index = (this.index + 1) % n;
      const rects = this.titleLayout().options;
      const hovered = rects.findIndex(inside);
      if (hovered >= 0 && moved) this.index = hovered;
      if (this.index !== prev) g.sfx.play('empty');
      for (let i = 0; i < n; i++) { this.hot[i] += ((i === this.index ? 1 : 0) - this.hot[i]) * 0.28; this.press[i] = Math.max(0, this.press[i] - 1 / 60); }
      const tgt = input.touchMode ? Math.sin(performance.now() / 1000 * 0.25) * 0.9 : clamp((m.x / g.scene.width - 0.5) * 2, -1, 1); // PC: parallax con el cursor; móvil: deriva ambiental suave
      this.par += (tgt - this.par) * 0.05;
      if (confirm || (input.mousePressed.left && hovered >= 0)) {
        if (input.mousePressed.left && hovered >= 0) this.index = hovered;
        this.press[this.index] = 0.2; this.hot[this.index] = 1;
        g.sfx.play('pickup');
        TITLE_OPTIONS[this.index].action(g);
      }
      return;
    }

    // Botón VOLVER táctil del selector de pisos = Esc.
    const tappedBack = input.mousePressed.left && inside(this.backRect());
    if (back || tappedBack) {
      g.sfx.play('empty');
      g.transition(() => this.open('title'), 0.15);
      return;
    }

    if (this.screen === 'floors') {
      const n = LEVELS.length, prev = this.floorIndex;
      if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) this.floorIndex = (this.floorIndex + n - 1) % n;
      if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) this.floorIndex = (this.floorIndex + 1) % n;
      const cards = this.floorsLayout().cards;
      const hovered = cards.findIndex(inside);
      // Con ratón solo cuenta si se ha movido (hover); con un TOQUE siempre: al tocar la tarjeta del borde la ventana se desplaza y la de debajo del dedo pasa a ser otro piso,
      // así que el siguiente toque cae en el MISMO punto de la pantalla y, sin esto, se ignoraba (no se podía avanzar más allá de los primeros pisos).
      if (hovered >= 0 && (moved || (input.touchMode && input.mousePressed.left))) this.floorIndex = hovered;
      // Tocar los bordes (donde están las flechas < >) desplaza la selección cuando hay más pisos fuera de la ventana.
      if (input.mousePressed.left && hovered < 0) {
        if (m.x < 26 && this.floorIndex > 0) this.floorIndex--;
        else if (m.x > g.scene.width - 26 && this.floorIndex < n - 1) this.floorIndex++;
      }
      if (this.floorIndex !== prev) g.sfx.play('empty');
      // En táctil, el primer toque en un piso solo lo elige; tocar el ya elegido empieza.
      if (input.touchMode && input.mousePressed.left && hovered >= 0 && hovered !== prev) return;
      if (confirm || (input.mousePressed.left && hovered >= 0)) {
        if (input.mousePressed.left && hovered >= 0) this.floorIndex = hovered;
        if (g.floorStats.isUnlocked(this.floorIndex + 1)) {
          g.sfx.play('pickup');
          const index = this.floorIndex;
          g.transition(() => g.startRunAt(index));
        } else {
          g.sfx.play('empty');
          g.camera.addShake(2);
        }
      }
      return;
    }

    // Tocar en cualquier sitio también vuelve (en táctil no hay tecla Esc).
    if (this.screen === 'records' && (confirm || input.mousePressed.left)) g.transition(() => this.open('title'), 0.15);
  }

  // --- Layouts compartidos por dibujo y ratón -------------------------------------------

  // Botón VOLVER del selector de pisos (solo en táctil; con teclado se usa Esc).
  backRect() {
    const g = this.game;
    if (this.screen !== 'floors' || !g.input.touchMode) return null;
    return { id: 'back', label: 'VOLVER', x: 6 + g.safe.l, y: 6 + g.safe.t, ...g.touch.buttonSize('VOLVER') };
  }

  // Botón PANTALLA COMPLETA del título (si el navegador lo permite; en iPhone no existe).
  // Lo atiende game.onPointerUp porque la petición debe hacerse dentro del evento del usuario.
  fullscreenRect() {
    const g = this.game;
    if (this.screen !== 'title' || !document.fullscreenEnabled || document.fullscreenElement) return null;
    const label = 'PANTALLA COMPLETA';
    const size = g.input.touchMode ? g.touch.buttonSize(label) : { w: measureText(label) + 12, h: 15 };
    return { id: 'fullscreen', label, x: g.scene.width - 6 - g.safe.r - size.w, y: 6 + g.safe.t, ...size };
  }

  // Colocación del título (la usan el dibujo y el ratón/toque): logo y lema bajo la fila de arriba (versión y pantalla completa), opciones con altura propia por fila (nunca se encimen:
  // el texto cabe siempre en su fila) y margen inferior para las ayudas. En pantallas bajas se reduce el logo antes de apretar las filas.
  titleLayout() {
    const g = this.game, { width: w, height: h } = g.scene, sf = g.safe, n = TITLE_OPTIONS.length, touch = g.input.touchMode;
    const fs = this.fullscreenRect();
    const topRow = 6 + sf.t + (fs ? fs.h : 9) + 4;
    const iphone = touch && IS_IOS;
    const bottom = 18 + sf.b + (iphone ? 11 : 0);
    let logoScale = g.fitScale('NEON RUSH', w - 16, 5);
    const tagH = 9, gap1 = 4, gap2 = 8;
    let avail;
    for (;;) {
      avail = h - bottom - (topRow + CELL_H * logoScale + gap1 + tagH + gap2);
      if (avail >= n * 12 || logoScale <= 2) break;
      logoScale--;
    }
    const ideal = touch ? Math.max(22, Math.round(g.touch.px(38))) : 22;
    const step = clamp(Math.floor(avail / n), 11, ideal);
    const textScale = step >= 20 ? 2 : 1;
    const extra = Math.max(0, avail - step * n);
    const logoY = topRow + Math.round(Math.min(extra * 0.3, 60));
    const optTop = logoY + CELL_H * logoScale + gap1 + tagH + gap2 + Math.round(Math.min(extra * 0.35, 40));
    const rw = Math.min(w - 12, 236), rx = Math.round(w / 2 - rw / 2);
    const options = TITLE_OPTIONS.map((o, i) => ({ x: rx, y: optTop + i * step, w: rw, h: step }));
    return { options, step, textScale, logoScale, logoY, topRow, optTop };
  }

  floorsLayout() {
    const { width: w } = this.game.scene;
    const n = LEVELS.length, gap = 8;
    // Con muchos pisos no caben todas las tarjetas: se muestra una ventana que sigue a la selección
    // (flechas `<` / `>` en los bordes cuando hay más a un lado).
    const perPage = Math.max(1, Math.min(n, Math.floor((w - 16 + gap) / (70 + gap))));
    const cardW = clamp(Math.floor((w - 16 - gap * (perPage - 1)) / perPage), 70, 150);
    // La ventana de tarjetas NO se recentra en cada selección (antes, al pasar el ratón o tocar una tarjeta la ventana se desplazaba y la tarjeta se iba de debajo del dedo /
    // cursor: no se podía elegir, p. ej., el piso 6): solo se desplaza cuando la selección sale de lo visible (flechas, bordes o teclado).
    let first = this.floorFirst == null ? clamp(this.floorIndex - Math.floor(perPage / 2), 0, n - perPage) : clamp(this.floorFirst, 0, n - perPage);
    if (this.floorIndex < first) first = this.floorIndex;
    else if (this.floorIndex >= first + perPage) first = this.floorIndex - perPage + 1;
    this.floorFirst = first;
    const maxMapW = Math.max(...LEVELS.map((l) => l.rows[0].length));
    const maxMapH = Math.max(...LEVELS.map((l) => l.rows.length));
    const thumbScale = clamp(Math.floor((cardW - 10) / maxMapW), 1, 3);
    const cardH = 8 + maxMapH * thumbScale + 6 + 6 * 11; // 6 líneas: piso, sala, enemigos, armados, rango, puntos
    const x0 = Math.round((w - (perPage * cardW + (perPage - 1) * gap)) / 2);
    const cards = LEVELS.map((_, i) => (i >= first && i < first + perPage
      ? { x: x0 + (i - first) * (cardW + gap), y: 30, w: cardW, h: cardH } : null));
    return { cards, thumbScale, bottom: 30 + cardH, first, perPage };
  }

  // --- Dibujo ------------------------------------------------------------------------------

  draw(ctx, w, h) {
    const now = performance.now() / 1000;
    this.drawScene(ctx, w, h, now, this.screen !== 'title');
    if (this.screen === 'title') this.drawTitle(ctx, w, h, now);
    else if (this.screen === 'floors') this.drawFloors(ctx, w, h);
    else this.drawRecords(ctx, w, h);
  }

  // Capas estáticas del fondo (se hornean una vez por tamaño de pantalla): skyline lejano, skyline cercano con carteles de neón y calle mojada con sus reflejos.
  buildScene(w, h) {
    const key = `${w}x${h}`;
    if (this.sceneCache && this.sceneCache.key === key) return this.sceneCache;
    const gy = Math.round(h * 0.68), W = w + PAD * 2;
    const make = (cw, ch) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; };
    const [far, fx] = make(W, h), [near, nx] = make(W, h), [ground, gx] = make(W, h);
    const blinks = [], signs = [];
    let r = seeded(11);
    // Skyline lejano: siluetas violeta oscuras con ventanas tenues y antenas con piloto.
    for (let x = 0; x < W;) {
      const bw = 12 + Math.floor(r() * 20), bh = Math.floor(h * (0.14 + r() * 0.26));
      fx.fillStyle = '#170a33'; fx.fillRect(x, gy - bh, bw, bh);
      fx.fillStyle = '#2d1560'; fx.fillRect(x + bw - 1, gy - bh, 1, bh); fx.fillRect(x, gy - bh, bw, 1);
      for (let wy = gy - bh + 4; wy < gy - 4; wy += 4) for (let wx = x + 2; wx < x + bw - 3; wx += 4) {
        const q = r();
        if (q < 0.16) { fx.fillStyle = ['#0a6e78', '#8a1a4e', '#8a6a0a'][Math.floor(r() * 3)]; fx.fillRect(wx, wy, 2, 2); }
        else if (q < 0.5) { fx.fillStyle = '#211046'; fx.fillRect(wx, wy, 2, 2); }
      }
      if (r() < 0.3) { const ax = x + 2 + Math.floor(r() * (bw - 4)); fx.fillStyle = '#2d1560'; fx.fillRect(ax, gy - bh - 6, 1, 6); blinks.push({ layer: 0, x: ax, y: gy - bh - 7, ph: r() * 6 }); }
      x += bw + Math.floor(r() * 4);
    }
    // Skyline cercano: más alto y oscuro, con filo de neón arriba y carteles verticales que laten.
    r = seeded(23);
    for (let x = 0; x < W;) {
      const bw = 20 + Math.floor(r() * 24), bh = Math.floor(h * (0.26 + r() * 0.28));
      nx.fillStyle = '#0a041c'; nx.fillRect(x, gy - bh, bw, bh);
      nx.fillStyle = '#1b0b3a'; nx.fillRect(x, gy - bh, 1, bh);
      const acc = NEONS[Math.floor(r() * NEONS.length)];
      if (r() < 0.45) { nx.fillStyle = mixHex('#0a041c', acc, 0.7); nx.fillRect(x, gy - bh, bw, 1); }
      for (let wy = gy - bh + 5; wy < gy - 6; wy += 6) for (let wx = x + 3; wx < x + bw - 4; wx += 6) {
        if (r() < 0.13) { nx.fillStyle = mixHex('#0a041c', '#ffbe0b', 0.55); nx.fillRect(wx, wy, 3, 3); }
        else if (r() < 0.25) { nx.fillStyle = '#120629'; nx.fillRect(wx, wy, 3, 3); }
      }
      if (r() < 0.55) {
        const sh = 8 + Math.floor(r() * 18), sx = x + 3 + Math.floor(r() * Math.max(1, bw - 9)), sy = gy - bh + 6 + Math.floor(r() * Math.max(1, bh * 0.4));
        signs.push({ x: sx, y: sy, w: 3, h: Math.min(sh, gy - sy - 6), c: NEONS[Math.floor(r() * NEONS.length)], ph: r() * 6 });
      }
      x += bw + 1 + Math.floor(r() * 5);
    }
    // Calle mojada: asfalto oscuro, reflejos de los carteles que se desvanecen hacia abajo y brillos horizontales.
    gx.fillStyle = '#07021a'; gx.fillRect(0, gy, W, h - gy);
    gx.fillStyle = '#1d0c40'; gx.fillRect(0, gy, W, 1);
    const depth = h - gy;
    for (const sg of signs) {
      gx.fillStyle = sg.c;
      for (let i = 1; i < depth; i++) { gx.globalAlpha = 0.28 * (1 - i / depth); gx.fillRect(sg.x - 1, gy + i, sg.w + 2, 1); }
    }
    gx.globalAlpha = 1;
    r = seeded(5);
    for (let i = 0; i < 26; i++) { gx.globalAlpha = 0.05 + r() * 0.07; gx.fillStyle = NEONS[Math.floor(r() * 3)]; gx.fillRect(Math.floor(r() * W), gy + 2 + Math.floor(r() * (depth - 3)), 6 + Math.floor(r() * 24), 1); }
    gx.globalAlpha = 1;
    this.sceneCache = { key, gy, far, near, ground, blinks, signs };
    return this.sceneCache;
  }

  // Fondo vivo de NEON RUSH: noche urbana tomada por la mafia. Capas con parallax (cursor en PC, deriva suave en móvil), faros de búsqueda, una máscara gigante que se desvanece y se
  // glitchea, carteles de neón que laten al ritmo de la música, ceniza y chispas flotando y la calle mojada con sus reflejos. `dim`: oscurecido para las pantallas de pisos y récords.
  drawScene(ctx, w, h, now, dim) {
    const S = this.buildScene(w, h), gy = S.gy, cx = Math.round(w / 2);
    const par = this.par * 12, pulse = 0.5 + 0.5 * Math.sin(now * Math.PI * 2 * BEAT);
    // Cielo: bandas de 3 px del violeta oscuro al magenta del horizonte.
    for (let y = 0; y < gy; y += 3) {
      const k = y / gy;
      ctx.fillStyle = k > 0.8 ? mixHex('#4a0f5c', '#b01c68', (k - 0.8) / 0.2) : mixHex('#080219', '#4a0f5c', Math.pow(k / 0.8, 1.7));
      ctx.fillRect(0, y, w, 3);
    }
    // Máscara gigante de fondo (cambia cada 7 s con un fundido y un tirón de glitch).
    const list = MASKS.filter((m) => !m.secret), per = 7, mi = Math.floor(now / per) % list.length, ph = (now % per) / per;
    const wide = w >= 380, cs = Math.max(2, Math.floor(Math.min(h * 0.34, w * (wide ? 0.3 : 0.5)) / 12));
    const mx = Math.round((wide ? w * 0.77 : cx) - 6 * cs + par * 0.3), my = Math.round(gy * (wide ? 0.46 : 0.4) - 6 * cs);
    const fade = Math.pow(Math.sin(Math.PI * ph), 0.7) * (wide ? 0.16 : 0.09), glitch = ph < 0.05 || ph > 0.95;
    ctx.save();
    ctx.globalAlpha = fade;
    const icon = maskIcon(list[mi]);
    if (glitch) { for (let row = 0; row < 12; row++) { const off = Math.round((Math.sin(now * 90 + row * 7) * 0.5) * cs * 2); ctx.drawImage(icon, 0, row, 12, 1, mx + off, my + row * cs, 12 * cs, cs); } }
    else ctx.drawImage(icon, mx, my, 12 * cs, 12 * cs);
    ctx.restore();
    // Faros de búsqueda: dos haces que barren el cielo.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    [[0.22, '#05d9e8', 0], [0.82, '#ff2a85', 2.4]].forEach(([fx, col, off]) => {
      ctx.fillStyle = col;
      const bx = w * fx, sw = Math.sin(now * 0.35 + off) * 0.9;
      for (let y = gy; y > 0; y -= 1) { const t = gy - y, xc = bx + sw * t * 0.55, half = 1 + t * 0.045; ctx.globalAlpha = 0.07 * (1 - t / gy); ctx.fillRect(Math.round(xc - half), y, Math.round(half * 2), 1); }
    });
    ctx.restore();
    // Capas: lejos, cerca y calle (cada una con su parallax).
    ctx.drawImage(S.far, Math.round(-PAD + par * 0.35), 0);
    for (const b of S.blinks) if (Math.sin(now * 3 + b.ph) > 0.3) { ctx.fillStyle = '#ff2a4a'; ctx.fillRect(Math.round(b.x - PAD + par * 0.35), b.y, 1, 1); }
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.09 + 0.04 * pulse; ctx.fillStyle = '#ff2a85'; ctx.fillRect(0, gy - 22, w, 22); ctx.restore(); // neblina rosa en el horizonte
    const nOff = Math.round(-PAD + par * 0.75);
    ctx.drawImage(S.near, nOff, 0);
    ctx.drawImage(S.ground, Math.round(-PAD + par * 0.9), 0);
    // Carteles de neón: laten con el pulso y de vez en cuando uno parpadea; halo aditivo.
    ctx.save();
    for (const sg of S.signs) {
      const on = Math.sin(now * 1.7 + sg.ph * 9) > -0.93 ? 1 : 0, a = (0.6 + 0.35 * Math.sin(now * Math.PI * 2 * BEAT + sg.ph)) * on, X = Math.round(sg.x + nOff);
      ctx.globalAlpha = a; ctx.fillStyle = sg.c; ctx.fillRect(X, sg.y, sg.w, sg.h);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.16; ctx.fillRect(X - 2, sg.y - 1, sg.w + 4, sg.h + 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    // Carriles: rayas que se desplazan (dos filas, la de abajo más rápida).
    ctx.fillStyle = '#3a2a66';
    for (const [fy, len, gap, sp] of [[0.42, 8, 16, 22], [0.8, 14, 26, 48]]) {
      const y = gy + Math.round((h - gy) * fy), period = len + gap, off = Math.floor((now * sp) % period);
      for (let x = -period + off; x < w; x += period) ctx.fillRect(x, y, len, 1);
    }
    // Ceniza y chispas que suben (determinista por índice y tiempo).
    const N = clamp(Math.floor(w / 6), 28, 90);
    for (let i = 0; i < N; i++) {
      const sd = i * 0.6180339, bx = (sd % 1) * w, spd = 6 + ((i * 37) % 17), y = h - ((now * spd + (i * 53) % h) % h), x = Math.round(bx + Math.sin(now * 0.8 + i) * 5 + par * (0.3 + (i % 3) * 0.2));
      const col = i % 5 === 0 ? '#05d9e8' : i % 3 === 0 ? '#ff8a3d' : '#8a7aa8';
      ctx.globalAlpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(now * 2 + i)); ctx.fillStyle = col; ctx.fillRect(x, Math.round(y), 1, i % 7 === 0 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
    // Viñeta suave (bordes superior e inferior) y oscurecido de las pantallas secundarias.
    for (let k = 0; k < 4; k++) { ctx.fillStyle = `rgba(7,2,26,${0.4 - k * 0.1})`; ctx.fillRect(0, k * 2, w, 2); ctx.fillRect(0, h - 2 - k * 2, w, 2); }
    if (dim) { ctx.fillStyle = 'rgba(13, 2, 33, 0.62)'; ctx.fillRect(0, 0, w, h); }
  }

  drawTitle(ctx, w, h, now) {
    const g = this.game, sf = g.safe, cx = Math.round(w / 2), t = now - this.enterAt;
    const L = this.titleLayout(), { options } = L;
    const pulse = 0.5 + 0.5 * Math.sin(now * Math.PI * 2 * BEAT);
    // Logo: entra deslizando desde arriba con un temblor de glitch, aberración cromática, halo y parpadeo de neón; debajo, una barra que late al ritmo y el lema tecleado.
    const logo = 'NEON RUSH', scale = L.logoScale;
    const kin = clamp(t / 0.55, 0, 1), ein = 1 - Math.pow(1 - kin, 3);
    const ly = L.logoY - Math.round((1 - ein) * 26);
    const jit = t < 0.6 ? Math.round(Math.sin(t * 90) * (1 - kin) * 4) : 0;
    const flickerOff = t > 0.8 && (Math.sin(now * 13) > 0.97 || (Math.floor(now * 10) % 37 === 0));
    ctx.save();
    ctx.globalAlpha = ein;
    drawText(ctx, logo, cx - 1 + jit, ly, { color: COLORS.player, scale, align: 'center', shadow: null });
    drawText(ctx, logo, cx + 1 - jit, ly + 1, { color: COLORS.wall, scale, align: 'center', shadow: null });
    ctx.shadowColor = COLORS.wall; ctx.shadowBlur = 10 + Math.round(pulse * 6);
    drawText(ctx, logo, cx + jit, ly, { color: '#ffe6f2', scale, align: 'center', shadow: null });
    ctx.restore();
    const lw = measureText(logo) * scale, lx = Math.round(cx - lw / 2);
    if (flickerOff) { ctx.fillStyle = 'rgba(13, 2, 33, 0.75)'; ctx.fillRect(lx - 2, ly, measureText('NEON') * scale + 3, CELL_H * scale + 2); }
    const by = ly + CELL_H * scale + 1, bw = Math.round(lw * ein);
    ctx.fillStyle = COLORS.player; ctx.fillRect(cx - Math.round(bw / 2), by, Math.round(bw / 2), 1 + Math.round(pulse));
    ctx.fillStyle = COLORS.wall; ctx.fillRect(cx, by, Math.round(bw / 2), 1 + Math.round(1 - pulse));
    const tag = measureText('ACCIÓN CENITAL · UN SOLO GOLPE · NEÓN') <= w - 8 ? 'ACCIÓN CENITAL · UN SOLO GOLPE · NEÓN' : 'UN SOLO GOLPE · NEÓN';
    const typed = tag.slice(0, Math.max(0, Math.floor((t - 0.5) * 34)));
    if (typed) drawText(ctx, typed, Math.round(cx - measureText(tag) / 2), by + 5, { color: COLORS.enemy });

    // Panel de opciones: oscuro y con filos de neón para que se lean sobre el fondo vivo.
    const top = options[0].y - 3, bottom = options[options.length - 1].y + options[options.length - 1].h + 3, px = options[0].x - 4, pw = options[0].w + 8;
    const kp = clamp((t - 0.3) / 0.3, 0, 1);
    ctx.globalAlpha = kp;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.74)'; ctx.fillRect(px, top, pw, bottom - top);
    ctx.fillStyle = '#3a2a55'; ctx.fillRect(px, top, pw, 1); ctx.fillRect(px, bottom - 1, pw, 1);
    ctx.fillStyle = mixHex('#3a2a55', COLORS.wall, 0.35 + 0.35 * pulse); ctx.fillRect(px, top, 2, bottom - top); ctx.fillRect(px + pw - 2, top, 2, bottom - top);
    ctx.globalAlpha = 1;

    // Opciones: entrada escalonada (deslizan desde la izquierda), resaltado con transición suave, destello al pulsar.
    TITLE_OPTIONS.forEach((o, i) => {
      const r = options[i], hot = this.hot[i];
      const k = clamp((t - (0.35 + i * 0.08)) / 0.3, 0, 1), e = 1 - Math.pow(1 - k, 3);
      if (e <= 0) return;
      const xo = Math.round((1 - e) * -26), ty = r.y + Math.floor((r.h - CELL_H * L.textScale) / 2);
      ctx.save();
      ctx.globalAlpha = e;
      if (hot > 0.03) {
        ctx.fillStyle = mixHex('#1a0836', '#42104e', hot); ctx.globalAlpha = e * (0.35 + 0.65 * hot); ctx.fillRect(r.x + xo, r.y + 1, r.w, r.h - 2);
        ctx.globalAlpha = e; ctx.fillStyle = COLORS.wall; ctx.fillRect(r.x + xo, r.y + 1, 2, r.h - 2);
        ctx.fillStyle = mixHex('#3a2a55', COLORS.player, hot); ctx.fillRect(r.x + xo + 2, r.y + r.h - 2, Math.round((r.w - 2) * hot), 1);
      }
      const col = mixHex(DIM, COLORS.text, hot), dx = Math.round(hot * 3);
      if (hot > 0.5) { ctx.shadowColor = COLORS.wall; ctx.shadowBlur = 8; }
      drawText(ctx, o.label, cx + xo + dx, ty, { color: col, scale: L.textScale, align: 'center', shadow: hot > 0.5 ? COLORS.wall : null });
      ctx.shadowBlur = 0;
      if (hot > 0.35) {   // chevrones que respiran junto al texto elegido
        const half = measureText(o.label) * L.textScale / 2, br = Math.round(Math.sin(now * 8) * 1.5 * hot);
        ctx.globalAlpha = e * hot;
        drawText(ctx, '>', cx + xo + dx - half - 17 - br, ty, { color: COLORS.wall, scale: L.textScale });
        drawText(ctx, '<', cx + xo + dx + half + 10 + br, ty, { color: COLORS.wall, scale: L.textScale });
      }
      if (this.press[i] > 0) { ctx.globalAlpha = Math.min(1, this.press[i] * 4); ctx.fillStyle = '#ffffff'; ctx.fillRect(r.x + xo, r.y + 1, r.w, r.h - 2); }
      ctx.restore();
    });

    // Esquinas y barra inferior con márgenes seguros: versión (arriba izquierda), pantalla completa (arriba derecha), ayuda según el dispositivo y récord.
    const touch = g.input.touchMode;
    drawText(ctx, `V ${APP_VERSION}`, 6 + sf.l, 6 + sf.t, { color: '#4a3d66' });
    const fs = this.fullscreenRect();
    if (fs) drawTouchButton(ctx, fs, false, 0.7);
    const best = g.history.best(), rec = best ? `RÉCORD ${best.toLocaleString('es')}` : '';
    const yb = h - 12 - sf.b;
    const hint = touch ? '' : 'FLECHAS / RATÓN: ELEGIR · ENTER: ACEPTAR';
    if (hint && rec && measureText(hint) + measureText(rec) + 24 + sf.l + sf.r > w) { drawText(ctx, rec, cx, yb - 10, { color: COLORS.enemy, align: 'center' }); drawText(ctx, hint, cx, yb, { color: DIM, align: 'center' }); }
    else {
      if (hint) drawText(ctx, hint, 6 + sf.l, yb, { color: DIM });
      if (rec) drawText(ctx, rec, touch ? cx : w - 6 - sf.r, yb, { color: COLORS.enemy, align: touch ? 'center' : 'right' });
    }
    if (touch && IS_IOS) drawText(ctx, 'IPHONE: QUITA EL MODO SILENCIO PARA OÍR EL JUEGO', cx, yb - (rec ? 11 : 0), { color: COLORS.enemy, align: 'center' });
  }

  drawFloors(ctx, w, h) {
    const g = this.game;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.7)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2);
    const title = 'SELECCIONAR PISO';
    drawText(ctx, title, cx, 6, { color: COLORS.wall, scale: g.fitScale(title, w - 12), align: 'center' });

    const { cards, thumbScale, bottom, first, perPage } = this.floorsLayout();
    const bob = Math.floor(performance.now() / 300) % 2;
    LEVELS.forEach((level, i) => {
      const c = cards[i];
      if (!c) return; // fuera de la ventana visible
      const n = i + 1;
      const sel = i === this.floorIndex;
      const unlocked = g.floorStats.isUnlocked(n);
      const stats = g.floorStats.get(n);
      const y = c.y - (sel ? bob : 0);
      ctx.save();
      if (sel) { ctx.shadowColor = COLORS.wall; ctx.shadowBlur = 10; }
      ctx.fillStyle = sel ? COLORS.wall : '#3a2a55';
      ctx.fillRect(c.x, y, c.w, c.h);
      ctx.restore();
      ctx.fillStyle = sel ? '#2a0d3a' : '#1a0d2e';
      ctx.fillRect(c.x + 1, y + 1, c.w - 2, c.h - 2);

      const info = floorThumb(i);
      const tw = info.canvas.width * thumbScale, th = info.canvas.height * thumbScale;
      const tx = Math.round(c.x + (c.w - tw) / 2);
      ctx.globalAlpha = unlocked ? 1 : 0.25;
      ctx.drawImage(info.canvas, tx, y + 6, tw, th);
      ctx.globalAlpha = 1;
      const [floorLabel, roomLabel] = level.name.split(' · ');
      let ty = y + 8 + th + 4;
      const mid = c.x + c.w / 2;
      drawText(ctx, floorLabel, mid, ty, { color: sel ? COLORS.text : DIM, align: 'center' });
      drawText(ctx, roomLabel, mid, ty + 11, { color: sel ? COLORS.player : DIM, align: 'center' });
      ty += 22;
      if (!unlocked) {
        drawText(ctx, 'BLOQUEADO', mid, ty + 5, { color: COLORS.blood, align: 'center' });
        return;
      }
      // Dos líneas cortas: con seis tarjetas de ~70 px no cabe "11 ENEM. · 6 ARM." en una.
      drawText(ctx, `${info.enemies} ENEMIGOS`, mid, ty, { color: DIM, align: 'center' });
      drawText(ctx, `${info.armed} ARMADOS`, mid, ty + 11, { color: DIM, align: 'center' });
      if (stats.bestRank) {
        drawText(ctx, `RANGO ${stats.bestRank}`, mid, ty + 22, { color: RANK_COLORS[stats.bestRank], align: 'center' });
        drawText(ctx, `${stats.bestScore.toLocaleString('es')} PTS`, mid, ty + 33, { color: COLORS.text, align: 'center' });
      } else {
        drawText(ctx, 'PENDIENTE', mid, ty + 22, { color: DIM, align: 'center' });
      }
    });

    // Flechas de desplazamiento si hay pisos fuera de la ventana.
    const arrowY = 30 + Math.round((bottom - 30) / 2);
    if (first > 0) drawText(ctx, '<', 4 + g.safe.l, arrowY, { color: COLORS.wall, scale: 2 });
    if (first + perPage < LEVELS.length) drawText(ctx, '>', w - 14 - g.safe.r, arrowY, { color: COLORS.wall, scale: 2 });
    const n = this.floorIndex + 1;
    const floorName = LEVELS[this.floorIndex].name.split(' · ')[0];
    const msg = g.floorStats.isUnlocked(n)
      ? g.hint(`ENTER: EMPEZAR EN EL ${floorName}`, `TOCA OTRA VEZ PARA EMPEZAR EN EL ${floorName}`)
      : `COMPLETA EL PISO ${n - 1} PARA DESBLOQUEARLO`;
    drawText(ctx, msg, cx, Math.min(bottom + 8, h - 26), { color: g.floorStats.isUnlocked(n) ? COLORS.player : COLORS.blood, align: 'center' });
    drawText(ctx, g.hint('FLECHAS / RATÓN: ELEGIR · ESC: VOLVER', 'TOCA UN PISO PARA ELEGIRLO'), cx, h - 12 - g.safe.b, { color: DIM, align: 'center' });
    const back = this.backRect();
    if (back) drawTouchButton(ctx, back, false, 0.85);
  }

  drawRecords(ctx, w, h) {
    const g = this.game;
    ctx.fillStyle = 'rgba(13, 2, 33, 0.8)';
    ctx.fillRect(0, 0, w, h);
    const cx = Math.round(w / 2);
    const top = Math.max(8, Math.round(h / 2 - 66));
    drawText(ctx, 'HIGH SCORES', cx, top, { color: COLORS.wall, scale: 2, align: 'center' });
    if (!g.history.entries.length) drawText(ctx, 'TODAVÍA NO HAY PARTIDAS GUARDADAS', cx, top + 24, { color: DIM, align: 'center' });
    g.drawRecordsTable(ctx, w, top + 38, null);
    drawText(ctx, g.hint('ESC / ENTER: VOLVER', 'TOCA PARA VOLVER'), cx, h - 12 - g.safe.b, { color: COLORS.player, align: 'center' });
  }
}
