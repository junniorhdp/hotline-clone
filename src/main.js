import './style.css';
import { Game } from './game.js';

const game = new Game(document.getElementById('game'));
game.start();

// Solo en `npm run dev`: permite inspeccionar el juego desde la consola del navegador.
if (import.meta.env.DEV) window.game = game;

// Acceso escondido al CAMPO DE PRUEBAS (nivel para probar armas y futuras mecánicas, ver testrange.js): abrir el juego con `?pruebas` al final de la URL.
if (new URLSearchParams(location.search).has('pruebas')) game.startTestRange();
