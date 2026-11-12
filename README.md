# NEON RUSH

Prototipo de acción top-down en pixel art 16-bit con estética neón/synthwave: combate de un solo
golpe, reinicio instantáneo, puertas que se abren de una patada, combos, máscaras con pasivas y
tres pisos de dificultad creciente.

Hecho con **HTML5 Canvas**, **JavaScript Vanilla (ES Modules)** y **Vite**, sin frameworks ni
librerías de juego. Todos los gráficos, la fuente, los efectos de sonido y la música se generan por código.

**Jugar online:** https://junniorhdp.github.io/hotline-clone/ (se publica automáticamente desde `main`).

## Cómo jugar en local

```bash
npm install
npm run dev
```

Abre http://localhost:5173 en el navegador. Para probarlo en el móvil (misma Wi-Fi): `npm run dev -- --host` y abre la dirección "Network".

## Controles

| Tecla | Acción |
|---|---|
| `WASD` | Moverse |
| Ratón | Apuntar |
| Clic izquierdo | Atacar / disparar / rematar |
| Clic derecho | Recoger / lanzar arma |
| `E` | Patada a puerta |
| `R` | Reintentar piso |
| `Enter` (al morir) | Terminar partida |
| `T` | Mejores partidas |
| `M` / `V` / `F1` | Sonido / efectos CRT / modo debug |

## Estructura

Todo el código está en `src/`, un módulo por responsabilidad (juego, jugador, enemigos, mapa,
armas, puertas, partículas, audio, efectos, menú, máscaras, puntuación…). Las reglas de
arquitectura y estilo están en [`CLAUDE.md`](CLAUDE.md).
