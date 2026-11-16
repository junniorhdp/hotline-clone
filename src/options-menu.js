import { drawText, measureText, CELL_H } from './pixelfont.js';
import { OPTIONS, valueText } from './settings.js';
import { COLORS } from './utils.js';
import { KEY_ACTIONS, keyLabel } from './keybinds.js';

// Menús modales de lista, con estética neón (marco doble cian/magenta). Los usa el menú de OPCIONES
// (generado desde `OPTIONS` de settings.js) y el de PAUSA. Viven en `game.panel`: mientras hay uno
// abierto el juego no avanza y los toques son clics (ver game.update y touch.update).
//
// Items:
//   { kind: 'header', label }                       cabecera de sección (no seleccionable)
//   { kind: 'button', label, action }               botón: Enter / clic / toque
//   { kind: 'value', id }                           opción de settings: flechas izq/der (o clic en
//                                                   el lado izquierdo/derecho de su valor) ajustan;
//                                                   Enter o tocar la fila avanza un paso
//   { kind: 'bind', action }                        control de PC reasignable (keybinds.js): dos casillas (principal y
//                                                   secundaria); izq/der eligen casilla y Enter / clic entra en el modo de
//                                                   escucha ("PULSA..."): la siguiente tecla o botón del ratón se asigna,
//                                                   Esc cancela, Supr quita la secundaria
// Control: flechas arriba/abajo (o W/S) navegan · izquierda/derecha (A/D) ajustan · Enter/Espacio acepta · Esc vuelve · el ratón
// selecciona al moverlo y hace clic · un toque = clic.
const DIM = '#7d6f98';
const PANEL_BG = '#0d0221';
const VALUE_W = 74; // ancho del bloque "< valor >" a la derecha de cada fila
const SLOT_W = 60;  // ancho de cada casilla de un control de PC (dos por fila)
const SLOT_GAP = 3;

export class ListMenu {
  constructor(game, { title, items, onBack, hintText }) {
    this.game = game;
    this.title = title;
    this.items = items;
    this.onBack = onBack;
    this.index = items.findIndex((it) => it.kind !== 'header');
    this.mouse = game.mouseInternal();
    this.hintText = hintText || 'FLECHAS: ELEGIR Y AJUSTAR · ESC: VOLVER';
    this.reserveHint = !!hintText; // el menú de controles lleva avisos: reserva la línea inferior también en táctil
    this.bindSlot = 0;     // casilla (0 principal, 1 secundaria) seleccionada en las filas de controles
    this.listen = null;    // { action, slot }: esperando la siguiente tecla / botón del ratón
    this.notice = null;    // { text, color, until }: aviso en la línea inferior
    this.flash = null;     // { action, slot, until }: casilla que se ha intercambiado (parpadea en rojo)
  }

  // Alto de fila y posición de cada item (compartido por dibujo y ratón). Si no cabe, primero se
  // quitan las cabeceras y después se encogen las filas.
  layout() {
    const g = this.game, w = g.scene.width, h = g.scene.height, s = g.safe;
    const touch = g.input.touchMode;
    const wanted = touch ? Math.max(14, Math.round(g.touch.px(40))) : 13;
    const titleH = 4 + CELL_H * 2 + 8;
    const hintH = touch && !this.reserveHint ? 0 : CELL_H + 6;
    const availH = h - 12 - s.t - s.b - titleH - hintH - 10;
    const headerH = 9;
    const rows = this.items.filter((it) => it.kind !== 'header').length;
    const headers = this.items.length - rows;
    let rowH = wanted, showHeaders = true;
    if (rows * rowH + headers * headerH > availH) showHeaders = false;
    if (rows * rowH > availH) rowH = Math.max(10, Math.floor(availH / rows));
    const innerH = rows * rowH + (showHeaders ? headers * headerH : 0);
    const pw = Math.min(w - 12 - s.l - s.r, 290);
    const ph = titleH + innerH + hintH + 10;
    const px = Math.round((w - pw) / 2);
    const py = Math.max(4 + s.t, Math.round((h - ph) / 2));
    let y = py + titleH;
    const rects = this.items.map((it) => {
      if (it.kind === 'header') {
        if (!showHeaders) return null;
        const r = { x: px + 6, y, w: pw - 12, h: headerH };
        y += headerH;
        return r;
      }
      const r = { x: px + 6, y, w: pw - 12, h: rowH };
      y += rowH;
      return r;
    });
    return { px, py, pw, ph, rects, rowH, titleH };
  }

  select(delta) {
    const n = this.items.length;
    let i = this.index;
    for (let k = 0; k < n; k++) {
      i = (i + delta + n) % n;
      if (this.items[i].kind !== 'header') break;
    }
    if (i !== this.index) { this.index = i; this.game.sfx.play('empty'); }
  }

