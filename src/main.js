import './style.css';
import { Game } from './game.js';

const game = new Game(document.getElementById('game'));
game.start();

// Solo en `npm run dev`: permite inspeccionar el juego desde la consola del navegador.
if (import.meta.env.DEV) window.game = game;

// CAMPO DE PRUEBAS (nivel para probar armas y futuras mecánicas, ver testrange.js): EXCLUSIVO DEL EQUIPO, solo existe con `npm run dev` (en el build publicado este código no está).
// Se abre con `?pruebas` al final de la URL de desarrollo o con `game.startTestRange()` desde la consola.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('pruebas')) game.startTestRange();
