import { TILE, isWallTile, isStructuralWall } from './map.js';
import { COLORS, seededRandom } from './utils.js';
import { pixelDisc } from './sprites.js';

// Arte estático del entorno, en pixel art: suelos por zona, muebles y deterioro de paredes.
// Todo se pinta una vez por piso en capas a media resolución del mundo (1 píxel = 2 unidades,
// una casilla = 16×16 px) que se dibujan escaladas ×2 sin suavizado.
// Qué muebles son sólidos lo decide map.js (SOLID_PROPS); aquí solo se dibujan.
const PX = TILE / 2;
const K = '#140a24'; // contorno oscuro

function makeLayer(map) {
  const c = document.createElement('canvas');
  c.width = map.w * PX;
  c.height = map.h * PX;
  return c;
}

const rect = (ctx, color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
// Caja con contorno de 1 px y relleno.
const box = (ctx, fill, x, y, w, h) => { rect(ctx, K, x, y, w, h); rect(ctx, fill, x + 1, y + 1, w - 2, h - 2); };
const dots = (ctx, color, x, y, w, h, n, rnd) => {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) ctx.fillRect(x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), 1, 1);
};
// Grieta: paseo aleatorio de píxeles.
const crack = (ctx, color, x, y, len, rnd) => {
  ctx.fillStyle = color;
  let dx = rnd() < 0.5 ? 1 : -1;
  for (let i = 0; i < len; i++) {
    ctx.fillRect(x, y, 1, 1);
    if (rnd() < 0.3) dx = -dx;
    x += rnd() < 0.6 ? dx : 0;
    y += 1;
  }
};

