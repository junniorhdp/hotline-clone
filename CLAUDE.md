# NEON RUSH — prototipo top-down 2D

Prototipo de acción top-down (combate letal de un golpe, reinicio instantáneo) hecho con
HTML5 Canvas, JavaScript Vanilla (ES Modules) y Vite. Sin frameworks ni librerías de juego.

## Comandos
- `npm run dev` — servidor de desarrollo (http://localhost:5173). En dev el juego está en `window.game`.
- `npm run dev -- --host` — igual, pero accesible desde el móvil en la misma red (usa la URL "Network").
- `npm run build` — build de producción en `dist/`. `vite.config.js` fija `base: '/hotline-clone/'`
  (la subcarpeta de GitHub Pages), así que los assets se piden con ese prefijo absoluto: el build
  solo funciona servido desde esa ruta, no abriendo `dist/index.html` como archivo local.
- Despliegue: cada push a `main` compila y publica en GitHub Pages (`.github/workflows/deploy.yml`:
  `npm ci` → `npm run build` → `upload-pages-artifact` con `dist` → `deploy-pages`)
  → https://junniorhdp.github.io/hotline-clone/ . En Settings → Pages la fuente debe ser
  "GitHub Actions". El workflow también se puede lanzar a mano (`workflow_dispatch`).
- `npm run preview` — sirve el build en http://localhost:4173/hotline-clone/
- Versión: `vite.config.js` define `__APP_VERSION__` (commit de GitHub Actions o "dev") y el título
  la muestra arriba a la izquierda, para comprobar que el navegador no sirve una copia guardada
  (GitHub Pages permite cachear la página ~10 min).

## Arquitectura (reglas)
- Todo el código del juego vive en `src/` y es modular, un módulo por responsabilidad:
  - `main.js` — punto de entrada: crea el `Game` y lo arranca. Nada de lógica aquí.
  - `game.js` — game loop, cámara, hit-stop, estado global, colisiones entre entidades
    (balas, armas lanzadas, puertas), muertes/derribos (`killEnemy` → `bleed`: sangre permanente en
    suelo y paredes), render de la escena y HUD.
  - `player.js` — movimiento, apuntado, ataque, remate, patada, recoger/lanzar armas.
  - `enemy.js` — IA de enemigos (patrulla, visión, persecución, búsqueda, derribado) y tipo armado.
  - `doors.js` — puertas batientes: física de la hoja, empuje, patada y derribo.
  - `map.js` — tilemap, colisiones AABB con sliding, raycast/línea de visión (paredes + puertas),
    pathfinding BFS, pisos (`LEVELS`), zonas de suelo y muebles sólidos en la cuadrícula.
  - `weapons.js` — definiciones de armas (`WEAPON_DEFS`, `ENEMY_GUN`), `Pickup`, `Bullet`, utilidades de melee.
  - `particles.js` — chispas, polvo, sangre, restos (`gibs`), chispas de neón (`neon`) y casquillos
    persistentes; `gore()` lanza todo lo de una baja. Las gotas y los restos, al caer, se hornean
    en la capa de sangre (ver "Sangre y ejecuciones").
  - `audio.js` — SFX, música y ambiente procedimentales con Web Audio (osciladores + ruido
    filtrado). Sin archivos de audio. Ver "Música y ambiente".
  - `decor.js` — arte estático del entorno: texturas de suelo por zona, muebles, decoración de
    suelo y deterioro de paredes (`renderFloor`, `renderProps`, `renderWalls`).
  - `menu.js` — menú principal arcade (título, selector de pisos, récords) y su fondo synthwave.
  - `masks.js` — máscaras (`MASKS`): nombre, descripción de la pasiva, retrato pixel art 12×12
    (de frente, para menú y HUD) con paleta propia y `effects`. `maskEffects(mask)` devuelve los
    efectos con valores por defecto. La cabeza cenital de partida vive en `sprites.js`.
  - `score.js` — combos (ventana `COMBO_WINDOW` = 3,5 s), puntos por estilo (`STYLE`), popups,
    rango S/A/B/C por piso, combo máximo de la partida. No toca `localStorage`.
  - `scores-history.js` — Top 5 histórico de partidas en `localStorage` (ver "Guardado de récords").
  - `effects.js` — escala la escena de baja resolución a la pantalla (sin suavizado) y aplica el
    post-proceso CRT/VHS: aberración cromática, banda VHS, scanlines por fila de píxel y viñeta.
  - `sprites.js` — sprites pixel art como cuadrículas de texto + paleta, horneados a bitmaps una vez;
    incluye el cuerpo y las cabezas cenitales de las máscaras, con sus variantes de sangre
    (`MASK_HEADS`/`MASK_SKINS`/`OUTFITS`, ver "Máscaras"); helpers `drawSprite`, `drawMaskHead`,
    `playerBody`, `pixelRect`, `pixelDisc`, `snap`.
  - `pixelfont.js` — fuente bitmap 5×7 propia (con tildes y Ñ) y `drawText`; cachea cada texto renderizado.
  - `input.js` — teclado, ratón y dedos (Pointer Events); distingue "mantenido" de "pulsado este paso".
  - `touch.js` — controles táctiles: joysticks flotantes y botones; traduce dedos a la entrada del juego.
  - `utils.js` — paleta de colores y helpers matemáticos/geométricos.
- Game loop con paso fijo a 60 FPS: `requestAnimationFrame` + acumulador de `deltaTime`;
  `update(dt)` siempre recibe `1/60`. El render ocurre una vez por frame.
- Las entidades no se conocen entre sí directamente: reciben `game` en `update(dt, game)`
  y usan sus métodos (`killEnemy`, `knockDown`, `killPlayer`, `kickDoor`, `enemyShoot`,
  `makeNoise`, `playAt`, ...). Cualquier impacto nuevo debe pasar por esos métodos para que
  reciba sangre, partículas, sonido, shake y hit-stop de forma consistente.
- Las colisiones con paredes usan AABB contra el grid, resolviendo eje X y luego Y
  (sliding) más un empujón de esquina (`CORNER_TOLERANCE`) para no trabarse en puertas.
- `map.doors` apunta a las puertas vivas: `lineOfSight`/`castRay` las tratan como opacas.
- Render: todo se dibuja en un canvas offscreen (`game.scene`) y `ScreenFx.compose` lo pasa
  al canvas visible aplicando los efectos. El HUD también va dentro de la escena.
- Reiniciar (`R`) llama a `game.restartLevel()`: devuelve la puntuación a la que había al entrar
  al piso y llama a `game.reset()`, que reconstruye entidades, puertas y partículas y limpia la
  sangre, sin recargar la página. Audio, efectos y `Score` persisten entre reinicios.

## Niveles y flujo
- Los pisos están en `LEVELS` (`src/map.js`): `{ name, floor, par, rows, zones, props, loot, … }`.
  `par` = tiempo objetivo (s); `zones`/`props`: ver "Diseño de niveles".
  Leyenda del tilemap: `#` pared · `.` suelo · `D` puerta · `P` jugador · `X` salida ·
  `E`/`A` enemigo melee/armado (patrulla en el eje más largo) · `V`/`W` melee/armado con patrulla
  vertical forzada (para cruzar patrullas) · `B` bate · `G` pistola · `S` escopeta ·
  `K` cuchillo · `T` tubo · `M` subfusil · `?` arma aleatoria (ver "Reparto de armas").
  `loadLevel` valida anchos de fila, `P`, `X` y la colocación de los muebles.

## Diseño de niveles: edificio abandonado tomado por la mafia
- **Arquitectura**: cada piso es un edificio coherente. Pasillos principales de **2 casillas** de
  ancho (cemento) que conectan **habitaciones reales cerradas por puertas** (despachos, oficinas,
  baños, cocinas, almacenes, archivos, salas de servidores, vigilancia, salas de estar, casino…).
  Algunas salas se comunican entre sí con una segunda puerta para dar rutas de flanqueo.
- **Zonas de suelo** (`zones` en `LEVELS`: `[tipo, x0, y0, x1, y1]`; el resto usa `floor`, el
  cemento de los pasillos). Tipos (texturas en `FLOORS` de `decor.js`): `concrete` (cemento
  agrietado con juntas, grietas y manchas de óxido/humedad), `brokenTiles` (baldosas rotas, algunas
  faltan), `wood` (tablones gastados), `carpet` (moqueta de oficina), `bathTiles` (azulejos
  pequeños sucios con verdín) y `metal` (chapa antideslizante con óxido).
- **Mobiliario** (`props`: `[tipo, x, y, ancho, alto]` en casillas):
  - Sólidos (`SOLID_PROPS` en `map.js`): `desk`, `deskFlipped`, `counter` (mostrador/barra),
    `sofa`, `cashTable` (maletín con dinero/paquetes), `shelf`, `tv` (CRT roto), `cabinet`,
    `crates`, `barrel`, `toilet`, `sink`, `cardTable`, `bed`. Ocupan casillas enteras y se marcan
    en la cuadrícula como celda `2`: bloquean movimiento, **balas** (son cobertura) y visión, y la
    IA los rodea con el pathfinding.
  - Decorativos (`DECOR_PROPS`, se pintan en el suelo): `rug`, `debris`, `trash`, `stain`, `papers`.
    Además los pasillos generan grietas, manchas y basura en las esquinas automáticamente.
- **Paredes con deterioro** (`renderWalls` en `decor.js`): ladrillo visto, manchas, cables sueltos
  y grafitis mínimos, generados con semilla fija (siempre iguales).
- `isWallTile` = obstáculo (pared **o** mueble sólido); `isStructuralWall` = solo pared del
  edificio (la que lleva tubo neón, proyecta sombra de muro y orienta las puertas).
- **Reglas al diseñar o editar un piso** (`loadLevel` lanza error si se incumplen las tres primeras):
  - Ningún mueble sólido sobre paredes, entidades, `?`, puertas u otro mueble.
  - Las dos casillas de paso de cada puerta, libres.
  - Todo (enemigos, `?`, armas, puertas, salida) alcanzable desde `P`.
  - Las patrullas `E`/`A` no deben cruzar puertas (la patrulla automática sigue el eje más largo
    hasta 7 casillas y atraviesa puertas): colocar al enemigo donde su eje largo quede dentro de la sala.
  - Comprobar después que nadie se atasca simulando movimiento real (`moveAndSlide`) y la
    navegación de los enemigos (`Enemy.goTo`) hacia el jugador, patrullas, armas y salida.

## Pantallas y estados (`game.state`)
Correspondencia entre las pantallas conceptuales y los valores reales de `game.state`:

| Pantalla | `game.state` | Notas |
|---|---|---|
| MENU | `'menu'` | subpantallas en `game.menu.screen`: `'title'`, `'floors'`, `'records'` (`menu.js`) |
| MASK_SELECT | `'masks'` | antes de cada piso; `Esc` vuelve al menú |
| PLAYING | `'playing'` · `'dead'` | `dead`: `R` reintenta (instantáneo), `Enter` termina la partida |
| LEVEL_CLEAR | `'cleared'` → `'results'` | `cleared` = sin enemigos, ve a la salida; `results` = rango/tiempo/puntos |
| GAME_OVER | `'gameover'` | edificio completado o muerte definitiva; Top 5. `Espacio` partida nueva, `Esc` menú |

Flujo: arranque → `menu/title` → JUGAR (o un piso desbloqueado en `floors`) → `startRunAt(i)` →
`masks` → `playing` → `cleared` → pisar `X` → `results` → `Espacio`/`Enter` → `masks` del
siguiente piso (`goToLevel`) … tras el último → `gameover` → `menu` o partida nueva.

### Transiciones
- `game.transition(action, duración = FADE_TIME 0,25 s)`: fundido a `COLORS.background` con barrido
  de una línea rosa y otra cian; `action` cambia de estado con la pantalla en negro.
  Mientras hay fundido el juego está congelado y la entrada se ignora; no se encadenan dos.
- Usan fundido: menú ↔ subpantallas (0,15 s), menú/selector → máscaras, máscaras → piso,
  salida → resultados (`finishFloor`), resultados → siguiente piso / fin, muerte (`Enter`) → fin,
  fin → menú o partida nueva. **`R` NO usa fundido**: reintentar debe ser inmediato.
- En `menu` no se dibuja el piso: `menu.js` pinta el fondo synthwave (cielo en bandas, sol
  rayado, rejilla en perspectiva con `pixelLine`). Los efectos CRT globales siguen activos.

### Selector de pisos y estadísticas por piso
- Piso 1 siempre disponible; el piso N se desbloquea al completar el N-1 (`FloorStats.isUnlocked`).
- Clave `neonrush.floors.v1`: `{ version: 1, floors: { "1": { completed, bestRank, bestScore } } }`
  (`scores-history.js`, misma lectura defensiva que el Top 5). Se actualiza en `finishFloor`.
- Cada tarjeta muestra una miniatura del mapa (1 píxel por casilla: paredes, puertas, enemigos,
  jugador y salida), nº de enemigos/armados, mejor rango y mejor puntuación del piso.
- Empezar en el piso N inicia una partida nueva desde ese piso (puntuación desde 0).

## Guardado de récords (`scores-history.js`)
- Clave `neonrush.scores.v1` en `localStorage`, JSON:
  `{ version: 1, entries: [{ id, score, floor, completed, combo, mask, maskName, date }] }`
  (máx. 5, ordenadas por `score` desc.). `id` = partida (`newRunId()`); `floor` = piso máximo
  alcanzado; `date` = ms epoch (null en entradas heredadas).
- Una partida = una entrada que se **actualiza** (misma `id`): se guarda al completar cada piso
  (`saveRun` en `results`) y al terminar (`endRun`). Partidas con 0 puntos no se guardan.
- Lectura defensiva: JSON corrupto, `entries` que no es array o entradas inválidas se descartan
  (`sanitize`); `Number(null)` no debe colarse como 0. Escritura siempre con try/catch (cuota,
  modo privado o acceso bloqueado → la tabla funciona solo en memoria).
- Datos antiguos: si no existe la clave nueva pero sí `neonrush.highscore` (versión anterior,
  un número), se migra como entrada heredada (piso/combo/máscara "-", fecha "ANTERIOR").
- "¡NUEVO RÉCORD!" = la partida supera el mejor guardado al empezarla (`score.bestBefore`);
  si no, se indica el puesto si entra en el Top 5. Tabla visible en `gameover` y con `T` en la
  selección de máscara o en la pantalla de muerte (`Esc`/`T` cierra).
- Para probar sin ensuciar los récords reales, borrar después `neonrush.scores.v1` y `neonrush.floors.v1`.
- Rango = puntos del piso (incluido bonus de tiempo) / (enemigos × 600): S ≥ 4, A ≥ 2,5, B ≥ 1,2.

## Máscaras (pasivas)
- Diseños propios (no usar personajes/nombres de otros juegos). Todas son máscaras de animal con
  un nombre conceptual corto y en mayúsculas (no el del animal) que describe su pasiva:

| Nombre | `id` | Animal | Pasiva |
|---|---|---|---|
| **NEON** | `neon` | gallo | ninguna: la experiencia clásica, la máscara "de serie" |
| **BRUTE** | `oso` | oso | puñetazos mortales (matan al instante, sin derribar) |
| **STRIKE** | `guepardo` | guepardo | +30 % de velocidad de movimiento |
| **BLADE** | `tiburon` | tiburón | empiezas cada piso con un cuchillo |
| **GHOST** | `buho` | búho | tus balas van +20 % más rápidas y con la mitad de dispersión |

- **El `id` no se cambia nunca**, solo el `name`: lo usan los sprites (`head_<id>`, `body_<id>`) y
  los récords guardados (`mask`). La tabla de récords muestra el nombre **actual** buscando por
  `id` (`MASKS.find`), así las partidas guardadas con un nombre antiguo (OSO, GUEPARDO…) salen
  con el nuevo; `maskName` solo es el respaldo si el `id` ya no existe. Este juego es de un solo
  golpe y no tiene vida, por eso ninguna máscara da "resistencia".
- Flujo: estado `masks` antes de cada piso (al arrancar, tras los resultados con Espacio/Enter
  y al empezar partida nueva). Flechas/A-D o pasar el ratón eligen (el ratón solo cuenta si se
  mueve); Espacio/Enter o clic en la tarjeta confirman. `R` NO abre la selección: reintenta el
  piso con la misma máscara. Durante `masks` la simulación está parada y `R` se ignora.
- Los efectos se aplican creando el `Player` con `maskEffects(game.mask)` (`player.perks`) y su
  aspecto con `game.mask.id` (`player.maskId`). Para añadir una pasiva: nuevo campo en
  `DEFAULT_EFFECTS` + leerlo en `player.js` (o donde toque) vía `this.perks`. Nada de comprobar
  `mask.id` por el código salvo para elegir la cabeza.
- **Dos vistas de la misma máscara, cada una donde se lee mejor**:
  - **Retrato de frente** (`rows` + `palette` en `MASKS`, 12×12, `maskIcon`): cara completa con
    orejas, ojos, hocico y dientes. Es lo que sale en las tarjetas de la selección y en la
    miniatura del HUD. **No tocar estos retratos al cambiar la vista cenital**: son el dibujo
    reconocible de cada máscara.
  - **Cuerpo y cabeza cenitales** (`PLAYER_BODY`/`OUTFITS` y `MASK_HEADS` en `sprites.js`): lo que
    se ve en el piso. El cuerpo (`playerBody(maskId, nivel)`: cazadora cian, mangas y hombros, con
    el hueco de la cabeza en el centro) y encima la cabeza con `drawMaskHead(ctx, maskId, nivel)`,
    que `player.draw` llama con el contexto ya girado al ángulo de apuntado.
  - **Ropa por máscara** (`OUTFITS`): la cazadora cian es la identidad del protagonista y el
    contraste de la cabeza contra el suelo oscuro, así que no se cambia. Lo que varía es la
    **capucha** de la sudadera que asoma tras la nuca (`h`/`H`, gris oscuro) y los **puños** (`x`,
    con el color de la máscara: marrón, naranja, acero, violeta). NEON mantiene el atuendo clásico
    todo cian. No se pasa la cazadora entera a gris: el cuerpo es lo que recorta la cabeza contra
    el suelo oscuro y la identidad cian del jugador (HUD, mira) no debe perderse.
- Reglas de las cabezas cenitales (cuadrículas de 6 filas × 8 columnas, bitmaps `head_<id>`):
  - mirando a +X, la columna 0 es la nuca y la 7 el morro, que sobresale un par de píxeles por
    delante del cuerpo; cubren las columnas 6..13 y las filas 5..10 del sprite del cuerpo
    (constantes `HEAD_X`/`HEAD_OX`/`HEAD_OY`), más estrechas que los hombros para que la cazadora
    siga a la vista;
  - **simétricas respecto al eje de apuntado** (fila 0↔5, 1↔4, 2↔3): la cabeza gira con el
    jugador, así que no vale el sombreado "arriba-izquierda / abajo-derecha" de los demás sprites;
    el volumen se hace con la nuca en sombra (`N`) y las orejas claras (`R`);
  - letras: `K` contorno (#0a0a0f, en el morro y las puntas, que es por donde la cabeza sobresale
    y toca el suelo) · `M` base · `R` luz · `N` sombra · `O` claro (hocico, dientes, pico) ·
    `Q` acento (ojos, nariz, rayas, cresta). El color lo pone `MASK_SKINS`, con los tonos del
    retrato pero un punto más claros y con contraste **contra la cazadora cian** (nada de acentos
    cian: se funden con el cuerpo);
  - cada máscara tiene que leerse por color + un rasgo grande: NEON (gallo) plumas claras con la
    cresta roja recorriendo el centro de la cabeza de atrás a delante y el pico ámbar en el morro
    (de frente, la cresta va arriba y las barbillas bajo el pico) · BRUTE (oso) orejas redondas,
    ojos negros y hocico claro con nariz · STRIKE (guepardo) orejas en punta, manchas, rayas de
    lágrima y hocico crema · BLADE (tiburón) cabeza en cuña y morro blanco · GHOST (búho) ojos
    ámbar enormes y pico naranja.
  - Para añadir una máscara: entrada en `MASKS` (con su retrato) + cuadrícula en `MASK_HEADS` +
    colores en `MASK_SKINS` + ropa en `OUTFITS` (si falta la cabeza o el cuerpo se usa el de NEON).
- HUD: miniatura del retrato (12×12 a ×2) bajo el arma y, debajo del nombre, el contador de
  brutalidad (ver abajo); los resultados muestran la máscara usada.

### Sangre en el personaje
El jugador se va manchando con las bajas de la partida y la máscara también.
- **Acumulación** (`game.gore`, `game.stainPlayer`): cada baja suma la `power` de su `KILL_FEEL`
  (disparo 1, melé 1,35, remate 1,7), así que lo cuerpo a cuerpo mancha más. `bloodLevelFor(gore)`
  (`player.js`) lo traduce en nivel 0..`BLOOD_LEVELS` (5) con `BLOOD_STEPS` = 1, 3, 6, 10, 15: un
  piso tiene 5, 8 y 11 enemigos, así que el primero llega al nivel 2-3, el segundo al 4 y el
  máximo, bien entrado el tercero. Al subir de nivel caen unas gotas sobre el jugador para que se
  note. `player.bloodLevel` es lo que se dibuja.
- **Alcance, igual que la puntuación**: se mantiene al pasar de piso (`goreAtEntry` se actualiza
  en `goToLevel`), al reintentar con `R` vuelve a lo que había al entrar al piso (esas bajas se
  deshacen con su puntuación) y una partida nueva empieza limpia (`startRunAt`).
- **Dibujo** (`sprites.js`): para cada máscara y nivel se hornean, una sola vez, una variante del
  cuerpo (`body_<id>_b<n>`) y otra de la cabeza (`head_<id>_b<n>`) con las manchas encima. Dibujar
  solo elige el bitmap: cuesta lo mismo con sangre que sin ella (medido: 7 ms para hornear los 77
  bitmaps y ~35 µs por jugador dibujado, igual limpio que en el nivel 5).
- **Reglas para que la máscara siga reconociéndose**: cada nivel cubre una fracción exacta y
  creciente de la ropa/pelaje (`BODY_BLOOD`/`HEAD_BLOOD.fractions`; el cuerpo llega al 50 % y la
  cabeza al 42 %); las manchas solo caen sobre píxeles de ropa o pelaje (`BODY_STAINABLE` `jJLhHx`,
  `HEAD_STAINABLE` `MRN`), nunca sobre contornos, ojos, hocico, pico ni cresta; cada nivel contiene
  al anterior (la sangre solo se acumula) y son deterministas por máscara. Con radios en vez de
  fracciones el nivel 5 lo cubría todo y el gallo dejaba de verse (su cresta ya es roja).
- **HUD**: una gota roja por nivel (`BLOOD_LEVELS` huecos) bajo el nombre de la máscara; F1 muestra
  el nivel y la sangre acumulada.

## Música y ambiente (`audio.js`)
- Todo procedimental con Web Audio: ni un archivo de audio. Un planificador con lookahead y
  **un único** `setInterval` (`musicTimer`) para toda la partida programa las notas en el reloj
  de audio; `setMusic(modo)` solo cambia el patrón. Nunca crear intervalos nuevos por
  nivel/reinicio. En silencio (`M`) no se crean nodos: el tiempo avanza pero no suena nada.
- **Dos buses** bajo el master (que es lo que silencia `M`): `musicBus` (percusión, bajo, arpegio
  y pads) y `ambientBus` (el ambiente de piso limpio). Separados a propósito: así la música se
  corta en seco sin tocar el ambiente y cada uno tiene sus propios tiempos de entrada y salida.
- **Tres modos** (`setMusic`), uno por momento del juego:

| Modo | Cuándo | Qué suena |
|---|---|---|
| `action` | `reset()`: cada piso y cada reinicio con `R` | darksynth a 150 BPM: bombo a negras con dos síncopas, charles a semicorcheas, bajo pulsante y arpegio rápido |
| `empty` | al caer el último enemigo (`update`, paso a `cleared`) | nada de música: zumbido sub-grave, estática/aire y ecos metálicos lejanos |
| `menu` | menús y fin de partida | pads lentos y campanas |

- **El corte a vacío** es el momento clave: `setMusic('empty')` baja `musicBus` a cero en
  `CUT_TIME` (0,09 s), lanza el SFX `tapeStop` (frenazo de cinta/VHS: la música se desploma de
  tono y la cinta chasca) por el **master** —para que el corte de la música no se lo lleve— y
  abre `ambientBus` en `AMBIENT_FADE`. El ambiente acompaña hasta la salida y la pantalla de
  resultados; el siguiente piso o `R` vuelven a `action`.
- El ambiente **no va en la rejilla de compases** (`emptyStep` usa marcas de tiempo:
  `droneUntil`, `staticUntil`, `echoAt`): el último enemigo puede caer en cualquier semicorchea y
  el zumbido tiene que entrar en ese instante, no al principio del siguiente ciclo.
- Reglas al tocar el audio: las rampas de ganancia van por `ramp()`, que cancela lo pendiente y
  arranca del valor real (cambiar de piso o reiniciar a toda prisa no debe cruzar
  automatizaciones); nunca una rampa exponencial a 0 (mínimo 0,0001); y `setMusic` antes del
  primer gesto del usuario solo guarda el modo, que `init()` aplica al crear el contexto.

## Mecánicas de combate
- Daño: todo es de un golpe. Lo que cambia es el efecto: **matar** o **derribar** (estado `down`
  ~3,2 s, luego se levanta; se remata con clic izquierdo encima con cualquier arma).
  Cualquier arma **lanzada** (clic derecho) derriba si va a más de 160 px/s.

### Ritmo: el jugador y la IA
Todo está ajustado para que el combate sea frenético (entre paréntesis, el valor anterior).
- **Jugador** (`player.js`): `SPEED` 228 (210). El movimiento ya responde al instante (no hay
  inercia), así que la "aceleración" es un **empujón**: al arrancar desde parado o girar en seco
  (más de ~70° respecto al rumbo anterior) la velocidad sube un `DODGE_BOOST` (+30 %) y cae con
  constante `DODGE_DECAY` (0,13 s). No se acumula (renueva, no suma) y un giro suave (45°) no lo da.
  Se aplica también con joystick y se suma a la pasiva de STRIKE (pico ≈ 385 u/s, crucero 296).
- **Enemigos** (`enemy.js`): patrulla a 84 u/s (70) con un barrido de mirada más amplio y 0,7 s de
  pausa por punto (1 s); investigan a 144 (120) y te persiguen a 192 (172) —el jugador sigue siendo
  más rápido, pero por poco—; `REACTION_TIME` 0,18 s (0,3), golpe cuerpo a cuerpo con `WINDUP`
  0,17 s (0,22) y `ATTACK_COOLDOWN` 0,3 s (0,4); te buscan `SEARCH_TIME` 3,2 s (2,5) y te notan a
  `CLOSE_SENSE` 44 (36) aunque estés a su espalda. Las pausas ante puertas no se han tocado
  (ver "Puertas").
- **Medido** con un enemigo a 200 u con línea de visión directa: el de melé te mata en 1,23 s
  (1,52 s); el armado con pistola dispara a los 0,58 s (0,85 s) y con subfusil a los 0,67 s (0,93 s).
  Si se retoca el ritmo, repetir esa medición.

### Arsenal del jugador (`WEAPON_DEFS` en `weapons.js`)
Alcance en unidades del mundo (1 casilla = 32). Cadencia = segundos entre ataques.

| Arma | Clave | Efecto | Alcance | Cadencia | Munición | Notas |
|---|---|---|---|---|---|---|
| Puños | `fists` | derriba | 24 (arco 99°) | 0,32 s | — | con la máscara BRUTE matan |
| Bate | `bat` | mata | 40 (arco 153°) | 0,42 s | — | el melee de más alcance |
| Tubo de hierro | `pipe` | mata | 36 (arco 135°) | 0,30 s | — | más rápido que el bate |
| Cuchillo | `knife` | mata | 30 (arco 108°) | 0,25 s | — | arma inicial de BLADE |
| Pistola | `gun` | mata | ilimitado | 0,20 s, semiautomática | 6 | dispersión ±0,02 rad |
| Escopeta | `shotgun` | mata | 270 | 0,65 s | 4 | 6 perdigones, dispersión ±0,3 rad |
| Subfusil | `smg` | mata | ilimitado | 0,075 s (≈12 disparos/s), **automático** | 30 | dispersión ±0,12 rad |

- **Indicador de apuntado** (`player.drawAim`, PC y móvil, se dibuja bajo el jugador): armas de
  fuego → línea de puntos hasta la primera pared/puerta/enemigo (tope `AIM_MAX_DIST` o el alcance del
  arma), puntos de 2×2 px y una mira cuadrada de 9×9 px con contorno oscuro al final (donde
  impactaría); la escopeta añade dos líneas finas con su apertura (incluye
  `perks.spreadMul`); sin munición la línea se apaga. Cuerpo a cuerpo → arco de puntos con `range`
  y `arc` del arma. La mira del ratón (PC) se mantiene.
- `auto: true` = dispara mientras se mantiene el clic (si no, un clic = un disparo; el melee
  siempre se puede mantener). Al vaciarse avisa "SIN MUNICIÓN"; se puede lanzar igualmente.
- Toda baja/derribo pasa `cause` (`finisher`, `door`, `thrown`, `melee`, `bullet`, `fists`) a
  `killEnemy`/`knockDown` para puntuar con `score.register`.

### Armas enemigas (`ENEMY_WEAPONS`)
| Arma | Alcance | Aviso (mira láser) | Disparos | Pausa | Suelta |
|---|---|---|---|---|---|
| Pistola | 320 | 0,38 s | 1 | 0,7 s | pistola con 4 balas |
| Subfusil | 280 | 0,45 s | ráfaga de 4 (cada 0,09 s) | 0,95 s | subfusil con 12 balas |

- Si el enemigo pierde la línea de visión, el aviso y la ráfaga se cancelan (cubrirse tras
  esquinas funciona). Al morir o ser derribado suelta su arma.

### Reparto de armas en los pisos
- Puntos `?` del mapa: armas aleatorias. Cada piso define en `LEVELS` `guaranteed` (siempre
  aparecen, en huecos al azar; ahora tubo + subfusil), `loot` (resto de huecos) y `smgChance`
  (probabilidad de que un enemigo armado lleve subfusil: 15% / 35% / 60%).
- El sorteo usa `seededRandom(hashString(runId + piso))`: al reintentar con `R` todo sigue igual;
  en una partida nueva cambia. `loadLevel(index, rng)` acepta cualquier generador 0..1.
- Hit-stop: durante el congelado `update()` devuelve `false` y el bucle NO limpia las pulsaciones,
  para que un clic justo después de un impacto no se pierda.
- **Puertas** (`D` en el mapa, `doors.js`). Reglas de prioridad y física:
  - **El jugador manda.** `game.updateDoors` resuelve primero a los enemigos y **al final al
    jugador**, cuyo empujón (`collide(..., { player: true })`) impone el giro: abre a
    `PLAYER_PUSH_SPEED` (9 rad/s, por encima de `KNOCK_SPEED` 6 → derriba a quien esté detrás) y
    activa `playerLock` (0,4 s) durante el cual ningún enemigo puede cambiar el giro. El jugador
    nunca es derribado ni empujado hacia atrás por un enemigo a través de una puerta.
  - **Patada**: `E`, golpe cuerpo a cuerpo sin enemigo delante o botón ATACAR en táctil
    (`game.kickDoor`) → `KICK_SPEED` 14 rad/s en sentido contrario al jugador + `playerLock`.
  - **Golpe de la hoja** (`sweptHits`): con la puerta girando rápido hacia un enemigo, se
    comprueba todo el arco barrido desde el paso anterior con margen `KNOCK_MARGIN` (7), no solo
    el contacto instantáneo, para conectar con quien llega corriendo. Al estampar, la hoja conserva
    al menos `KNOCK_FOLLOW_SPEED` y `game.doorKnock` aplica derribo (causa `door`, +400 PORTAZO),
    hit-stop `HITSTOP.doorKnock` (70 ms), sacudida, astillas (`particles.splinters`), polvo y sonido.
  - **Enemigos**: al tocar una puerta se paran `DOOR_PAUSE` (0,45 s; 0,25 s persiguiendo) y luego la
    empujan despacio a `ENEMY_PUSH_SPEED` (1,8 rad/s, sin fuerza para derribar) durante
    `DOOR_PUSH_WINDOW`. Mientras están parados solo se giran. Lógica en `Enemy.doorContact()`.
  - `collide` devuelve `'knock'`, `'push'`, `'blocked'` (la toca pero no puede moverla) o `null`.
    En F1 la puerta muestra su velocidad angular y "JUGADOR" mientras está bloqueada por él.
- Hit-stop (`HITSTOP` en `game.js`): baja por disparo 50 ms, baja cuerpo a cuerpo 55 ms, remate
  60 ms, derribo 35 ms, portazo 70 ms, muerte del jugador 120 ms. Con varias bajas o un portazo en
  curso se queda el mayor (`Math.max`), nunca se acorta.

### Sangre y ejecuciones
Cada baja pasa por `killEnemy(e, ángulo, causa)` (y la del jugador por `killPlayer`), que consulta
`KILL_FEEL` (`game.js`) según la causa y llama a `bleed()`:

| Causa | Sangre/restos (`power`) | Salpicado (`wide`) | Sacudida | Hit-stop |
|---|---|---|---|---|
| `bullet` | 1 | cono estrecho (±0,55 rad) | 7 | 50 ms |
| `melee` (tubo, bate, cuchillo, puños de BRUTE) | 1,35 | arco abierto (±0,9) | 10 | 55 ms |
| `finisher` (remate) | 1,7 | en todas direcciones (±π) | 12 | 60 ms |

- `bleed()` = `particles.gore()` (partículas) + `splatBlood()` (suelo) + `splatWalls()` (paredes).
  Una causa nueva sin entrada en `KILL_FEEL` usa la del disparo.
- **Partículas** (`particles.js`, tope `MAX_PARTICLES` 900): `blood` mezcla niebla fina y gotas
  gordas, con una salpicadura hacia atrás (la herida de entrada); `gibs` son restos (carne,
  coágulo, hueso) que rebotan en las paredes, sueltan gotas por el camino y al pararse se
  hornean en el suelo; `neon` son chispas aditivas cian/magenta con estela. El dibujo va en dos
  pasadas (normales y aditivas) para no cambiar de modo de mezcla en cada partícula.
- **Suelo** (capa de sangre, `splatBlood`): charco + charcos satélite + gotas en cono + regueros
  gruesos al principio con una gota al final + arrastre (`bloodSmear`) hacia donde cae el cuerpo.
  Las gotas rápidas dejan una estela corta en su dirección de vuelo (`bake`).
- **Paredes** (capa propia `wallBloodLayer`, dibujada **después** de las paredes y solo cuando hay
  alguna mancha, `wallBloodDirty`): `splatWalls` lanza un abanico de rayos (`castRay`) en la
  dirección del golpe y, donde un rayo llega a una pared del edificio (`isStructuralWall`: no
  muebles ni puertas), `wallSplat` deja una mancha con borde oscuro, gotas y regueros; más grande
  cuanto más cerca. Cada píxel se comprueba contra la pared para no salirse.
- Todo lo permanente (suelo, paredes y `game.stains`, el contador que muestra F1) se borra solo en
  `reset()` (nuevo piso o `R`).
- **Rendimiento** (medido en Edge sin GPU, el peor caso): una baja cuesta 0,4 ms (disparo) a 1 ms
  (melé/remate) de CPU, 900 partículas ≈ 0,1 ms de update + 1,1 ms de dibujo por fotograma, y 60
  bajas a la vez (muy por encima del juego real) mantienen la media por debajo de 13 ms. Al tocar
  esto, no meter nada por partícula que sea caro (cambios de estado del contexto, `shadowBlur`,
  asignaciones) y repetir la medición.

## Estilo visual: pixel art 16-bit neón / synthwave oscuro
Diseños propios del juego (no copiar personajes ni arte de otros juegos).

### Reglas de pixel art (obligatorias)
- Resolución interna objetivo: 216 px de alto con **escala entera** (`TARGET_INTERNAL_H` en game.js).
  `resize()` elige el factor entero más cercano a altoPantalla/216 y ajusta la altura interna a lo
  que cabe exacto (1080 px → ×5 = 216; 636 px → ×3 = 212); ancho = anchoPantalla/escala (256–560).
  `game.scene` se dibuja a esa resolución y `ScreenFx.compose` la escala con `imageSmoothingEnabled = false`.
  El HUD no debe asumir medidas fijas: usar `w`/`h` de la escena y `fitScale()` para textos grandes.
- Cámara: sigue al jugador con lerp y se adelanta hacia el ratón (`CAMERA_LOOKAHEAD`) con tope
  `MAX_LOOKAHEAD` para que el jugador siga siendo el centro con la vista cerrada.
  Redimensionar un canvas reinicia su contexto: volver a poner `imageSmoothingEnabled = false`.
- Escala del mundo: `WORLD_PX` = 2 → 1 píxel interno = 2 unidades del mundo; una casilla (`TILE` 32)
  = 16×16 píxeles. La cámara redondea su desplazamiento a píxeles enteros.
- Nada de `arc`, `ellipse`, líneas suavizadas ni `fillText` en el juego. Usar:
  sprites (`drawSprite`), rectángulos alineados a la rejilla (`pixelRect`/`snap`), discos de
  píxeles (`pixelDisc`) y la fuente bitmap (`drawText`). Excepción: las superposiciones de
  debug (F1) pueden usar trazos vectoriales.
- Sprites: definidos en `DEFS` de `sprites.js`, 1 carácter = 1 píxel, contorno `k` oscuro, sombreado
  de 1 px (tono claro arriba-izquierda, oscuro abajo-derecha). Personajes de 16×16 mirando a +X;
  se rotan al dibujar (vecino más cercano). Variantes de color con `RECOLORS`.
  Jugador: cazadora cian con capucha gris y puños de color según la máscara, y el hueco de la
  cabeza, que pinta encima la máscara elegida; se mancha de sangre con las bajas (ver "Máscaras").
  Patrulla: camisa amarilla + gorra. Armado: chaleco oscuro.
- Capas estáticas (suelo, paredes, glow) y las capas de sangre (suelo y paredes) van a media
  resolución del mundo (1 píxel = 2 unidades) y se dibujan escaladas ×2. Los cadáveres son sprites
  estampados en la capa de sangre del suelo; la de las paredes se pinta sobre ellas.
- Suelos por zona y muebles: ver "Diseño de niveles". Todo el entorno lleva desgaste generado
  con semilla fija. Paredes y muebles sólidos proyectan sombra dura abajo-derecha; las paredes tienen
  tubo neón de 2 px en los bordes que dan al suelo + capa de glow sumada con `lighter`.
- HUD en píxeles internos con `drawText` (escala 1, 2 o 3). La sombra dura del texto no se usa
  en escalas grandes (rompe la silueta): pasar `shadow: null`.

### Paleta
Colores centralizados en `COLORS` (`src/utils.js`) y `PALETTE` (`src/sprites.js`).
- Fondo `#0d0221`
- Paredes `#ff2a85` (puertas `#ff7ab8`)
- Jugador `#05d9e8`
- Enemigos `#ffbe0b`
- Sangre persistente `#d90429` (+ `bloodMid`, `bloodDark` y `bloodWet` en `COLORS`; se pinta en
  capas offscreen que solo se limpian al reiniciar). Restos: carne `flesh`, coágulo `gore`, hueso
  `bone`; chispas de neón: `player`, `wall`, `door` y `neonLight`
- Armas `#c77dff`, debug `#00ff9f`

## Móvil y táctil
- **Escalado en píxeles físicos**: el buffer del canvas mide CSS × `devicePixelRatio`; el estilo CSS
  mide la ventana. La escala entera se elige sobre píxeles físicos y se garantiza que la escena
  quepa (`INTERNAL_MIN_W`/`MIN_H`, `INTERNAL_MAX_H` en vertical). Todo lo que convierta
  coordenadas de pantalla debe usar `game.toInternal(cssX, cssY)` (ya incluye el dpr).
- **Modo táctil** (`input.touchMode`): se activa al tocar (o de entrada si el puntero es "coarse")
  y se desactiva al usar ratón o teclado. Sin modo táctil no se dibuja ni se procesa nada táctil.
- **Orientación**: apaisado obligatorio. En vertical con táctil, `game.needsRotate` pausa el juego
  y muestra "GIRA EL DISPOSITIVO".
- **Controles** (`touch.js`, solo en `playing`/`cleared`): joystick izquierdo flotante (mitad
  izquierda) → `input.moveAxis` analógico; joystick derecho flotante (mitad derecha) → apunta y ataca:
  mantenido, `input.aimFiring` = ataca con cualquier arma a su cadencia (al instante si se arrastra
  más del 30% del radio, o tras `HOLD_FIRE_DELAY` 0,1 s con el dedo quieto); un toque rápido que se
  levanta antes de disparar → `input.tapAttack` = un ataque. No exigir arrastre para atacar: en el
  móvil lo natural es tocar o mantener (fue un bug real).
  Botón **ATACAR** (el principal: más grande, esquina inferior derecha): tocar = `input.tapAttack`
  (un ataque), mantener = `input.attackHeld` (ataque continuo a la cadencia). Sin botón de patada:
  un golpe cuerpo a cuerpo sin enemigo delante ya patea la puerta de enfrente (`kickDoor`).
  LANZAR (= clic derecho) encima de ATACAR y REINICIAR (= R) bajo la máscara.
  Tamaños en píxeles CSS (`STICK_CSS_RADIUS`, `BUTTON_CSS_HEIGHT`) para que midan lo mismo que un dedo.
- **Fuera de la partida** un toque = clic en ese punto (menús, tarjetas). Antes se comprueban los
  **botones táctiles de pantalla** (`game.screenButtons()`, solo en modo táctil), que "pulsan" la
  tecla equivalente para reutilizar la lógica del teclado:
  máscaras → VOLVER (Esc) · RÉCORDS (T); muerte → REINTENTAR (R) · TERMINAR (Enter) · RÉCORDS (T);
  fin de partida → NUEVA PARTIDA (Enter) · MENÚ (Esc); panel de récords → CERRAR (Esc, o tocar
  en cualquier sitio). El selector de pisos tiene su VOLVER en `menu.backRect()`.
  En resultados tocar en cualquier sitio continúa; en la pantalla de récords del menú, vuelve.
- **Doble toque** en máscaras y pisos: el primer toque elige (se lee la pasiva / el récord), tocar
  la ya elegida confirma. Con ratón un clic sigue confirmando directamente.
- Textos de ayuda según el modo: `game.hint(textoEscritorio, textoTáctil)`.
- `touch.update()` se ejecuta al principio de `game.update()`, antes de leer la entrada.
- **Zonas seguras** (muesca, esquinas, barra de inicio): `game.safe = { t, r, b, l }` en píxeles
  internos, leídas de `env(safe-area-inset-*)` con un elemento invisible (`safeProbe`) en cada
  `resize()` (requiere `viewport-fit=cover`). HUD, joysticks, botones y pies de pantalla las suman
  a sus márgenes. Las pantallas centradas no las necesitan.
- **Pantalla completa**: botón en el título (`menu.fullscreenRect()`), solo si
  `document.fullscreenEnabled` (en iPhone no existe). Se atiende en `game.onPointerUp` porque la
  petición debe hacerse dentro del evento del usuario, no desde el bucle; en Android intenta
  además bloquear la orientación en horizontal.
- **Rendimiento**: si va por debajo de `LOW_FPS` (45) durante `LOW_FPS_SECONDS` (3 s) seguidos con
  la pestaña visible, `fx.lite = true` (sin aberración cromática) y aviso "EFECTOS REDUCIDOS".
  Una vez por sesión. `V` vuelve a efectos completos / los desactiva. El HUD indica "EFECTOS LIGEROS".
- **iPhone**: aviso en el título de que el modo silencio apaga el audio del juego.
- Gestos del navegador bloqueados (CSS `touch-action: none`, `preventDefault` en `touchstart/move/end`,
  `viewport` sin zoom); eso también evita los clics de ratón emulados tras cada toque.
- Audio: en táctil se desbloquea en `pointerup`/`touchend` (el navegador no lo permite en `pointerdown`).

## Debug
- `F1` activa/desactiva el modo debug: hitboxes, conos de visión (cortados por puertas),
  líneas de visión, rutas BFS, estados de la IA (incluido aim/windup y temporizador de
  derribo), velocidad angular de puertas, contadores de partículas, de manchas permanentes, nivel de sangre del personaje y FPS. Mantener siempre
  esta tecla funcionando al añadir sistemas nuevos (cada entidad nueva debería tener su `drawDebug`).
- Cuidado: los `drawDebug` que cambian `textAlign` sin `save/restore` afectan al HUD;
  `renderHud` lo reinicia al empezar.

## Controles
`WASD` mover · ratón apuntar · clic izquierdo atacar/disparar/rematar · clic derecho recoger/lanzar arma ·
`E` patada a puerta · `R` reintentar piso · `Espacio`/`Enter` continuar en resultados ·
`T` mejores partidas (selección de máscara y muerte) · `Enter` en la muerte: terminar partida ·
`F1` debug · `M` silenciar sonido y música · `V` efectos CRT on/off
