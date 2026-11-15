import { defineConfig } from 'vite';

export default defineConfig({
  // Ruta pública del despliegue: el juego se publica en GitHub Pages como página de proyecto
  // (https://junniorhdp.github.io/hotline-clone/), así que los assets y scripts del build se
  // piden con ese prefijo absoluto.
  base: '/hotline-clone/',
  define: {
    // Versión visible en el título: el commit publicado (GitHub Actions define GITHUB_SHA) o
    // "dev" en local. Sirve para comprobar que el navegador no muestra una versión guardada.
    __APP_VERSION__: JSON.stringify((process.env.GITHUB_SHA || 'dev').slice(0, 7)),
  },
});