// --- Suelos ------------------------------------------------------------------------------
// Cada zona de LEVELS (`zones`) usa uno; las casillas sin zona usan `floor` del piso (pasillos).
export const FLOORS = {
  // Cemento agrietado (pasillos): ruido, juntas cada 4 casillas, grietas y manchas de humedad.
  concrete(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#1e1530', x0, y0, PX, PX);
    dots(ctx, '#251b3a', x0, y0, PX, PX, 14, rnd);
    dots(ctx, '#160f26', x0, y0, PX, PX, 10, rnd);
    if (tx % 4 === 0) rect(ctx, '#150e24', x0, y0, 1, PX);
    if (ty % 4 === 0) rect(ctx, '#150e24', x0, y0, PX, 1);
    if (rnd() < 0.3) crack(ctx, '#0e0819', x0 + 3 + Math.floor(rnd() * 9), y0 + 1, 6 + Math.floor(rnd() * 8), rnd);
    if (rnd() < 0.12) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = rnd() < 0.5 ? '#3a2410' : '#0f2420'; // óxido o humedad
      pixelDisc(ctx, x0 + 4 + rnd() * 8, y0 + 4 + rnd() * 8, 2 + rnd() * 3);
      ctx.globalAlpha = 1;
    }
  },
  // Baldosas a cuadros rotas: algunas faltan (se ve el cemento) y otras están agrietadas.
  brokenTiles(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    for (let cy = 0; cy < 2; cy++) {
      for (let cx = 0; cx < 2; cx++) {
        const x = x0 + cx * 8, y = y0 + cy * 8;
        if (rnd() < 0.12) {
          rect(ctx, '#140c22', x, y, 8, 8);
          dots(ctx, '#1e1530', x, y, 8, 8, 6, rnd);
        } else {
          rect(ctx, (cx + cy) % 2 ? '#2a1446' : '#1d0d34', x, y, 8, 8);
          rect(ctx, (cx + cy) % 2 ? '#341a54' : '#24113f', x, y, 8, 1);
          if (rnd() < 0.2) crack(ctx, '#0e0819', x + 2 + Math.floor(rnd() * 4), y, 7, rnd);
        }
      }
    }
    rect(ctx, '#100720', x0, y0, PX, 1);
    rect(ctx, '#100720', x0, y0, 1, PX);
  },
  // Tablones de madera gastada con vetas, juntas desplazadas y arañazos.
  wood(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    for (let p = 0; p < 4; p++) {
      const y = y0 + p * 4;
      const row = ty * 4 + p;
      rect(ctx, row % 2 ? '#3a1e2e' : '#32182a', x0, y, PX, 4);
      rect(ctx, '#1d0c18', x0, y + 3, PX, 1);
      const seam = (row * 7 + 3) % 16;
      if (tx % 2 === row % 2) rect(ctx, '#1d0c18', x0 + seam, y, 1, 3);
      ctx.fillStyle = '#46263a';
      for (let i = 0; i < 2; i++) if (rnd() < 0.6) ctx.fillRect(x0 + Math.floor(rnd() * PX), y + 1, 3, 1);
    }
    if (rnd() < 0.1) rect(ctx, '#55304a', x0 + Math.floor(rnd() * 10), y0 + Math.floor(rnd() * 14), 5, 1);
  },
  // Moqueta de oficina: trama con ruido y rayas diagonales, con alguna mancha.
  carpet(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#171236', x0, y0, PX, PX);
    for (let y = 0; y < PX; y++) {
      for (let x = 0; x < PX; x++) {
        const gx = x0 + x, gy = y0 + y;
        if ((gx + gy) % 8 === 0) { ctx.fillStyle = '#211a4c'; ctx.fillRect(gx, gy, 1, 1); continue; }
        const r = rnd();
        if (r < 0.1) { ctx.fillStyle = '#1d1744'; ctx.fillRect(gx, gy, 1, 1); } else if (r < 0.17) { ctx.fillStyle = '#100c28'; ctx.fillRect(gx, gy, 1, 1); }
      }
    }
    if (rnd() < 0.08) { ctx.globalAlpha = 0.4; ctx.fillStyle = '#0a0818'; pixelDisc(ctx, x0 + 8, y0 + 8, 3 + rnd() * 3); ctx.globalAlpha = 1; }
  },
  // Azulejos pequeños sucios (baños y cocinas): juntas oscuras, verdín y piezas rotas.
  bathTiles(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#0d1822', x0, y0, PX, PX);
    for (let cy = 0; cy < 4; cy++) {
      for (let cx = 0; cx < 4; cx++) {
        const broken = rnd() < 0.06;
        rect(ctx, broken ? '#141a20' : ((cx + cy) % 2 ? '#1c3040' : '#182a38'), x0 + cx * 4, y0 + cy * 4, 3, 3);
        if (!broken && rnd() < 0.25) rect(ctx, '#24404e', x0 + cx * 4, y0 + cy * 4, 1, 1);
      }
    }
    if (rnd() < 0.2) dots(ctx, '#23402a', x0, y0, PX, PX, 8, rnd); // verdín
  },
  // Asfalto de la calle (exterior): grano oscuro, gravilla clara, grietas y manchas de aceite.
  asphalt(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#14111f', x0, y0, PX, PX);
    dots(ctx, '#1b1729', x0, y0, PX, PX, 22, rnd);
    dots(ctx, '#0d0a16', x0, y0, PX, PX, 14, rnd);
    dots(ctx, '#2a2540', x0, y0, PX, PX, 4, rnd);
    if (rnd() < 0.18) crack(ctx, '#0a0712', x0 + 2 + Math.floor(rnd() * 11), y0 + 1, 7 + Math.floor(rnd() * 8), rnd);
    if (rnd() < 0.1) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#0a1a2a'; // aceite
      pixelDisc(ctx, x0 + 4 + rnd() * 8, y0 + 4 + rnd() * 8, 2 + rnd() * 3);
      ctx.globalAlpha = 1;
    }
  },
  // Raya amarilla discontinua del centro de la calle, desgastada.
  asphaltLine(ctx, tx, ty, rnd) {
    FLOORS.asphalt(ctx, tx, ty, rnd);
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#a89420', x0 + 1, y0 + 7, PX - 2, 2);
    dots(ctx, '#14111f', x0 + 1, y0 + 7, PX - 2, 2, 4, rnd);
  },
  // Plaza de aparcamiento de la moto: asfalto con una línea blanca desgastada arriba y abajo.
  asphaltBay(ctx, tx, ty, rnd) {
    FLOORS.asphalt(ctx, tx, ty, rnd);
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#8a86a8', x0, y0 + PX - 2, PX, 1);
    rect(ctx, '#8a86a8', x0, y0, PX, 1);
    dots(ctx, '#14111f', x0, y0 + PX - 2, PX, 1, 3, rnd);
  },
  // Acera de la calle: losas de hormigón pálido con juntas, grietas, manchas y algún chicle.
  sidewalk(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#3a3552', x0, y0, PX, PX);
    dots(ctx, '#443f5e', x0, y0, PX, PX, 16, rnd);
    dots(ctx, '#2c2840', x0, y0, PX, PX, 12, rnd);
    rect(ctx, '#26223a', x0, y0 + PX - 1, PX, 1); // junta entre losas
    rect(ctx, '#26223a', x0 + PX - 1, y0, 1, PX);
    rect(ctx, '#4d4869', x0, y0, PX - 1, 1);
    if (rnd() < 0.2) crack(ctx, '#1c182c', x0 + 2 + Math.floor(rnd() * 11), y0 + 1, 6 + Math.floor(rnd() * 8), rnd);
    if (rnd() < 0.08) rect(ctx, '#8a4a6a', x0 + 3 + Math.floor(rnd() * 9), y0 + 3 + Math.floor(rnd() * 9), 2, 1); // chicle
  },
  // Piedra húmeda de la alcantarilla: adoquines oscuros con verdín y charcos.
  sewerStone(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#151a24', x0, y0, PX, PX);
    for (let r = 0; r < 4; r++) {
      const off = (r + ty) % 2 ? 0 : 4;
      rect(ctx, '#0d1119', x0, y0 + r * 4 + 3, PX, 1);
      for (let x = off; x < PX; x += 8) rect(ctx, '#0d1119', x0 + x, y0 + r * 4, 1, 3);
    }
    dots(ctx, '#1d2733', x0, y0, PX, PX, 14, rnd);
    dots(ctx, '#1f4a3a', x0, y0, PX, PX, 5, rnd); // verdín
    if (rnd() < 0.12) { ctx.globalAlpha = 0.45; ctx.fillStyle = '#0b3a44'; pixelDisc(ctx, x0 + 4 + rnd() * 8, y0 + 4 + rnd() * 8, 2 + rnd() * 3); ctx.globalAlpha = 1; }
  },
  // Agua del canal: verde azulada oscura con vetas de luz (el brillo animado lo pone el túnel).
  water(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#0a2a33', x0, y0, PX, PX);
    dots(ctx, '#0e3a45', x0, y0, PX, PX, 22, rnd);
    dots(ctx, '#06181f', x0, y0, PX, PX, 14, rnd);
    for (let i = 0; i < 2; i++) rect(ctx, '#1a6a78', x0 + Math.floor(rnd() * 11), y0 + 2 + Math.floor(rnd() * 11), 3 + Math.floor(rnd() * 3), 1);
  },
  // Chapa metálica antideslizante (almacenes, servidores): marcas en diagonal y óxido.
  metal(ctx, tx, ty, rnd) {
    const x0 = tx * PX, y0 = ty * PX;
    rect(ctx, '#1f2236', x0, y0, PX, PX);
    for (let y = 1; y < PX; y += 4) {
      for (let x = (y % 8 === 1 ? 1 : 3); x < PX; x += 4) {
        rect(ctx, '#30344e', x0 + x, y0 + y, 2, 1);
        rect(ctx, '#151726', x0 + x, y0 + y + 1, 2, 1);
      }
    }
    rect(ctx, '#151726', x0, y0, PX, 1);
    if (rnd() < 0.15) dots(ctx, '#5a2e1a', x0 + 2, y0 + 2, 12, 12, 10, rnd);
  },
};

