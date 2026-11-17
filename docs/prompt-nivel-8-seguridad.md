# Prompt · Tanda 2 de 3 — Nivel 8 · SEGURIDAD Y CÁMARAS

Rama: `feature/sewer-and-camera`. Añade **solo el piso 8**; el piso 9 (búnker y blindados) es otra tanda.

## Objetivo
Crear el piso 8 (`PISO 8 · SEGURIDAD`) con **cámaras de seguridad giratorias** y un **operador de cámaras** sentado frente a los monitores de una sala de control, con una mecánica de sigilo: si una cámara te ve, el operador da la alerta general por walkie-talkie; si lo eliminas antes, las cámaras quedan ciegas.

## Requisitos
1. **Cámaras** (`def.cameras`: casilla de pared, rumbo, barrido, velocidad; `cameras.js`): cono de 240 u / ±0,4 rad que barre; indicador que sube 0,6 s con el jugador a la vista (línea de visión) y decae si sale. Conos ámbar en el suelo, rojos al detectar; cuerpos en las paredes con piloto parpadeante.
2. **Operador** (letra `O`, `kind 'operator'`, siempre sentado, desarmado, camisa verde azulada, auricular): al llenarse el indicador saca el walkie (1,3 s, `¡INTRUSO EN LA CÁMARA!`) y da la **ALERTA GENERAL**: todos los enemigos vivos corren hacia donde te vio la cámara (`Game.generalAlarm`, desfasados hasta 0,8 s; se reparte el pathfinding con el presupuesto por fotograma). Mientras una cámara te siga viendo repite la posición cada 6 s. Si el propio operador te ve, también da la alerta general.
3. **Contraataque**: si **matas** al operador (por cualquier causa), las cámaras quedan **ciegas** (`CÁMARAS CIEGAS`, +500 si aún no había saltado la alarma). Si lo matas o lo tumbas **durante** el aviso, el aviso se corta (`¡AVISO CORTADO!`). Con el operador tumbado no se da el aviso.
3. **Diseño**: pasillo central con 5 salas arriba y 4 abajo; la **sala de control** (arriba a la derecha, suelo metálico, tres monitores y consola) tiene dos puertas. 13 enemigos (2 corredores, armados), 7 cámaras cubriendo pasillo y salas.
4. **Se mantiene** todo lo anterior: rehenes (moto / auto de extracción y atropello), IA táctica, frases por género / cadáver / máscara, salida de la moto al azar.
5. **Validación** (`npm run check:levels`): conectividad, patrullas sin cruzar puertas, cámaras en pared con el origen del cono libre, exactamente 1 operador sentado, alcanzable y a ≥ 20 casillas de la entrada, y que no haya menos enemigos que en el piso anterior. `npm run build` y `check:levels` deben pasar sin coste apreciable por fotograma.

## Fuera de esta tanda
Enemigo con escudo (piso 9); cambios al jefe del piso 6.