  // Ajusta (dir ±1) o acepta el item `i`. `wrap`: Enter/tocar dan la vuelta en sliders y listas.
  activate(i, dir = 1, wrap = true) {
    const g = this.game, it = this.items[i];
    if (it.kind === 'button') { g.sfx.play('pickup'); it.action(g, this); return; }
    if (it.kind === 'bind') { this.startListen(it.action, this.bindSlot); return; }
    if (it.kind === 'value') {
      g.settings.adjust(it.id, dir, wrap);
      g.sfx.play('empty');
    }
  }

  say(text, color = COLORS.enemy, ms = 2400) {
    this.notice = { text, color, until: performance.now() + ms };
  }

  // Modo de escucha: la fila parpadea "PULSA..." y la siguiente entrada se asigna a la casilla.
  startListen(action, slot) {
    const g = this.game;
    if (g.input.touchMode) { this.say('CONECTA UN TECLADO PARA CAMBIAR CONTROLES'); return; }
    this.listen = { action, slot };
    g.sfx.play('pickup');
  }

  updateListen() {
    const g = this.game, input = g.input, L = this.listen;
    const name = (id) => KEY_ACTIONS.find((a) => a.id === id).label;
    let code = null;
    for (const c of input.pressed) { code = c; break; }
    if (!code) {
      if (input.mousePressed.left) code = 'Mouse0';
      else if (input.mousePressed.right) code = 'Mouse2';
      else if (input.mousePressed.middle) code = 'Mouse1';
    }
    if (!code) return;
    this.listen = null;
    if (code === 'Escape') { this.say('CAMBIO CANCELADO', '#9d8fb8'); return; }
    if (code === 'Backspace' || code === 'Delete') {
      this.say(g.keys.clear(L.action, L.slot) ? 'ENTRADA QUITADA' : 'LA PRINCIPAL NO SE PUEDE QUITAR', '#9d8fb8');
      return;
    }
    const r = g.keys.assign(L.action, L.slot, code);
    if (r.status === 'ok') this.say(name(L.action) + ' = ' + keyLabel(code), COLORS.player);
    else if (r.status === 'swap') {
      this.say(keyLabel(code) + ' ESTABA EN ' + name(r.other) + ': INTERCAMBIADAS', COLORS.enemy);
      this.flash = { action: r.other, slot: r.otherSlot, until: performance.now() + 900 };
    } else if (r.status === 'reserved') this.say(keyLabel(code) + ' ESTÁ RESERVADA', COLORS.blood);
    else if (r.status === 'blocked') this.say(name(r.other) + ' SE QUEDARÍA SIN TECLA', COLORS.blood);
    else if (r.status === 'dup') this.say('YA ESTÁ EN LA OTRA CASILLA', COLORS.blood);
    else this.say('ENTRADA NO VÁLIDA', COLORS.blood);
    g.sfx.play(r.status === 'ok' || r.status === 'swap' ? 'pickup' : 'empty');
  }