// --- Muebles sólidos ------------------------------------------------------------------------
// paint(ctx, x, y, w, h, rnd) en píxeles de la capa (x, y = esquina; w, h = tamaño en px).
const PROP_ART = {
  desk(ctx, x, y, w, h, rnd) {
    box(ctx, '#6b4428', x + 1, y + 2, w - 2, h - 3);
    rect(ctx, '#8a5a34', x + 2, y + 3, w - 4, 1);
    rect(ctx, '#4a2e1a', x + 2, y + h - 3, w - 4, 1);
    // Monitor apagado y papeles.
    box(ctx, '#1a1a2a', x + 3, y + 4, 7, 6);
    rect(ctx, '#05d9e8', x + 5, y + 6, 1, 1);
    if (w > 18) { rect(ctx, '#c9c3e6', x + w - 10, y + 6, 5, 4); rect(ctx, '#7a7499', x + w - 9, y + 7, 3, 1); }
    if (rnd() < 0.5) rect(ctx, '#ffbe0b', x + 12, y + 5, 2, 2); // taza
  },
  // Escritorio volcado: se ve la parte de abajo con las patas, sirve de parapeto.
  deskFlipped(ctx, x, y, w, h) {
    box(ctx, '#3e2616', x + 1, y + 3, w - 2, h - 6);
    for (let i = 4; i < w - 4; i += 6) rect(ctx, '#2a1810', x + i, y + 4, 1, h - 8);
    for (const lx of [x + 2, x + w - 5]) { rect(ctx, K, lx, y + 1, 3, 3); rect(ctx, '#5a3a24', lx + 1, y + 2, 1, 1); rect(ctx, K, lx, y + h - 4, 3, 3); }
    rect(ctx, '#6b4428', x + 2, y + 4, w - 4, 1);
  },
  // Mostrador / barra: encimera clara con botellas de colores.
  counter(ctx, x, y, w, h, rnd) {
    box(ctx, '#2c2840', x + 1, y + 2, w - 2, h - 3);
    rect(ctx, '#4a4566', x + 2, y + 3, w - 4, 2);
    rect(ctx, '#1d1a2e', x + 2, y + h - 3, w - 4, 1);
    const colors = ['#ff2a85', '#05d9e8', '#ffbe0b', '#3fa35a'];
    for (let i = 5; i < w - 4; i += 4 + Math.floor(rnd() * 4)) rect(ctx, colors[Math.floor(rnd() * colors.length)], x + i, y + 6, 2, 3);
  },
  sofa(ctx, x, y, w, h, rnd) {
    const horizontal = w >= h;
    box(ctx, '#3a1830', x + 1, y + 1, w - 2, h - 2);
    // Respaldo en el lado largo superior/izquierdo y cojines por casilla.
    if (horizontal) rect(ctx, '#4a1f3a', x + 2, y + 2, w - 4, 3); else rect(ctx, '#4a1f3a', x + 2, y + 2, 3, h - 4);
    const n = Math.max(1, Math.round((horizontal ? w : h) / PX));
    for (let i = 0; i < n; i++) {
      if (horizontal) box(ctx, '#6e2e55', x + 2 + i * ((w - 4) / n), y + 5, (w - 4) / n, h - 7);
      else box(ctx, '#6e2e55', x + 5, y + 2 + i * ((h - 4) / n), w - 7, (h - 4) / n);
    }
    dots(ctx, '#c9a07a', x + 4, y + 6, w - 8, h - 9, 3, rnd); // relleno asomando por los rotos
  },
  // Mesa con maletín abierto lleno de billetes (y paquetes sospechosos si es larga).
  cashTable(ctx, x, y, w, h) {
    box(ctx, '#5a3a24', x + 1, y + 1, w - 2, h - 2);
    rect(ctx, '#7a5034', x + 2, y + 2, w - 4, 1);
    box(ctx, '#2a2a30', x + 3, y + 4, 10, 8);
    rect(ctx, '#3fa35a', x + 4, y + 6, 8, 5);
    for (let i = 0; i < 3; i++) rect(ctx, '#2a7a40', x + 5 + i * 3, y + 6, 1, 5);
    rect(ctx, '#c9c3e6', x + 4, y + 5, 8, 1);
    if (w > 18) for (let i = 0; i < 2; i++) { box(ctx, '#d8d0c0', x + 16 + i * 7, y + 5, 6, 6); rect(ctx, '#8a6a3a', x + 18 + i * 7, y + 6, 1, 4); }
  },
  // Estantería metálica con cajas.
  shelf(ctx, x, y, w, h, rnd) {
    box(ctx, '#3a3e58', x + 1, y + 1, w - 2, h - 2);
    const horizontal = w >= h;
    const len = horizontal ? w : h;
    for (let i = 3; i < len - 3; i += 5) {
      const c = ['#8a6230', '#6b4a22', '#4a4e6a', '#c9c3e6'][Math.floor(rnd() * 4)];
      if (horizontal) box(ctx, c, x + i, y + 3, 5, h - 6); else box(ctx, c, x + 3, y + i, w - 6, 5);
    }
    if (horizontal) rect(ctx, '#6e7396', x + 2, y + 2, w - 4, 1); else rect(ctx, '#6e7396', x + 2, y + 2, 1, h - 4);
  },
  // Televisor CRT con la pantalla rota y algo de estática.
  tv(ctx, x, y, w, h, rnd) {
    box(ctx, '#2a2838', x + 2, y + 2, w - 4, h - 4);
    rect(ctx, '#0b141e', x + 4, y + 4, w - 8, h - 9);
    dots(ctx, '#05d9e8', x + 4, y + 4, w - 8, h - 9, 6, rnd);
    rect(ctx, '#c9c3e6', x + 6, y + 5, 1, 1); rect(ctx, '#c9c3e6', x + 7, y + 6, 1, 1); rect(ctx, '#c9c3e6', x + 8, y + 7, 1, 1);
    rect(ctx, '#c9c3e6', x + 7, y + 8, 1, 1); rect(ctx, '#c9c3e6', x + 9, y + 6, 1, 1);
    rect(ctx, '#ff2a85', x + w - 6, y + h - 4, 1, 1);
  },
  // Archivador con un cajón abierto lleno de papeles.
  cabinet(ctx, x, y, w, h) {
    box(ctx, '#4a4e6a', x + 2, y + 1, w - 4, h - 2);
    for (let i = 0; i < 3; i++) { rect(ctx, '#2e3148', x + 3, y + 5 + i * 4, w - 6, 1); rect(ctx, '#9a9ec0', x + 7, y + 3 + i * 4, 2, 1); }
    rect(ctx, '#1a1c2c', x + 3, y + 2, w - 6, 3);
    rect(ctx, '#c9c3e6', x + 4, y + 2, w - 8, 1);
  },
  crates(ctx, x, y, w, h) {
    box(ctx, '#6b4a22', x + 1, y + 1, w - 2, h - 2);
    for (let i = 4; i < h - 2; i += 4) rect(ctx, '#4a3215', x + 2, y + i, w - 4, 1);
    for (let i = 0; i < w - 4; i++) rect(ctx, '#8a6230', x + 2 + i, y + 2 + Math.round((i * (h - 5)) / (w - 5)), 1, 1);
    rect(ctx, '#8a6230', x + 2, y + 2, w - 4, 1);
  },
  // Farola: base y poste vistos desde arriba, con la lámpara encendida (su charco de luz va en DECO_ART.lamp).
  lamp(ctx, x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2;
    ctx.fillStyle = K; pixelDisc(ctx, cx, cy, 4);
    ctx.fillStyle = '#4a4660'; pixelDisc(ctx, cx, cy, 3);
    ctx.fillStyle = '#6a6488'; pixelDisc(ctx, cx - 1, cy - 1, 1);
    ctx.fillStyle = '#ffe08a'; pixelDisc(ctx, cx, cy, 1);
    rect(ctx, '#fff6c8', cx, cy, 1, 1);
  },
  // Máquina expendedora (vista desde arriba): carcasa roja con el techo y una franja de neón en el frente (arriba).
  vending(ctx, x, y, w, h, rnd) {
    box(ctx, '#8a1f3a', x + 1, y + 1, w - 2, h - 2);
    rect(ctx, '#b8325a', x + 2, y + 2, w - 4, 2);
    rect(ctx, '#5a1226', x + 2, y + h - 3, w - 4, 1);
    rect(ctx, '#05d9e8', x + 3, y + 5, w - 6, 1);          // neón del frente
    rect(ctx, '#9ff6ff', x + 3, y + 5, 3, 1);
    for (let i = 0; i < 3; i++) rect(ctx, rnd() < 0.5 ? '#ffbe0b' : '#ff4fa3', x + 3 + i * 4, y + 8, 3, 3); // latas
    rect(ctx, '#140a24', x + w - 5, y + 11, 3, 2);         // ranura
  },
  // Cabina telefónica: techo azul oscuro con cristales y el teléfono dentro.
  phone(ctx, x, y, w, h, rnd) {
    box(ctx, '#1c3a6e', x + 1, y + 1, w - 2, h - 2);
    rect(ctx, '#2f5fa8', x + 2, y + 2, w - 4, 1);
    rect(ctx, '#0e1f3d', x + 2, y + h - 3, w - 4, 1);
    rect(ctx, '#7ad0ff', x + 3, y + 4, w - 6, 5);           // techo acristalado
    rect(ctx, '#bfeaff', x + 4, y + 5, 3, 1);
    rect(ctx, '#05d9e8', x + 3, y + 3, w - 6, 1);
    dots(ctx, '#0e1f3d', x + 3, y + 4, w - 6, 5, 3, rnd);
    rect(ctx, '#ffbe0b', x + 6, y + h - 5, 4, 1);           // rótulo
  },
  // Tambor metálico de la fogata (visto desde arriba): aro oxidado, interior ennegrecido y brasas. Las llamas y el resplandor los pinta street.js.
  firebarrel(ctx, x, y, w, h, rnd) {
    const cx = x + w / 2, cy = y + h / 2;
    ctx.fillStyle = K; pixelDisc(ctx, cx, cy, 7);
    ctx.fillStyle = '#3a4a58'; pixelDisc(ctx, cx, cy, 6);
    ctx.fillStyle = '#6a7a88'; pixelDisc(ctx, cx - 1, cy - 1, 5);
    ctx.fillStyle = '#1a0c06'; pixelDisc(ctx, cx, cy, 4);
    ctx.fillStyle = '#c2461a'; pixelDisc(ctx, cx, cy, 2);
    dots(ctx, '#8a4a2a', cx - 6, cy - 6, 12, 12, 6, rnd);
  },
  // Contenedor de basura (2×1 o 1×2): tapa verde oscuro con asas y óxido.
  dumpster(ctx, x, y, w, h, rnd) {
    box(ctx, '#2a5a3a', x + 1, y + 1, w - 2, h - 2);
    rect(ctx, '#3a7a50', x + 2, y + 2, w - 4, 1);
    rect(ctx, '#1d4028', x + 2, y + h - 3, w - 4, 1);
    if (w >= h) { rect(ctx, K, x + w / 2, y + 2, 1, h - 4); rect(ctx, '#9aa0b8', x + 3, y + h / 2, 3, 1); rect(ctx, '#9aa0b8', x + w - 6, y + h / 2, 3, 1); }
    else { rect(ctx, K, x + 2, y + h / 2, w - 4, 1); rect(ctx, '#9aa0b8', x + w / 2, y + 3, 1, 3); rect(ctx, '#9aa0b8', x + w / 2, y + h - 6, 1, 3); }
    dots(ctx, '#8a4a2a', x + 2, y + 2, w - 4, h - 4, 8, rnd);
  },
  barrel(ctx, x, y, w, h, rnd) {
    const cx = x + w / 2, cy = y + h / 2;
    ctx.fillStyle = K; pixelDisc(ctx, cx, cy, 7);
    ctx.fillStyle = '#2a4050'; pixelDisc(ctx, cx, cy, 6);
    ctx.fillStyle = '#3a5a6a'; pixelDisc(ctx, cx, cy, 4);
    rect(ctx, '#5a7a8a', cx - 3, cy - 4, 3, 1);
    dots(ctx, '#8a4a2a', cx - 5, cy - 5, 10, 10, 6, rnd);
  },
  toilet(ctx, x, y, w) {
    box(ctx, '#9a94b8', x + 3, y + 1, w - 6, 5); // cisterna
    ctx.fillStyle = K; pixelDisc(ctx, x + w / 2, y + 10, 5);
    ctx.fillStyle = '#b8b0d0'; pixelDisc(ctx, x + w / 2, y + 10, 4);
    ctx.fillStyle = '#3a4a3a'; pixelDisc(ctx, x + w / 2, y + 10, 2);
  },
  sink(ctx, x, y, w) {
    box(ctx, '#9a94b8', x + 2, y + 1, w - 4, 10);
    rect(ctx, '#4a4866', x + 4, y + 4, w - 8, 5);
    rect(ctx, '#c9c3e6', x + w / 2 - 1, y + 2, 2, 2);
    rect(ctx, '#2a6a4a', x + 5, y + 7, 2, 1);
  },
  // Mesa de cartas: tapete verde con fichas y naipes.
  cardTable(ctx, x, y, w, h, rnd) {
    box(ctx, '#4a2e1a', x + 1, y + 1, w - 2, h - 2);
    rect(ctx, '#1f5a3f', x + 3, y + 3, w - 6, h - 6);
    rect(ctx, '#2a7050', x + 4, y + 4, w - 8, 1);
    const chips = ['#ff2a85', '#05d9e8', '#ffbe0b', '#f5f3ff'];
    for (let i = 0; i < 7; i++) rect(ctx, chips[i % 4], x + 6 + Math.floor(rnd() * (w - 12)), y + 6 + Math.floor(rnd() * (h - 12)), 2, 2);
    for (let i = 0; i < 3; i++) box(ctx, '#f5f3ff', x + 8 + i * 6, y + h / 2 - 3, 4, 6);
  },
  bed(ctx, x, y, w, h, rnd) {
    box(ctx, '#4a2e1a', x + 1, y + 1, w - 2, h - 2);
    rect(ctx, '#5a5070', x + 3, y + 3, w - 6, h - 6);
    box(ctx, '#8a8098', x + 4, y + 4, w - 8, 6); // almohada
    rect(ctx, '#3e2a5a', x + 3, y + 12, w - 6, h - 15); // manta
    dots(ctx, '#2a2040', x + 4, y + 13, w - 8, h - 17, 8, rnd);
  },
};

