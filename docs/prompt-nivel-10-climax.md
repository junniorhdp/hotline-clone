# Prompts · Nivel 10 · EL CLÍMAX (3 tandas)

Rama: `feature/sewer-and-camera`. Se hace en este orden y cada tanda se prueba y se sube antes de empezar la siguiente.
En todas: mantener lo anterior (rehenes, IA táctica, frases, salida de la moto, avisos), pasar `npm run build` y `npm run check:levels`, actualizar `CLAUDE.md`, sin coste apreciable por fotograma en PC y móvil (presupuesto de IA por fotograma).

## Decisiones de diseño (cámbialas aquí si no te gustan)
- **Dos agentes**: JACK y VEX dejan de ser solo cosméticos en este piso: `game.player` es el personaje activo y `game.partner` el otro. Cada uno lleva su **propia máscara** (la del partner se elige entre las ya desbloqueadas, distinta a la del primero si es posible) y su propia sangre acumulada.
- **El jefe del piso 6 no aparece**; el piso 10 no tiene rehenes ni moto de huida: se sale por la puerta principal al acabar (resultados directos).
- **El tiempo** es de 60 s (antes 45), fijo (constante `GAS_TIME`), y **se congela** durante forcejeos, ejecuciones, menús y pausa.
- **Dificultad**: no menos enemigos que el piso 9 (13) entre las dos fases.

---

## Tanda A · Segundo protagonista y relevo (sin gas todavía)
**Objetivo**: poder controlar a dos personajes y cambiar de uno a otro.
1. `game.partner` (instancia de `Player`) con su máscara, género y sangre propios; HUD con los **dos retratos** (el activo resaltado, el otro apagado).
2. `swapControl()`: intercambia `player` y `partner` en un fotograma (cámara con `snap`, entrada limpia, cooldown de 0,25 s). El personaje inactivo **se queda quieto, visible y vulnerable** (puede morir por balas/golpes enemigos; si muere, Game Over normal con mensaje `TU COMPAÑERO HA CAIDO`).
3. Pantalla de selección de máscara del segundo personaje (reutilizar `ELIGE TU MÁSCARA`, con título `MÁSCARA DE APOYO`).
4. Para probarlo sin el piso: tecla de debug que alterne el control (solo con F1 activo).
5. **Criterios**: guardado de récords y `R` no se rompen; el partner reaparece donde estaba al reintentar con `R`; los enemigos y civiles tratan al inactivo como objetivo válido.

## Tanda B · Trampa de gas y contrarreloj
**Objetivo**: el piso 10 con la secuencia de la trampa.
1. **Piso 10 · EL CLÍMAX** (`LEVELS`, `trap: true`): despacho principal sellable (2 puertas, sala de 10×8) con ventilación en la pared, y edificio alrededor con ~13 enemigos y defensas restantes.
2. **Fase 1** (con el primer agente): al entrar en el despacho las puertas se **sellan** (cartel `¡TRAMPA!`) y arranca `GAS_TIME`.
3. **Fase 2**: el control pasa **de inmediato** al segundo agente, que empieza fuera de la sala con su máscara de apoyo. Debe abrirse paso hasta la sala y **romper la ventilación** (interacción con PATEAR/INTERACTUAR mantenida 1,5 s junto a la pared; las puertas se abren al romperla).
4. **Temporizador** visible arriba al centro (rojo y parpadeante bajo 10 s), con **toxicidad progresiva**: tinte verde que crece, tos del agente atrapado, visión con viñeta que se cierra, partículas de gas en el despacho. El partner inactivo se tambalea y cae al final.
5. **Fracaso** (tiempo 0): cinemática corta de **asfixia** (cámara al despacho, el agente cae, pantalla verdosa que se apaga) y pantalla de muerte con mensaje propio (`SE QUEDÓ SIN AIRE`). `R` reintenta desde el inicio de la fase 2.
6. **Éxito**: se rompe la ventilación, el gas se disipa y pasa a la tanda C.
7. **Validación** (`check:levels`): despacho sellable alcanzable desde la entrada, ventilación en pared accesible, camino de la entrada a la ventilación recorrible en < 70 % de `GAS_TIME` a velocidad base.

## Tanda C · Reencuentro y rol final
**Objetivo**: elección de rol y la fase final.
1. **Reencuentro**: cinemática corta, ambos agentes juntos, y pantalla de **elección de rol**:
   - **LIMPIEZA** (el elegido entra en el edificio): despejar los enemigos restantes dentro del edificio; el otro agente cubre desde el exterior (IA aliada simple: dispara a enemigos a la vista desde su posición, no se mueve).
   - **PERÍMETRO** (el elegido se queda fuera): defender el exterior frente a **2 oleadas** de refuerzos que llegan por la calle; el otro agente limpia dentro (IA aliada simple: avanza por sala hasta eliminar enemigos).
2. **Victoria**: en LIMPIEZA, caer todos los enemigos del edificio; en PERÍMETRO, sobrevivir a las 2 oleadas. Ambos terminan en resultados con el rango calculado sobre el total del piso.
3. **Bases para civiles** (sin efecto aún): guardar `game.civilianRecord = { hurt, killed, gifts }` (se actualiza con los eventos ya existentes de la calle) y exponer `civiliansHelp()` que devuelve `'help' | 'neutral' | 'hinder'` según el registro (reglas en un solo lugar, no usado todavía por el exterior).
4. **Validación**: ambos finales alcanzables; el rol elegido se guarda y `R` lo conserva.
