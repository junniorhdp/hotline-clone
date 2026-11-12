import './style.css';
import { Game } from './game.js';

const game = new Game(document.getElementById('game'));
game.start();

// Solo en `npm run dev`: permite inspeccionar el juego desde la consola del navegador.
if (import.meta.env.DEV) window.game = game;