// --- Decoración de suelo (no sólida) --------------------------------------------------------
const DECO_ART = {
  rug(ctx, x, y, w, h, rnd) {
    rect(ctx, '#2e1226', x + 1, y + 1, w - 2, h - 2);
    rect(ctx, '#4a1f3a', x + 3, y + 3, w - 6, h - 6);
    ctx.fillStyle = '#7a2a55';
    for (let i = 0; i < Math.min(w, h) - 8; i += 2) {
      ctx.fillRect(x + w / 2 - i / 2, y + 4 + i / 2, 1, 1);
      ctx.fillRect(x + w / 2 + i / 2, y + 4 + i / 2, 1, 1);
    }
    for (let i = x + 2; i < x + w - 2; i += 2) { rect(ctx, '#c9a07a', i, y, 1, 1); rect(ctx, '#c9a07a', i, y + h - 1, 1, 1); }
    dots(ctx, '#1a0a16', x + 3, y + 3, w - 6, h - 6, Math.floor((w * h) / 60), rnd); // agujeros
  },
  // Consola del detonador (piso 10): caja oscura con pantalla, franja de peligro y un botón rojo grande bajo una tapa.
  detonator(ctx, x, y, w, h) {
    rect(ctx, '#0a0812', x + 1, y + 2, w - 2, h - 3);
    rect(ctx, '#2c2c42', x + 2, y + 3, w - 4, h - 5);
    rect(ctx, '#ffbe0b', x + 2, y + 3, w - 4, 2); for (let i = 3; i < w - 2; i += 3) rect(ctx, '#14101c', x + i, y + 3, 1, 2); // franja de peligro
    rect(ctx, '#05d9e8', x + 3, y + 6, 5, 3); rect(ctx, '#067a85', x + 3, y + 8, 5, 1); // pantalla
    rect(ctx, '#14101c', x + 9, y + 6, 5, 6); rect(ctx, '#ff2a4a', x + 10, y + 7, 3, 4); rect(ctx, '#ff8a9a', x + 10, y + 7, 1, 1); // botón rojo
    rect(ctx, '#14101c', x + 3, y + 10, 5, 3); rect(ctx, '#7d6f98', x + 4, y + 11, 3, 1);
  },
  // Trampilla de servicio (piso 10): placa de acero con remaches y un tirador. Parece decoración; ver Game.drawHatch para cuando se abre.
  hatch(ctx, x, y, w, h) {
    rect(ctx, '#15121f', x, y, w, h);
    rect(ctx, '#34344a', x + 1, y + 1, w - 2, h - 2);
    rect(ctx, '#46465f', x + 2, y + 2, w - 4, h - 4);
    rect(ctx, '#3a3a52', x + 4, y + 4, w - 8, h - 8);
    rect(ctx, '#2c2c42', x + 4, y + h - 5, w - 8, 1); rect(ctx, '#2c2c42', x + w - 5, y + 4, 1, h - 8);
    for (const [rx, ry] of [[3, 3], [w - 4, 3], [3, h - 4], [w - 4, h - 4]]) rect(ctx, '#8a8aa8', x + rx, y + ry, 1, 1); // remaches
    rect(ctx, '#15121f', x + w / 2 - 4, y + h / 2 - 2, 8, 4); rect(ctx, '#7a6a52', x + w / 2 - 3, y + h / 2 - 1, 6, 2); // tirador
    rect(ctx, '#15121f', x + 1, y + 6, 2, 3); rect(ctx, '#15121f', x + 1, y + h - 9, 2, 3); // bisagras
  },
  // Charco de luz de la farola sobre el suelo (translúcido, en escalones de píxeles).
  lamp(ctx, x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2;
    ctx.fillStyle = 'rgba(255, 224, 138, 0.07)'; pixelDisc(ctx, cx, cy, 15);
    ctx.fillStyle = 'rgba(255, 224, 138, 0.08)'; pixelDisc(ctx, cx, cy, 11);
    ctx.fillStyle = 'rgba(255, 224, 138, 0.10)'; pixelDisc(ctx, cx, cy, 7);
  },
  // Base de la alcantarilla: el agujero oscuro con su marco (la tapa la dibuja sewer.js y se desliza).
  // Pozo de la escalera (cuarto de servicio y final del túnel): boca oscura con dos largueros y peldaños.
  ladder(ctx, x, y, w, h) {
    rect(ctx, K, x + 2, y + 1, w - 4, h - 2);
    rect(ctx, '#05030a', x + 3, y + 2, w - 6, h - 4);
    rect(ctx, '#9aa0b8', x + 4, y + 2, 1, h - 4);
    rect(ctx, '#9aa0b8', x + w - 5, y + 2, 1, h - 4);
    for (let yy = y + 4; yy < y + h - 3; yy += 3) rect(ctx, '#c9c3e6', x + 4, yy, w - 8, 1);
    rect(ctx, '#ffbe0b', x + 2, y + 1, w - 4, 1); // marco de aviso
    rect(ctx, '#ffbe0b', x + 2, y + h - 2, w - 4, 1);
  },
  sewer(ctx, x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2;
    ctx.fillStyle = '#0a0712'; pixelDisc(ctx, cx, cy, 11);
    ctx.fillStyle = '#2a2540'; pixelDisc(ctx, cx, cy, 10);
    ctx.fillStyle = '#04030a'; pixelDisc(ctx, cx, cy, 8);
    ctx.fillStyle = '#0b2a2a'; pixelDisc(ctx, cx, cy + 1, 5);
  },
  // Pilar de piedra del túnel (2×2): bloque con juntas y musgo; sirve de cobertura y de cebo para la embestida del cocodrilo.
  pillar(ctx, x, y, w, h, rnd) {
    box(ctx, '#3a4658', x + 1, y + 1, w - 2, h - 2);
    rect(ctx, '#556377', x + 2, y + 2, w - 4, 2);
    rect(ctx, '#2a3342', x + 2, y + h - 5, w - 4, 3);
    for (let i = 1; i < 3; i++) rect(ctx, '#2a3342', x + 2, y + Math.floor((h * i) / 3), w - 4, 1);
    dots(ctx, '#2f6a4a', x + 2, y + 2, w - 4, h - 4, 8, rnd);
  },
  debris(ctx, x, y, w, h, rnd) {
    for (let i = 0; i < 6; i++) {
      const s = 1 + Math.floor(rnd() * 3);
      rect(ctx, rnd() < 0.5 ? '#4a4560' : '#2e2a40', x + 2 + Math.floor(rnd() * 11), y + 2 + Math.floor(rnd() * 11), s, s);
    }
    dots(ctx, '#3a3550', x, y, w, h, 12, rnd);
  },
  trash(ctx, x, y, w, h, rnd) {
    ctx.fillStyle = K; pixelDisc(ctx, x + 6, y + 9, 4);
    ctx.fillStyle = '#22222c'; pixelDisc(ctx, x + 6, y + 9, 3);
    rect(ctx, '#3a3a48', x + 4, y + 7, 2, 1);
    dots(ctx, '#c9c3e6', x + 7, y + 3, 8, 10, 4, rnd);
    rect(ctx, '#ffbe0b', x + 11, y + 11, 2, 1);
  },
  stain(ctx, x, y, w, h, rnd) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = rnd() < 0.5 ? '#3a2410' : '#0c1f1c';
    pixelDisc(ctx, x + 8, y + 8, 5);
    pixelDisc(ctx, x + 5 + rnd() * 6, y + 5 + rnd() * 6, 3);
    ctx.globalAlpha = 1;
  },
  papers(ctx, x, y, w, h, rnd) {
    for (let i = 0; i < 3; i++) {
      const px = x + 2 + Math.floor(rnd() * 9), py = y + 2 + Math.floor(rnd() * 9);
      rect(ctx, '#b8b0d0', px, py, 4, 3);
      rect(ctx, '#7a7499', px + 1, py + 1, 2, 1);
    }
  },
};