  update() {
    const g = this.game, input = g.input;
    if (this.listen) { this.updateListen(); return; }
    const confirm = input.wasPressed('Enter') || input.wasPressed('Space') || input.wasPressed('NumpadEnter');
    if (input.wasPressed('Escape') || input.wasPressed('Backspace')) { g.sfx.play('empty'); this.onBack(g); return; }
    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.select(-1);
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.select(1);
    const cur = this.items[this.index];
    if (cur.kind === 'bind') {
      if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) this.bindSlot = 0;
      if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) this.bindSlot = 1;
    }
    if (cur.kind === 'value') {
      if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) this.activate(this.index, -1, false);
      if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) this.activate(this.index, 1, false);
    }
    if (confirm) this.activate(this.index, 1, true);

    // Ratón / toque: moverlo selecciona; clic (o toque) actúa sobre la fila de debajo.
    const m = g.mouseInternal();
    const moved = Math.hypot(m.x - this.mouse.x, m.y - this.mouse.y) > 0.5;
    this.mouse = m;
    const { rects } = this.layout();
    const hovered = rects.findIndex((r, i) => r && this.items[i].kind !== 'header' && m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h);
    if (hovered >= 0 && (moved || input.mousePressed.left) && hovered !== this.index) { this.index = hovered; g.sfx.play('empty'); }
    if (hovered >= 0 && this.items[hovered].kind === 'bind' && (moved || input.mousePressed.left)) {
      // La casilla bajo el puntero (la derecha = secundaria).
      this.bindSlot = m.x >= rects[hovered].x + rects[hovered].w - SLOT_W - SLOT_GAP / 2 ? 1 : 0;
    }
    if (input.mousePressed.left && hovered >= 0) {
      const r = rects[hovered], it = this.items[hovered];
      if (it.kind === 'bind') this.startListen(it.action, this.bindSlot);
      else if (it.kind === 'value') {
        // En el bloque de valor: mitad izquierda = menos, derecha = más. En el resto de la fila, un paso.
        const vx = r.x + r.w - VALUE_W;
        if (m.x >= vx && it.id && g.settings && this.isSlider(it)) this.activate(hovered, m.x < vx + VALUE_W / 2 ? -1 : 1, false);
        else this.activate(hovered, 1, true);
      } else this.activate(hovered);
    }
  }

  map(action) {
    return this.game.keys.map[action];
  }

  // ¿La opción tiene varios valores (no es un simple sí/no)?
  isSlider(it) {
    const opt = OPTIONS.find((o) => o.id === it.id);
    return !!opt && opt.type !== 'toggle';
  }

  draw(ctx, w, h) {
    const g = this.game;
    const L = this.layout();
    const { px, py, pw, ph, rects } = L;
    const now = performance.now();
    // Fondo atenuado
    ctx.fillStyle = 'rgba(13, 2, 33, 0.84)';
    ctx.fillRect(0, 0, w, h);
    // Marco doble: exterior cian, interior magenta
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(px, py, pw, ph);
    const frame = (x, y, fw, fh, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, fw, 1); ctx.fillRect(x, y + fh - 1, fw, 1);
      ctx.fillRect(x, y, 1, fh); ctx.fillRect(x + fw - 1, y, 1, fh);
    };
    frame(px, py, pw, ph, COLORS.player);
    frame(px + 2, py + 2, pw - 4, ph - 4, COLORS.wall);
    // Título con aberración cromática, como el logo
    const cx = Math.round(w / 2), ty = py + 7;
    drawText(ctx, this.title, cx - 1, ty, { color: COLORS.player, scale: 2, align: 'center', shadow: null });
    drawText(ctx, this.title, cx + 1, ty + 1, { color: COLORS.wall, scale: 2, align: 'center', shadow: null });
    drawText(ctx, this.title, cx, ty, { color: '#ffe6f2', scale: 2, align: 'center', shadow: null });

    const blink = Math.floor(now / 350) % 2 === 0;
    this.items.forEach((it, i) => {
      const r = rects[i];
      if (!r) return;
      if (it.kind === 'header') {
        drawText(ctx, it.label, r.x + 4, r.y + 1, { color: COLORS.enemy });
        ctx.fillStyle = '#3a2a55';
        ctx.fillRect(r.x + 8 + measureText(it.label), r.y + 4, r.w - 12 - measureText(it.label), 1);
        return;
      }
      const sel = i === this.index;
      const ty = r.y + Math.round((r.h - CELL_H) / 2) - 1;
      if (sel) {
        ctx.fillStyle = 'rgba(255, 42, 133, 0.2)';
        ctx.fillRect(r.x, r.y, r.w, r.h - 1);
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(r.x, r.y, 2, r.h - 1);
        if (blink) drawText(ctx, '>', r.x + 4, ty, { color: COLORS.wall });
      }
      const color = sel ? COLORS.text : DIM;
      if (it.kind === 'button') {
        drawText(ctx, it.label, cx, ty, { color: sel ? COLORS.text : COLORS.player, align: 'center' });
        return;
      }
      if (it.kind === 'bind') {
        const def = KEY_ACTIONS.find((a) => a.id === it.action);
        drawText(ctx, def.label, r.x + 14, ty, { color });
        for (let slot = 0; slot < 2; slot++) {
          const bx = slot === 1 ? r.x + r.w - SLOT_W : r.x + r.w - 2 * SLOT_W - SLOT_GAP;
          const by = r.y, bh = r.h - 2;
          const listening = this.listen && this.listen.action === it.action && this.listen.slot === slot;
          const flashing = this.flash && this.flash.action === it.action && this.flash.slot === slot && performance.now() < this.flash.until;
          const picked = sel && this.bindSlot === slot;
          ctx.fillStyle = '#140a24';
          ctx.fillRect(bx, by, SLOT_W, bh);
          ctx.fillStyle = listening ? (blink ? COLORS.wall : '#ffffff') : flashing ? COLORS.blood : picked ? COLORS.player : '#3a2a55';
          ctx.fillRect(bx, by, SLOT_W, 1); ctx.fillRect(bx, by + bh - 1, SLOT_W, 1);
          ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + SLOT_W - 1, by, 1, bh);
          const code = this.map(it.action)[slot];
          const txt = listening ? 'PULSA...' : keyLabel(code);
          drawText(ctx, txt, bx + SLOT_W / 2, by + Math.round((bh - CELL_H) / 2),
            { color: listening ? '#ffffff' : code ? (picked ? COLORS.text : '#9ad6dd') : '#4a3d66', align: 'center' });
        }
        return;
      }
      const opt = OPTIONS.find((o) => o.id === it.id);
      const v = g.settings.get(it.id);
      drawText(ctx, opt.label, r.x + 14, ty, { color });
      // Bloque de valor: "<  valor  >" y, en sliders, una barra de segmentos debajo
      const vx = r.x + r.w - VALUE_W, mid = vx + VALUE_W / 2;
      const arrowColor = sel ? COLORS.wall : '#4a3d66';
      if (opt.type !== 'toggle') {
        drawText(ctx, '<', vx + 2, ty, { color: arrowColor });
        drawText(ctx, '>', vx + VALUE_W - 8, ty, { color: arrowColor });
      }
      const on = opt.type !== 'toggle' || v;
      drawText(ctx, valueText(opt, v), mid, ty, { color: sel ? (on ? COLORS.player : COLORS.enemyBullet) : (on ? '#9ad6dd' : DIM), align: 'center' });
      if (opt.type === 'step') {
        const n = (opt.max - opt.min) / opt.step, filled = Math.round((v - opt.min) / opt.step);
        const bw = VALUE_W - 22, cw = Math.floor(bw / n), bx = Math.round(mid - (cw * n) / 2);
        for (let k = 0; k < n; k++) {
          ctx.fillStyle = k < filled ? (sel ? COLORS.wall : '#7a2a55') : '#2a1c44';
          ctx.fillRect(bx + k * cw, r.y + r.h - 2, cw - 1, 1);
        }
      }
    });
    if (!g.input.touchMode || this.reserveHint) {
      const note = this.notice && performance.now() < this.notice.until ? this.notice : null;
      const hint = this.listen ? 'PULSA UNA TECLA · ESC: CANCELAR · SUPR: QUITAR' : this.hintText;
      drawText(ctx, note ? note.text : hint, cx, py + ph - CELL_H - 6, { color: note ? note.color : DIM, align: 'center' });
    }
  }
}

