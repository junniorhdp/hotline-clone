// Entrada de la build de CrazyGames: el MISMO juego de src/ (sin modificarlo) envuelto con el SDK. No incluye el campo de pruebas ni `window.game`.
import '../../src/style.css';
import { Game } from '../../src/game.js';
import { initSdk, loadingStart, loadingStop, attach } from './sdk.js';

async function boot() {
  await initSdk(); // con límite de tiempo; sin SDK devuelve null y todo sigue
  loadingStart();
  const game = new Game(document.getElementById('game'));
  // CrazyGames pone su propia pantalla completa y PROHÍBE los botones propios: sin rectángulo no se dibuja ni se puede pulsar.
  game.menu.fullscreenRect = () => null;
  attach(game);
  game.start();
  requestAnimationFrame(() => requestAnimationFrame(loadingStop)); // tras el primer fotograma dibujado
}

boot();
