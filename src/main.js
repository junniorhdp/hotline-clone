import './style.css';
import { Game } from './game.js';

const game = new Game(document.getElementById('game'));
game.start();

// Solo en `npm run dev`: permite inspeccionar el juego desde la consola del navegador.
if (import.meta.env.DEV) window.game = game;

// CAMPO DE PRUEBAS (nivel para probar armas y futuras mecánicas, ver testrange.js): EXCLUSIVO DEL EQUIPO. El nivel se carga con un import dinámico DENTRO de la condición de desarrollo, así
// que el build publicado ni lo contiene. Se abre con `?pruebas` al final de la URL de desarrollo o con `game.startTestRange()` desde la consola.
if (import.meta.env.DEV) {
  import('./testrange.js').then((m) => {
    game.testRangeDef = m.TESTRANGE_DEF;
    if (new URLSearchParams(location.search).has('pruebas')) game.startTestRange();
  });
}
