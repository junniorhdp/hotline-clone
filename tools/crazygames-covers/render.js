// Se ejecuta DENTRO del navegador (lo inyecta generate.mjs): dibuja una portada en un canvas y devuelve el PNG.
// Dos modos: con capturas reales (source/) o, sin ellas, una escena top-down neón dibujada aquí (sin sangre, apta para todos los públicos en lo posible).
window.renderCover = async function renderCover({ format, W, H, capture }) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  // Zona que CrazyGames tapa con su etiqueta: esquina superior izquierda. Ni título ni elementos clave.
  const BADGE = { w: Math.round(W * 0.40), h: Math.round(H * 0.20) };

  // --- Disposición por formato ---------------------------------------------------------------------------------------------------------------------------------------
  const LAYOUT = {
    landscape: { px: 5, title: { lines: ['NEON RUSH'], unit: 26, cy: 0.80 }, hero: [200, 90, -0.30],
      foes: [['grunt', 304, 56, 2.9], ['runner', 322, 118, -2.7], ['grunt', 86, 118, 0.15], ['gunner', 255, 24, 2.2]], walls: [[0, 52, 128, 10], [150, 0, 10, 40], [352, 0, 10, 92], [352, 120, 10, 60], [0, 150, 52, 10]], lights: [[200, 90, '#05d9e8', 70], [316, 62, '#ff2a85', 62], [70, 130, '#7b2cff', 66]] },
    portrait: { px: 4, title: { lines: ['NEON', 'RUSH'], unit: 26, cy: 0.735 }, hero: [92, 130, -0.62],
      foes: [['grunt', 158, 64, 2.35], ['runner', 170, 140, -2.75], ['grunt', 24, 112, -0.1], ['gunner', 130, 22, 1.9]], walls: [[0, 70, 52, 8], [74, 0, 8, 38], [180, 90, 20, 8], [0, 212, 40, 8], [160, 212, 40, 8]], lights: [[92, 130, '#05d9e8', 66], [160, 66, '#ff2a85', 58], [38, 190, '#7b2cff', 54]] },
    square: { px: 4, title: { lines: ['NEON', 'RUSH'], unit: 20, cy: 0.70 }, hero: [90, 68, -0.36],
      foes: [['grunt', 164, 46, 2.8], ['runner', 178, 82, -2.95], ['grunt', 24, 76, 0.05], ['gunner', 124, 20, 2.1]], walls: [[0, 48, 44, 7], [78, 0, 7, 24], [190, 66, 10, 26]], lights: [[90, 76, '#05d9e8', 56], [162, 50, '#ff2a85', 50], [34, 108, '#7b2cff', 46]] },
  }[format];

  // --- Utilidades -------------------------------------------------------------------------------------------------------------------------------------------------------
  let seed = 20261126;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; };
  const glow = (c, x, y, r, color, a) => {
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = a; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
  };

  // Sprite pixel art a partir de formas (se muestrea el centro de cada píxel: bordes nítidos) con contorno oscuro de 1 px.
  function sprite(w, h, parts) {
    const [c, x] = make(w + 2, h + 2);
    const grid = Array.from({ length: h }, () => new Array(w).fill(null));
    for (const p of parts) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = i + 0.5, v = j + 0.5;
      const inside = p[0] === 'e' ? ((u - p[1]) / p[3]) ** 2 + ((v - p[2]) / p[4]) ** 2 <= 1 : u >= p[1] && u < p[1] + p[3] && v >= p[2] && v < p[2] + p[4];
      if (inside) grid[j][i] = p[5];
    }
    const at = (i, j) => (j >= 0 && j < h && i >= 0 && i < w ? grid[j][i] : null);
    for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) {
      const col = at(i, j) || (at(i - 1, j) || at(i + 1, j) || at(i, j - 1) || at(i, j + 1) ? '#07020f' : null);
      if (col) { x.fillStyle = col; x.fillRect(i + 1, j + 1, 1, 1); }
    }
    return c;
  }

  // Agente con máscara de gallo, visto desde arriba y mirando a +X.
  // Cuerpo y cabeza por separado: al superponerlos, la cabeza queda con su propio contorno y se lee sobre la chaqueta.
  const BODY = sprite(36, 28, [
    ['e', 11, 14, 8, 12.5, '#067a8c'], ['e', 11.5, 13, 7, 11, '#05d9e8'], ['e', 9, 7.5, 3.5, 3, '#8ff6ff'],
    ['r', 12, 2, 13, 4, '#05d9e8'], ['r', 12, 22, 13, 4, '#0793a6'], ['r', 24, 2, 4, 4, '#f2b090'], ['r', 24, 22, 4, 4, '#f2b090'],
    ['r', 23, 19, 12, 3, '#8d93a8'], ['r', 23, 19, 12, 1, '#d9def0'], ['r', 25, 22, 4, 3, '#4a4f63'],
  ]);
  const HEAD = sprite(21, 15, [
    ['e', 8.5, 7.5, 7, 7, '#d8d2ea'], ['e', 8, 6.8, 5.8, 5.8, '#ffffff'],
    ['r', 1, 6, 12, 3, '#ff2e55'], ['r', 0, 5, 2, 5, '#ff2e55'], ['r', 3, 4.5, 2, 6, '#ff2e55'], ['r', 6, 4.5, 2, 6, '#ff2e55'], ['r', 9, 5, 2, 5, '#ff2e55'],
    ['r', 11, 2.5, 3, 2, '#140a24'], ['r', 11, 10.5, 3, 2, '#140a24'],
    ['r', 14, 4.5, 3, 6, '#ffbe0b'], ['r', 17, 5.5, 2, 4, '#ffbe0b'], ['r', 19, 6.5, 2, 2, '#ff8a00'], ['r', 14, 7, 7, 1, '#a85f00'],
  ]);
  const HERO = (() => { const [c, x] = make(BODY.width, BODY.height); x.drawImage(BODY, 0, 0); x.drawImage(HEAD, 8, 6); return c; })();
  const foe = (shirt, shade, head, weapon) => sprite(28, 22, [
    ['e', 10, 11, 6.5, 10, shade], ['e', 10.5, 10, 5.5, 8.5, shirt],
    ['r', 11, 1, 9, 3, shirt], ['r', 11, 18, 9, 3, shade], ['r', 19, 1, 3, 3, '#d99a77'], ['r', 19, 18, 3, 3, '#d99a77'],
    ...weapon,
    ['e', 13, 11, 5.8, 5.8, head], ['r', 15, 8, 4, 6, '#d99a77'], ['r', 17, 8.5, 2, 1.5, '#2a0a14'], ['r', 17, 12.5, 2, 1.5, '#2a0a14'],
  ]);
  const FOES = {
    grunt: foe('#ffbe0b', '#b57f00', '#4b2a8c', [['r', 20, 17, 8, 3, '#a8723a'], ['r', 24, 16, 4, 5, '#c9955a']]),
    runner: foe('#ff2a85', '#a8125a', '#05d9e8', [['r', 20, 2, 8, 2, '#d9def0'], ['r', 19, 2, 2, 2, '#4a2f1c']]),
    gunner: foe('#6b4bb8', '#3c2776', '#2a2f3a', [['r', 20, 17, 8, 3, '#8d93a8'], ['r', 20, 17, 8, 1, '#d9def0']]),
  };
  const place = (c, img, x, y, angle, k) => {
    c.save(); c.translate(Math.round(x), Math.round(y)); c.rotate(angle);
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.ellipse(-1, 4, img.width * k * 0.34, img.height * k * 0.38, 0, 0, 7); c.fill();
    c.drawImage(img, -Math.round(img.width * k / 2), -Math.round(img.height * k / 2), img.width * k, img.height * k);
    c.restore();
  };

  // --- Escena dibujada (sin capturas) --------------------------------------------------------------------------------------------------------------------------------
  function drawScene() {
    const s = LAYOUT.px, w = W / s, h = H / s;
    const [lo, g] = make(w, h);
    g.fillStyle = '#12062a'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      g.fillStyle = (x / 16 + y / 16) % 2 ? '#1a0a37' : '#160830'; g.fillRect(x, y, 15, 15);
      if (rnd() < 0.18) { g.fillStyle = '#2a1250'; g.fillRect(x + 2 + rnd() * 9, y + 2 + rnd() * 9, 3, 1); }
    }
    g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    // Paredes con tubo de neón y sombra dura.
    for (const [x, y, ww, hh] of LAYOUT.walls) {
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x + 4, y + 4, ww, hh);
      g.fillStyle = '#3a1157'; g.fillRect(x, y, ww, hh);
      g.fillStyle = '#ff2a85'; g.fillRect(x, y, ww, 2); g.fillRect(x, y + hh - 2, ww, 2); g.fillRect(x, y, 2, hh); g.fillRect(x + ww - 2, y, 2, hh);
    }
    const [hx, hy, ha] = LAYOUT.hero;
    // Disparo: trazadora hacia el primer enemigo y fogonazo en la boca del arma.
    const muzzle = { x: hx + Math.cos(ha) * 38 - Math.sin(ha) * 12, y: hy + Math.sin(ha) * 38 + Math.cos(ha) * 12 };
    const [, tx, ty] = LAYOUT.foes[0];
    const dist = Math.hypot(tx - muzzle.x, ty - muzzle.y), dir = Math.atan2(ty - muzzle.y, tx - muzzle.x);
    g.save(); g.translate(muzzle.x, muzzle.y); g.rotate(dir);
    g.fillStyle = '#fff3b0'; g.fillRect(6, -1, dist - 24, 2);
    g.fillStyle = '#ffbe0b'; for (let d = 10; d < dist - 20; d += 9) g.fillRect(d, -3 + rnd() * 6, 4, 1);
    g.restore();
    for (const [type, x, y, a] of LAYOUT.foes) place(g, FOES[type], x, y, a, 1);
    place(g, HERO, hx, hy, ha, 2);
    // Fogonazo en estrella.
    g.save(); g.translate(Math.round(muzzle.x), Math.round(muzzle.y)); g.rotate(ha);
    for (const [col, len, th] of [['#ff7a00', 20, 7], ['#ffbe0b', 14, 5], ['#ffffff', 8, 3]]) { g.fillStyle = col; g.fillRect(0, -th / 2, len, th); g.fillRect(2, -len / 2.4, th / 1.5, len / 1.2); }
    g.restore();
    // Chispas de neón donde impacta (en lugar de sangre).
    for (let i = 0; i < 70; i++) {
      const a = rnd() * 6.28, r = 6 + rnd() * 24;
      g.fillStyle = ['#05d9e8', '#ff2a85', '#fff3b0', '#ffbe0b'][i % 4]; g.fillRect(Math.round(tx + Math.cos(a) * r), Math.round(ty + Math.sin(a) * r), i % 5 === 0 ? 3 : 1, 1);
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = i % 3 ? '#ff2a85' : '#05d9e8'; g.globalAlpha = 0.3 + rnd() * 0.5; g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1); }
    g.globalAlpha = 1;
    ctx.drawImage(lo, 0, 0, W, H);
    for (const [x, y, color, r] of LAYOUT.lights) glow(ctx, x * s, y * s, r * s, color, 0.24);
    glow(ctx, muzzle.x * s, muzzle.y * s, 26 * s, '#ffbe0b', 0.7);
    glow(ctx, tx * s, ty * s, 22 * s, '#ffffff', 0.25);
  }

  // --- Con captura real -----------------------------------------------------------------------------------------------------------------------------------------------
  async function drawCapture(cap) {
    const img = new Image(); img.src = cap.dataUrl; await img.decode();
    const top = Math.round(img.height * cap.cropTop);          // recorta el HUD del juego (arriba)
    const bottom = Math.round(img.height * cap.cropBottom);
    const sw = img.width, sh = img.height - top - bottom;
    const scale = Math.max(W / sw, H / sh) * cap.zoom;
    const cw = W / scale, chh = H / scale;
    const sx = Math.min(sw - cw, Math.max(0, sw * cap.focus[0] - cw / 2));
    const sy = Math.min(sh - chh, Math.max(0, sh * cap.focus[1] - chh / 2));
    ctx.save();
    ctx.imageSmoothingEnabled = scale < 2; ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'contrast(1.18) saturate(1.25) brightness(1.06)';
    ctx.drawImage(img, sx, top + sy, cw, chh, 0, 0, W, H);
    ctx.restore();
    return { upscale: +scale.toFixed(2) };
  }

  const info = capture ? await drawCapture(capture) : (drawScene(), {});

  // --- Acabado común: viñeta, esquina del distintivo tranquila y base oscura para el título -----------------------------------------------------------------------------
  const vg = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(3,0,10,0.72)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  const corner = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(BADGE.w, BADGE.h) * 1.15);
  corner.addColorStop(0, 'rgba(7,2,18,0.88)'); corner.addColorStop(1, 'rgba(7,2,18,0)');
  ctx.fillStyle = corner; ctx.fillRect(0, 0, W, H);

  // --- Título «NEON RUSH»: fuente de bloques 5×7 con extrusión, contorno, aberración neón y degradado ------------------------------------------------------------------
  const FONT = {
    N: '10001 11001 11001 10101 10011 10011 10001', E: '11111 10000 10000 11110 10000 10000 11111', O: '01110 10001 10001 10001 10001 10001 01110',
    R: '11110 10001 10001 11110 10100 10010 10001', U: '10001 10001 10001 10001 10001 10001 01110', S: '01111 10000 10000 01110 00001 00001 11110', H: '10001 10001 10001 11111 10001 10001 10001',
  };
  const T = LAYOUT.title, u = T.unit;
  const lineW = (t) => ([...t].reduce((a, ch) => a + (ch === ' ' ? 4 : 6), 0) - 1) * u;
  const gap = Math.round(u * 1.7), blockH = T.lines.length * 7 * u + (T.lines.length - 1) * gap;
  const maxW = Math.max(...T.lines.map(lineW));
  const y0 = Math.round(H * T.cy - blockH / 2);
  const blocks = (dx, dy, grow, paint) => {
    T.lines.forEach((text, li) => {
      let x = Math.round((W - lineW(text)) / 2);
      for (const ch of text) {
        if (ch === ' ') { x += 4 * u; continue; }
        FONT[ch].split(' ').forEach((row, j) => [...row].forEach((bit, i) => {
          if (bit !== '1') return;
          ctx.fillStyle = typeof paint === 'function' ? paint(j) : paint;
          ctx.fillRect(x + i * u + dx - grow, y0 + li * (7 * u + gap) + j * u + dy - grow, u + grow * 2, u + grow * 2);
        }));
        x += 6 * u;
      }
    });
  };
  const band = ctx.createLinearGradient(0, y0 - u * 5, 0, H);
  band.addColorStop(0, 'rgba(5,1,16,0)'); band.addColorStop(0.28, 'rgba(5,1,16,0.78)'); band.addColorStop(1, 'rgba(5,1,16,0.92)');
  ctx.fillStyle = band; ctx.fillRect(0, y0 - u * 5, W, H - (y0 - u * 5));
  glow(ctx, W / 2, y0 + blockH / 2, maxW * 0.62, '#ff2a85', 0.34);
  const out = Math.round(u * 0.34), depth = Math.round(u * 0.62);
  ctx.save(); ctx.shadowColor = '#ff2a85'; ctx.shadowBlur = u * 2.2; blocks(0, 0, out, '#ff2a85'); ctx.restore();
  for (let d = depth + out; d > 0; d -= 2) blocks(d, d, out, '#26073f');
  blocks(0, 0, out, '#0b0118');
  blocks(-Math.round(u * 0.17), 0, 0, '#05d9e8');
  blocks(Math.round(u * 0.17), Math.round(u * 0.12), 0, '#ff2a85');
  const ROWS = ['#ffffff', '#fff2f9', '#ffd3ea', '#ffa6d4', '#ff72b6', '#ff3f98', '#f0207c'];
  blocks(0, 0, 0, (j) => ROWS[j]);
  const barY = y0 + blockH + depth + out + Math.round(u * 0.55);
  ctx.save(); ctx.shadowColor = '#05d9e8'; ctx.shadowBlur = u; ctx.fillStyle = '#05d9e8'; ctx.fillRect(Math.round((W - maxW) / 2), barY, maxW, Math.max(4, Math.round(u * 0.28))); ctx.restore();

  // Líneas de barrido muy suaves (estética arcade, sin restar nitidez).
  ctx.fillStyle = 'rgba(0,0,0,0.07)'; for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

  // --- Comprobaciones ----------------------------------------------------------------------------------------------------------------------------------------------------
  const box = { x: Math.round((W - maxW) / 2) - out, y: y0 - out, w: maxW + out * 2 + depth, h: barY + Math.round(u * 0.28) - y0 + out };
  const margin = Math.min(box.x / W, (W - box.x - box.w) / W, box.y / H, (H - box.y - box.h) / H);
  const data = ctx.getImageData(0, 0, W, H).data;
  let whiteEdge = true;
  for (let x = 0; x < W && whiteEdge; x++) for (const y of [0, H - 1]) { const i = (y * W + x) * 4; if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) { whiteEdge = false; break; } }
  return {
    dataUrl: canvas.toDataURL('image/png'),
    report: { title: box, badge: BADGE, titleInBadge: box.x < BADGE.w && box.y < BADGE.h, minMargin: +(margin * 100).toFixed(1), whiteEdge, ...info },
  };
};
