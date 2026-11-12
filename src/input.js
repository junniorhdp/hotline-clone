// Teclado + ratón + táctil.
// - `keys`/`mouse.left` = mantenido; `pressed`/`mousePressed` = pulsado desde el último paso de
//   simulación (se limpia con endStep()).
// - Táctil: cada dedo se sigue por su `pointerId` en `touches` (coordenadas CSS relativas al
//   canvas). `isNew` / `ended` duran hasta el siguiente endStep(), así un toque rapidísimo que
//   empieza y acaba entre dos pasos no se pierde. TouchControls (touch.js) los interpreta.
// - Controles virtuales que escribe TouchControls y lee el jugador: `moveAxis`, `aimActive`,
//   `aimAngle`, `aimFiring`.
const BLOCKED_DEFAULTS = new Set(['F1', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false };
    this.mousePressed = { left: false, right: false };

    this.touches = new Map();
    // Modo táctil: activo de entrada en pantallas cuyo puntero principal es un dedo; cambia
    // con lo último que se use (tocar → táctil, ratón o teclado → escritorio).
    this.touchMode = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.moveAxis = { x: 0, y: 0 };
    this.aimActive = false;
    this.aimAngle = 0;
    this.aimFiring = false;

    window.addEventListener('keydown', (e) => {
      if (BLOCKED_DEFAULTS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.touchMode = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
      for (const t of this.touches.values()) t.ended = true;
    });
    // Evita que F1 abra la ayuda del navegador.
    window.addEventListener('help', (e) => e.preventDefault());

    // --- Ratón (eventos de ratón clásicos: gestionan bien varios botones a la vez) ---
    canvas.addEventListener('mousemove', (e) => {
      if (e.sourceCapabilities?.firesTouchEvents) return; // ratón emulado tras un toque
      this.setMouse(e);
      this.touchMode = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.sourceCapabilities?.firesTouchEvents) return;
      this.setMouse(e);
      this.touchMode = false;
      if (e.button === 0) { this.mouse.left = true; this.mousePressed.left = true; }
      if (e.button === 2) { this.mouse.right = true; this.mousePressed.right = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- Táctil (Pointer Events, solo pointerType 'touch' / 'pen') ---
    const isTouch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';
    canvas.addEventListener('pointerdown', (e) => {
      if (!isTouch(e)) return;
      e.preventDefault();
      // Captura: el dedo sigue siendo nuestro aunque salga del canvas. Puede fallar con ids
      // que el navegador no reconoce; no es imprescindible.
      try { canvas.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      const p = this.toCanvas(e);
      this.touches.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, isNew: true, ended: false });
      this.touchMode = true;
    }, { passive: false });
    canvas.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      e.preventDefault();
      const p = this.toCanvas(e);
      t.x = p.x;
      t.y = p.y;
    }, { passive: false });
    const release = (e) => {
      const t = this.touches.get(e.pointerId);
      if (t) t.ended = true;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    // Bloquea scroll, rebote, zoom con dos dedos y doble toque, y los clics de ratón
    // "emulados" que el navegador generaría después de cada toque.
    const block = (e) => e.preventDefault();
    canvas.addEventListener('touchstart', block, { passive: false });
    canvas.addEventListener('touchmove', block, { passive: false });
    canvas.addEventListener('touchend', block, { passive: false });
    document.addEventListener('gesturestart', block); // zoom con pellizco en Safari
  }

  toCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  setMouse(e) {
    const p = this.toCanvas(e);
    this.mouse.x = p.x;
    this.mouse.y = p.y;
  }

  down(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  endStep() {
    this.pressed.clear();
    this.mousePressed.left = this.mousePressed.right = false;
    for (const [id, t] of this.touches) {
      if (t.ended) this.touches.delete(id);
      else t.isNew = false;
    }
  }
}
