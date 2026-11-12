import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas en el build: el juego funciona igual en la raíz de un dominio que en una
  // subcarpeta como GitHub Pages (https://<usuario>.github.io/hotline-clone/).
  base: './',
});