// --- Capas ----------------------------------------------------------------------------------

export function renderFloor(map) {
  const c = makeLayer(map);
  const ctx = c.getContext('2d');
  const rnd = seededRandom(map.w * 977 + map.h * 131); // desgaste siempre igual
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (isStructuralWall(map, tx, ty)) continue;
      const zone = map.zone[ty * map.w + tx];
      (FLOORS[zone] || FLOORS.concrete)(ctx, tx, ty, rnd);
      // Pasillos: basura acumulada en las esquinas (casillas con dos paredes contiguas).
      if (zone === map.floor) {
        const walls = [[0, -1], [0, 1], [-1, 0], [1, 0]].filter(([dx, dy]) => isStructuralWall(map, tx + dx, ty + dy)).length;
        if (walls >= 2 && !isWallTile(map, tx, ty) && rnd() < 0.6) DECO_ART.trash(ctx, tx * PX, ty * PX, PX, PX, rnd);
      }
    }
  }
  for (const p of map.props) {
    if (DECO_ART[p.type]) DECO_ART[p.type](ctx, p.x * PX, p.y * PX, p.w * PX, p.h * PX, rnd);
  }
  // Sombras duras abajo-derecha: paredes (3 px) y muebles sólidos (2 px).
  ctx.fillStyle = 'rgba(5, 0, 15, 0.6)';
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (isStructuralWall(map, tx, ty)) ctx.fillRect(tx * PX + 3, ty * PX + 3, PX, PX);
    }
  }
  ctx.fillStyle = 'rgba(5, 0, 15, 0.45)';
  for (const p of map.props) if (p.solid && p.type !== 'bike') ctx.fillRect(p.x * PX + 3, p.y * PX + 3, p.w * PX - 2, p.h * PX - 2);
  return c;
}

