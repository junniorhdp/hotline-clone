# NEON RUSH — prototipo top-down 2D

Prototipo de acción top-down (combate letal de un golpe, reinicio instantáneo) hecho con
HTML5 Canvas, JavaScript Vanilla (ES Modules) y Vite. Sin frameworks ni librerías de juego.

## Comandos
- `npm run dev` — servidor de desarrollo (http://localhost:5173). En dev el juego está en `window.game`.
- `npm run dev -- --host` — igual, pero accesible desde el móvil en la misma red (usa la URL "Network").
- `npm run build` — build de producción en `dist/` (rutas relativas: `base: './'` en `vite.config.js`)
- Despliegue: cada push a `main` compila y publica en GitHub Pages (`.github/workflows/deploy.yml`)
  → https://junniorhdp.github.io/hotline-clone/ . En Settings → Pages la fuente debe ser "GitHub Actions".
- `npm run preview` — sirve el build
- Versión: `vite.config.js` define `__APP_VERSION__` (commit de GitHub Actions o "dev") y el título
  la muestra arriba a la izquierda, para comprobar que el navegador no sirve una copia guardada
  (GitHub Pages permite cachear la página ~10 min).

## Arquitectura (reglas)
- Todo el código del juego vive en `src/` y es modular, un módulo por responsabilidad:
  - `main.js` — punto de entrada: crea el `Game` y lo arranca. Nada de lógica aquí.
  - `game.js` — game loop, cámara, hit-stop, estado global, colisiones entre entidades
    (balas, armas lanzadas, puertas), muertes/derribos, render de la escena y HUD.
  - `player.js` — movimiento, apuntado, ataque, remate, patada, recoger/lanzar armas.
  - `enemy.js` — IA de enemigos (patrulla, visión, persecución, búsqueda, derribado) y tipo armado.
  - `doors.js` — puertas batientes: física de la hoja, empuje, patada y derribo.
  - `map.js` — tilemap, colisiones AABB con sliding, raycast/línea de visión (paredes + puertas),
    pathfinding BFS, pisos (`LEVELS`), zonas de suelo y muebles sólidos en la cuadrícula.
  - `weapons.js` — definiciones de armas (`WEAPON_DEFS`, `ENEMY_GUN`), `Pickup`, `Bullet`, utilidades de melee.
  - `particles.js` — chispas, polvo, gotas de sangre (se pintan en la capa de sangre al caer) y casquillos persistentes.
  - `audio.js` — SFX y música synthwave procedimentales con Web Audio (osciladores + ruido filtrado).
    Sin archivos de audio. La música usa un planificador con lookahead: **un único** `setInterval`
    (`musicTimer`) para toda la partida que programa notas en el reloj de audio; `setMusic('action'|'clear')`
    solo cambia el patrón. Nunca crear intervalos nuevos por nivel/reinicio. En silencio no se crean nodos.
  - `decor.js` — arte estático del entorno: texturas de suelo por zona, muebles, decoración de
    suelo y deterioro de paredes (`renderFloor`, `renderProps`, `renderWalls`).
  - `menu.js` — menú principal arcade (título, selector de pisos, récords) y su fondo synthwave.
  - `masks.js` — máscaras (`MASKS`): nombre, descripción de la pasiva, icono pixel art 12×12 con
    paleta propia y `effects`. `maskEffects(mask)` devuelve los efectos con valores por defecto.
  - `score.js` — combos (ventana `COMBO_WINDOW` = 3,5 s), puntos por estilo (`STYLE`), popups,
    rango S/A/B/C por piso, combo máximo de la partida. No toca `localStorage`.
  - `scores-history.js` — Top 5 histórico de partidas en `localStorage` (ver "Guardado de récords").
  - `effects.js` — escala la escena de baja resolución a la pantalla (sin suavizado) y aplica el
    post-proceso CRT/VHS: aberración cromática, banda VHS, scanlines por fila de píxel y viñeta.
  - `sprites.js` — sprites pixel art como cuadrículas de texto + paleta, horneados a bitmaps una vez;
    helpers `drawSprite`, `pixelRect`, `pixelDisc`, `snap`.
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
- Diseños propios (no usar personajes/nombres de otros juegos). Actuales: NEÓN (sin pasiva),
  OSO (puñetazos mortales), GUEPARDO (+30% velocidad), TIBURÓN (empieza con cuchillo),
  BÚHO (balas +20% velocidad y mitad de dispersión).
- Flujo: estado `masks` antes de cada piso (al arrancar, tras los resultados con Espacio/Enter
  y al empezar partida nueva). Flechas/A-D o pasar el ratón eligen (el ratón solo cuenta si se
  mueve); Espacio/Enter o clic en la tarjeta confirman. `R` NO abre la selección: reintenta el
  piso con la misma máscara. Durante `masks` la simulación está parada y `R` se ignora.
- Los efectos se aplican creando el `Player` con `maskEffects(game.mask)` (`player.perks`).
  Para añadir una pasiva: nuevo campo en `DEFAULT_EFFECTS` + leerlo en `player.js` (o donde
  toque) vía `this.perks`. Nada de comprobar `mask.id` por el código.
- HUD: miniatura de la máscara (12×12 a ×2) bajo el arma; los resultados muestran la máscara usada.

## Mecánicas de combate
- Daño: todo es de un golpe. Lo que cambia es el efecto: **matar** o **derribar** (estado `down`
  ~3,2 s, luego se levanta; se remata con clic izquierdo encima con cualquier arma).
  Cualquier arma **lanzada** (clic derecho) derriba si va a más de 160 px/s.

### Arsenal del jugador (`WEAPON_DEFS` en `weapons.js`)
Alcance en unidades del mundo (1 casilla = 32). Cadencia = segundos entre ataques.

| Arma | Clave | Efecto | Alcance | Cadencia | Munición | Notas |
|---|---|---|---|---|---|---|
| Puños | `fists` | derriba | 24 (arco 99°) | 0,32 s | — | con máscara OSO matan |
| Bate | `bat` | mata | 40 (arco 153°) | 0,42 s | — | el melee de más alcance |
| Tubo de hierro | `pipe` | mata | 36 (arco 135°) | 0,30 s | — | más rápido que el bate |
| Cuchillo | `knife` | mata | 30 (arco 108°) | 0,25 s | — | arma inicial de TIBURÓN |
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
| Pistola | 320 | 0,5 s | 1 | 0,9 s | pistola con 4 balas |
| Subfusil | 280 | 0,6 s | ráfaga de 4 (cada 0,09 s) | 1,2 s | subfusil con 12 balas |

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
- Hit-stop (`HITSTOP` en `game.js`): muerte 50 ms, remate 80 ms, derribo 35 ms, portazo 70 ms, muerte del jugador 120 ms.

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
  Jugador: cazadora cian + gafas neón. Patrulla: camisa amarilla + gorra. Armado: chaleco oscuro.
- Capas estáticas (suelo, paredes, glow) y la capa de sangre van a media resolución del mundo
  (1 píxel = 2 unidades) y se dibujan escaladas ×2. Los cadáveres son sprites estampados en la
  capa de sangre.
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
- Sangre persistente `#d90429` (se pinta en una capa offscreen que solo se limpia al reiniciar)
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
  derribo), velocidad angular de puertas, contadores de partículas y FPS. Mantener siempre
  esta tecla funcionando al añadir sistemas nuevos (cada entidad nueva debería tener su `drawDebug`).
- Cuidado: los `drawDebug` que cambian `textAlign` sin `save/restore` afectan al HUD;
  `renderHud` lo reinicia al empezar.

## Controles
`WASD` mover · ratón apuntar · clic izquierdo atacar/disparar/rematar · clic derecho recoger/lanzar arma ·
`E` patada a puerta · `R` reintentar piso · `Espacio`/`Enter` continuar en resultados ·
`T` mejores partidas (selección de máscara y muerte) · `Enter` en la muerte: terminar partida ·
`F1` debug · `M` silenciar sonido y música · `V` efectos CRT on/off
