# Prompt · Tanda 1 de 3 — Nivel 7 · ZONA OSCURA (APAGÓN)

Rama: `feature/sewer-and-camera`. Esta tanda añade **solo el piso 7**; los pisos 8 (seguridad y cámaras) y 9 (búnker y blindados) son tandas aparte.

## Objetivo
Crear el piso 7 de la campaña (`LEVELS`, `PISO 7 · APAGÓN`) con **iluminación parcial**: salas y tramos de pasillo en penumbra, charcos de luz neón y enemigos que **ven peor** al jugador cuando este está a oscuras.

## Requisitos
1. **Diseño**: 48×20 interior + exterior estándar (vestíbulo, puerta principal, calle y moto), ~12 enemigos (melee, armados, 2 corredores y 1 guardia pesado), armas garantizadas escopeta, subfusil, tubo y bate. Pasillo central de 2 casillas con salas arriba y abajo, puertas entre salas para flanquear.
2. **Penumbra** (`dark`: rectángulos de casillas; `lights`: `[x, y, color, radio]`):
   - `map.dark` (una máscara por casilla) = casillas a oscuras **salvo** dentro del radio de una luz.
   - **Visión pasiva reducida**: si el jugador está en una casilla a oscuras, un enemigo solo lo ve a **la mitad de `VIEW_DIST`** (el sentido de cercanía `CLOSE_SENSE` se mantiene).
   - **Un ruido del jugador** (disparo, golpe, patada) lo delata 0,8 s aunque esté en la sombra (`map.reveal`).
   - **Dibujo**: capa estática a media resolución (`renderDark`) que oscurece enemigos y objetos y suma el resplandor de las luces; el jugador se dibuja encima, siempre visible.
3. **Se mantiene todo lo anterior**: rehenes (moto con 1, auto de extracción con 2+ y su atropello), IA táctica (ruidos, alarmas, cobertura), frases por género / cadáver / máscara, salida de la moto al azar.
4. **Validación** (`npm run check:levels`): conectividad, patrullas sin cruzar puertas, rehenes alcanzables y separados, y para pisos oscuros: máscara y luces coherentes, entrada / jugador / moto sin oscuridad, mezcla de enemigos en sombra y en luz.
5. `npm run build` y `npm run check:levels` deben pasar; sin coste por fotograma extra apreciable (la penumbra es una capa estática y un `drawImage`).

## Fuera de esta tanda
Cámaras de seguridad, operador de cámaras y alerta general (piso 8); enemigo con escudo (piso 9); cambios al jefe del piso 6.