// Muebles sólidos: capa propia que se dibuja sobre la sangre y bajo los personajes.
export function renderProps(map) {
  const c = makeLayer(map);
  const ctx = c.getContext('2d');
  const rnd = seededRandom(map.w * 31 + map.h * 7 + 5);
  for (const p of map.props) {
    if (p.solid && PROP_ART[p.type]) PROP_ART[p.type](ctx, p.x * PX, p.y * PX, p.w * PX, p.h * PX, rnd);
  }
  return c;
}

// Paredes (solo las estructurales: los muebles no llevan tubo neón) con deterioro: ladrillo
// visto, manchas, cables sueltos y grafitis mínimos. Devuelve { walls, glow }.
// Valla del perímetro (límite duro del mapa): rejilla metálica oscura con postes, sin el neón de los muros.
function drawFence(ctx, x0, y0, tx, ty) {
  rect(ctx, '#15111f', x0, y0, PX, PX);
  rect(ctx, '#2c2840', x0, y0 + 2, PX, 1);
  rect(ctx, '#2c2840', x0, y0 + PX - 4, PX, 1);
  for (let i = 1; i < PX; i += 3) rect(ctx, '#3e3960', x0 + i, y0, 1, PX);
  if ((tx + ty) % 4 === 0) rect(ctx, '#5a5480', x0 + 6, y0, 3, PX); // poste
  rect(ctx, '#0a0812', x0, y0 + PX - 1, PX, 1);
}

