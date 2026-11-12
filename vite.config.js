import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas en el build: el juego funciona igual en la raíz de un dominio que en una
  // subcarpeta como GitHub Pages (https://<usuario>.github.io/hotline-clone/).
  base: './',
  define: {
    // Versión visible en el título: el commit publicado (GitHub Actions define GITHUB_SHA) o
    // "dev" en local. Sirve para comprobar que el navegador no muestra una versión guardada.
    __APP_VERSION__: JSON.stringify((process.env.GITHUB_SHA || 'dev').slice(0, 7)),
  },
});