// --- Constructores de los menús concretos ----------------------------------------------------

// OPCIONES: secciones y filas generadas desde OPTIONS (+ restaurar y volver).
export function buildOptionsMenu(game, onBack) {
  const items = [];
  let section = null;
  for (const o of OPTIONS) {
    if (o.section !== section) { section = o.section; items.push({ kind: 'header', label: section }); }
    items.push({ kind: 'value', id: o.id });
  }
  items.push({ kind: 'button', label: 'CONTROLES (PC)', action: (g) => { g.panel = buildControlsMenu(g, () => { g.panel = buildOptionsMenu(g, onBack); }); } });
  items.push({ kind: 'button', label: 'RESTAURAR VALORES POR DEFECTO', action: (g) => g.settings.reset() });
  items.push({ kind: 'button', label: 'VOLVER', action: (g) => onBack(g) });
  return new ListMenu(game, { title: 'OPCIONES', items, onBack });
}

// CONTROLES (PC): una fila por acción con sus dos casillas (principal y secundaria), restaurar y volver.
export function buildControlsMenu(game, onBack) {
  const items = [];
  let group = null;
  for (const a of KEY_ACTIONS) {
    if (a.group !== group) { group = a.group; items.push({ kind: 'header', label: group }); }
    items.push({ kind: 'bind', action: a.id });
  }
  items.push({ kind: 'button', label: 'RESTAURAR CONTROLES', action: (g, menu) => { g.keys.reset(); menu.say('CONTROLES RESTAURADOS', COLORS.player); } });
  items.push({ kind: 'button', label: 'VOLVER', action: (g) => onBack(g) });
  return new ListMenu(game, { title: 'CONTROLES (PC)', items, onBack, hintText: 'ENTER/CLIC: CAMBIAR · IZQ/DER: CASILLA' });
}

// PAUSA: continuar, opciones y salir al menú principal.
export function buildPauseMenu(game) {
  const resume = (g) => g.closePanel();
  return new ListMenu(game, {
    title: 'PAUSA',
    items: [
      { kind: 'button', label: 'CONTINUAR', action: resume },
      { kind: 'button', label: 'OPCIONES', action: (g) => g.openOptions(() => g.openPause()) },
      { kind: 'button', label: 'SALIR AL MENÚ', action: (g) => { g.closePanel(); g.transition(() => g.openMenu()); } },
    ],
    onBack: resume,
  });
}