export function renderWalls(map) {
  const walls = makeLayer(map);
  const glow = makeLayer(map);
  const ctx = walls.getContext('2d');
  const g = glow.getContext('2d');
  const rnd = seededRandom(map.w * 53 + map.h * 11 + 1);
  const edges = [];
  const solid = (tx, ty) => isStructuralWall(map, tx, ty);

  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (!solid(tx, ty)) continue;
      const x0 = tx * PX, y0 = ty * PX;
      if (tx === 0 || ty === 0 || tx === map.w - 1 || ty === map.h - 1) { drawFence(ctx, x0, y0, tx, ty); continue; } // límite del mapa
      // Cara superior: ladrillo oscuro con juntas y brillo arriba-izquierda.
      rect(ctx, '#2a0d3a', x0, y0, PX, PX);
      ctx.fillStyle = '#1d0829';
      for (let r = 0; r < 4; r++) {
        ctx.fillRect(x0, y0 + r * 4 + 3, PX, 1);
        const off = (r + ty) % 2 ? 4 : 12;
        ctx.fillRect(x0 + off, y0 + r * 4, 1, 3);
      }
      ctx.fillStyle = '#3c1450';
      for (let r = 0; r < 4; r++) ctx.fillRect(x0, y0 + r * 4, PX, 1);

      const open = { top: !solid(tx, ty - 1), bottom: !solid(tx, ty + 1), left: !solid(tx - 1, ty), right: !solid(tx + 1, ty) };
      const facesRoom = open.top || open.bottom || open.left || open.right;
      // Deterioro (solo en paredes que se ven desde una sala o pasillo).
      if (facesRoom) {
        const roll = rnd();
        if (roll < 0.16) {
          // Ladrillo visto bajo el enlucido caído.
          const bx = x0 + 2 + Math.floor(rnd() * 6), by = y0 + 3 + Math.floor(rnd() * 5);
          for (let i = 0; i < 3; i++) rect(ctx, i % 2 ? '#6a2634' : '#5a1f2c', bx + (i % 2) * 2, by + i * 3, 5, 2);
        } else if (roll < 0.3) {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = '#0a0410';
          pixelDisc(ctx, x0 + 4 + rnd() * 8, y0 + 4 + rnd() * 8, 2 + rnd() * 2);
          ctx.globalAlpha = 1;
        } else if (roll < 0.36) {
          // Grafiti mínimo: un garabato de neón apagado.
          ctx.fillStyle = rnd() < 0.5 ? '#3a8a95' : '#a08020';
          let gx = x0 + 3 + Math.floor(rnd() * 4), gy = y0 + 5 + Math.floor(rnd() * 4);
          for (let i = 0; i < 7; i++) { ctx.fillRect(gx, gy, 1, 1); gx += 1; gy += rnd() < 0.5 ? -1 : 1; gy = Math.max(y0 + 3, Math.min(y0 + 12, gy)); }
        }
        // Cable suelto colgando a lo largo de un borde.
        if (rnd() < 0.1) {
          ctx.fillStyle = '#05030a';
          const sag = [0, 1, 1, 2, 2, 2, 1, 1, 0];
          if (open.bottom) for (let i = 0; i < 16; i++) ctx.fillRect(x0 + i, y0 + PX - 4 - sag[Math.floor(i / 2)], 1, 1);
          else if (open.right) for (let i = 0; i < 16; i++) ctx.fillRect(x0 + PX - 4 - sag[Math.floor(i / 2)], y0 + i, 1, 1);
        }
      }

      // Bordes que dan al suelo: tubo neón de 2 px (brillante + medio).
      const neon = (x, y, w, h, ix, iy) => {
        rect(ctx, '#ff2a85', x, y, w, h);
        rect(ctx, '#9c1a5a', x + ix, y + iy, w, h);
        edges.push([x, y, w, h]);
      };
      if (open.top) neon(x0, y0, PX, 1, 0, 1);
      if (open.bottom) neon(x0, y0 + PX - 1, PX, 1, 0, -1);
      if (open.left) neon(x0, y0, 1, PX, 1, 0);
      if (open.right) neon(x0 + PX - 1, y0, 1, PX, -1, 0);
    }
  }

  // Glow: los mismos bordes con desenfoque; al escalar sin suavizado queda un halo "en bloques".
  g.shadowColor = COLORS.wall;
  g.shadowBlur = 6;
  g.fillStyle = COLORS.wall;
  for (let pass = 0; pass < 2; pass++) for (const [x, y, w, h] of edges) g.fillRect(x, y, w, h);
  return { walls, glow };
}

