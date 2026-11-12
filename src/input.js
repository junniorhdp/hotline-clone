// Teclado + ratón. `keys`/`mouse.left` = mantenido; `pressed`/`mousePressed` = pulsado
// desde el último paso de simulación (se limpia con endStep()).
const BLOCKED_DEFAULTS = new Set(['F1', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false };
    this.mousePressed = { left: false, right: false };

    window.addEventListener('keydown', (e) => {
      if (BLOCKED_DEFAULTS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });
    // Evita que F1 abra la ayuda del navegador.
    window.addEventListener('help', (e) => e.preventDefault());

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.left = true; this.mousePressed.left = true; }
      if (e.button === 2) { this.mouse.right = true; this.mousePressed.right = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
  }
}
