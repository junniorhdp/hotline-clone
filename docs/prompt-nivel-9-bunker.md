# Prompt · Tanda 3 de 3 — Nivel 9 · EL BÚNKER (BLINDADOS)

Rama: `feature/sewer-and-camera`. Última tanda de la ampliación (pisos 7 a 9).

## Objetivo
Crear el piso 9 (`PISO 9 · EL BÚNKER`) con un enemigo nuevo, el **blindado**: guardia pesado con un **escudo frontal** que obliga al jugador a flanquearlo o a usar armas de mayor impacto.

## Requisitos
1. **Enemigo blindado** (letra `Z`, `kind 'shield'`, `shield.js`): subfusil, ×0,82 de velocidad, avanza despacio mientras apunta. Golpes de **frente** rebotan (pistola y cuerpo a cuerpo); el subfusil desgasta el escudo (0,25 por bala) y la escopeta lo revienta (0,6 por perdigón; 4 de resistencia); roto, muere como un guardia normal. Por la **espalda o los costados** cae de un golpe. Un arma lanzada, un portazo o los puños por detrás lo **derriban**. Dibujo de la placa con grietas y destello; aviso `¡BLINDADO! ¡FLANQUÉALO!` la primera vez que algo rebota.
2. **Diseño**: gran sala central con barricadas rodeables y seis salas laterales, 13 enemigos (3 blindados, 1 pesado, 2 corredores y armados), 2 escopetas garantizadas.
3. **Se mantiene todo lo anterior**: rehenes (moto con 1, auto de extracción con 2+ y su atropello), IA táctica, frases por género / cadáver / máscara, salida de la moto al azar, aviso de rehenes pendientes.
4. **Validación** (`npm run check:levels`): conectividad, patrullas sin cruzar puertas, rehenes alcanzables, al menos 2 blindados con espacio para flanquearlos, escopeta en el suelo y no menos enemigos que el piso anterior. `npm run build` y `check:levels` deben pasar sin coste apreciable por fotograma.