// --- Penumbra (piso 7) ---------------------------------------------------------------------------------------------------------------------------
// Capa estática a media resolución (1 px = 2 unidades): oscurece las casillas de `map.dark` (más suave alrededor de las luces) y suma el resplandor
// neón de cada luz. Se dibuja sobre enemigos y objetos y bajo el jugador, así que el jugador siempre se ve y los demás se difuminan en la sombra.
export function renderDark(map) {
  const S = TILE / 2; // píxeles de la capa por casilla
  const c = document.createElement('canvas');
  c.width = map.pixelW / 2; c.height = map.pixelH / 2;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (!map.dark[ty * map.w + tx]) continue;
      // más claro cerca de las luces (borde del charco)
      let near = 99;
      for (const l of map.lights) near = Math.min(near, Math.hypot(tx - Math.floor(l.x / TILE), ty - Math.floor(l.y / TILE)) - l.r);
      const a = near < 1.6 ? 0.34 + 0.26 * Math.max(0, near / 1.6) : 0.6;
      ctx.fillStyle = `rgba(3,0,12,${a})`;
      ctx.fillRect(tx * S, ty * S, S, S);
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const l of map.lights) {
    ctx.fillStyle = l.color;
    const R = Math.round((l.r * TILE) / 2);
    for (let k = 4; k >= 1; k--) { // anillos concéntricos de píxeles: resplandor escalonado
      ctx.globalAlpha = 0.035;
      const rr = Math.round((R * k) / 4);
      for (let y = -rr; y <= rr; y += 2) { const half = Math.floor(Math.sqrt(rr * rr - y * y)); ctx.fillRect(Math.round(l.x / 2) - half, Math.round(l.y / 2) + y, half * 2, 2); }
    }
  }
  return c;
}
