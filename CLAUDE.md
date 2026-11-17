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
  - `player.js` — movimiento, apuntado, ataque, ejecución de derribados, patada, recoger/lanzar
    armas, nivel de sangre del personaje y suelas manchadas (huellas).
  - `barks.js` — frases de los enemigos (al avistarte según género y máscara, tensión ante cadáveres).
  - `enemy.js` — IA de enemigos (patrulla, visión, persecución, búsqueda, derribado, `executing`
    mientras los rematan), tipo armado y las variantes `runner` (corredor) y `heavy` (guardia pesado).
  - `portraits.js` — retratos de la pantalla VS del forcejeo: máscara con la sangre del personaje (y pelo/chaqueta si es VEX) y rostros de villanos; además los agentes JACK / VEX (`AGENTS`, icono ♂/♀ y vista previa de ELIGE TU MÁSCARA).
  - `boss.js` — `Boss` (subclase de `Enemy`): el jefe del piso 6, EL EJECUTOR, y su barra de vida (`drawBossBar`).
  - `doors.js` — puertas batientes: física de la hoja, empuje, patada y derribo; la puerta principal
    del edificio (`main`) se bloquea (`lock`: se cierra de golpe) y se desbloquea (`unlock`).
  - `map.js` — tilemap, colisiones AABB con sliding, raycast/línea de visión (paredes + puertas),
    pathfinding BFS, pisos (`LEVELS`, cada uno con su exterior: vestíbulo, puerta principal y calle
    con la moto), zonas de suelo y muebles sólidos en la cuadrícula.
  - `weapons.js` — definiciones de armas (`WEAPON_DEFS`, `ENEMY_GUN`), `Pickup`, `Bullet`, utilidades de melee.
  - `particles.js` — chispas, polvo, sangre, restos (`gibs`), chispas de neón (`neon`) y casquillos
    persistentes; `gore()` lanza todo lo de una baja. Las gotas y los restos, al caer, se hornean
    en la capa de sangre (ver "Sangre y ejecuciones"). `Footprints`: las huellas de sangre del
    jugador, que se desvanecen solas (ver "Huellas de sangre").
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
  - `keybinds.js` — controles de PC reasignables (`KEY_CONFIG`, `KeyBinds`, `keyLabel`). Ver "Controles de PC reasignables".
  - `shield.js` — `ShieldGuard`: el blindado del piso 9 (escudo frontal que se rompe).
  - `cameras.js` — cámaras de seguridad del piso 8 y alerta general del operador (`SecurityCams`).
  - `hostages.js` — rehenes atados a sillas dentro del edificio, golpe de advertencia y extracción (`Hostages`). Ver "Actividades de los enemigos y rehenes".
  - `extraction.js` — `ExtractionCar`: el auto que recoge a 2 o más rehenes.
  - `exits.js` — `BikeExit`: la salida de la moto al acabar el piso (portón, carril lateral o salto). Ver "Salida de la moto".
  - `street.js` — vida de la calle: contenedores con armas oxidadas, monedas, máquina expendedora (lata = buff), cabina telefónica (pista o reto), fogatas y daño/penalización de civiles. Ver "Perímetro exterior y alcantarilla".
  - `npcs.js` — `Vagrant`: los vagabundos (aspecto, estados: huida, agonía, duelo, gratitud; dibujo).
  - `sewer.js` — easter egg de la calle: `Sewer` (tapa de alcantarilla que se desliza y cocodrilo que sonríe). Ver "Perímetro exterior y alcantarilla".
  - `ads.js` — gestor de pausa para un SDK de anuncios (Poki / CrazyGames): `triggerInterstitial` / `triggerRewarded`. Ver "Anuncios (ads.js)".
  - `settings.js` — ajustes del jugador: lista declarativa `OPTIONS` + gestor `Settings` (`localStorage`). Ver "Ajustes y menús".
  - `options-menu.js` — menús modales de lista `ListMenu` (OPCIONES y PAUSA) con estética neón.
  - `touch.js` — controles táctiles: joysticks flotantes, botones, aim-assist y háptica; `TOUCH_CONFIG` parametriza todo; traduce dedos a la entrada del juego.
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
- **Campaña de 10 pisos** (`LEVELS`; los pisos 7 a 10 tienen su prompt en `docs/`; el jefe sigue en el piso 6): 1 Recepción · 2 Oficinas · 3 Ático · **4 El Club** · **5 Almacén** · **6 Penthouse (jefe)** · **7 Apagón (penumbra)** · **8 Seguridad (cámaras)** · **9 El Búnker (blindados)** · **10 El Clímax (trampa de gas, relevo, reencuentro y rol final)**. Los
  tres últimos se generaron con una herramienta que compone salas y puertas, comparten el exterior del piso 3 (vestíbulo, puerta
  principal, calle y moto) y pasan `npm run check:levels`:
  - **Piso 4 · EL CLUB** (`strobe: true`): salas VIP estrechas (7×6) a los lados, pasillos de 2 casillas y una pista de baile de 24×19 con
    cabina de DJ, barra y mesas de cobertura. 12 enemigos: 4 **corredores** (ágiles, cuerpo a cuerpo), bates/tubos y armados. Luces
    estroboscópicas (`drawStrobe`: pulso de color a cada tiempo de 0,46 s —cian, magenta, violeta, ámbar—, destello blanco cada
    compás y haces diagonales; máx. 22 % de opacidad) apagables en Opciones (`LUCES ESTROBOSCÓPICAS`, `strobeEnabled`).
  - **Piso 5 · ALMACÉN**: una nave de 46×13 con estanterías largas (aisles de 2 casillas = cobertura) y cuatro oficinas debajo con puertas
    a la nave y dos al vestíbulo. 11 enemigos con **3 guardias pesados** (escopeta) y subfusiles; garantizados escopeta y subfusil.
  - **Piso 6 · PENTHOUSE** (`boss: true`): salón de recepción largo (3 guardias), dos alas de dos salas (4 enemigos) y la **arena del jefe**
    (20×13, cuatro columnas 2×2, mesa central y escritorio al fondo) con puertas al salón y a ambos flancos. Garantizados escopeta,
    bate, subfusil y tubo. Ver "El jefe".
  - **Piso 7 · APAGÓN** (`dark`, `lights`; prompt en `docs/prompt-nivel-7-zona-oscura.md`): pasillo central de 2 casillas con 5 salas arriba y 4 abajo (puertas entre salas para flanquear), 12 enemigos (2 corredores, 1 pesado, armados). **Penumbra**: el pasillo y 4 salas están a oscuras, con **6 charcos de luz neón**.
    - `def.dark` (rectángulos de casillas) y `def.lights` (`[x, y, color, radio]`) se desplazan con el anillo de calle; `loadLevel` construye `map.dark` (`Uint8Array`, 1 = a oscuras: dentro del radio de una luz es 0), `map.lights` (mundo) y `map.reveal`.
    - **Visión reducida**: con el jugador en una casilla a oscuras, `Enemy.canSee` limita la distancia a **la mitad de `VIEW_DIST`** (170 u; `CLOSE_SENSE` no cambia). Un **ruido del jugador** (`makeNoise` desde su posición: disparo, golpe, patada) pone `map.reveal` = 0,8 s y lo delata aunque esté en sombra. Medido: en sombra lo ven a 160 u pero no a 192; con luz a 288; tras un ruido, a 192.
    - **Dibujo** (`renderDark` en `decor.js`, `game.darkLayer`, se regenera con las demás capas): capa estática a media resolución que oscurece casillas (alfa 0,6; más suave en el borde de cada charco) y suma el resplandor de las luces (anillos de píxeles con `lighter`). Se dibuja tras enemigos, balas y objetos y **antes del jugador**, así que él siempre se ve y los demás se difuminan. Un `drawImage` por fotograma, sin coste apreciable.
    - `check:levels` valida los pisos oscuros: luces dentro del mapa y fuera de paredes, entrada / jugador / moto sin oscuridad y al menos 3 enemigos en sombra y 3 a la luz.
  - **Piso 8 · SEGURIDAD** (`cameras`, letra `O`; prompt en `docs/prompt-nivel-8-seguridad.md`; `cameras.js`, `SecurityCams`, `game.cams`): pasillo central con 5 salas arriba y 4 abajo, 13 enemigos, **7 cámaras de seguridad** y una **sala de control** (arriba a la derecha, dos puertas, tres monitores y consola) donde está sentado el **operador** (`kind 'operator'`, desarmado, camisa verde azulada con auricular; `placeActivities` lo fuerza a `sit`).
    - **Cámaras** (`def.cameras = [casilla de PARED x, y, rumbo, barrido ±, velocidad]`, `map.cameras` con el origen del cono ya en el suelo): cono de **240 u y ±0,4 rad** que barre (`rumbo + seno · barrido`). Con el jugador dentro del cono **y con línea de visión** el indicador sube en **0,6 s** (decae a ×1,2 si sale). Conos ámbar en el suelo (`drawCones`, rojos y más intensos al detectar), cuerpos con piloto parpadeante sobre las paredes (`drawBodies`); F1 dibuja los conos.
    - **Operador y alerta general**: al llenarse un indicador, si el operador está vivo y no tumbado, saca el **walkie-talkie** (1,3 s, `¡INTRUSO EN LA CÁMARA!`, dibujo del walkie con antena parpadeante) y entonces `Game.generalAlarm` pone a **todos los enemigos vivos** (no el jefe) en `answerAlarm` hacia donde te vio la cámara, desfasados hasta 0,8 s (el presupuesto de BFS por fotograma reparte las rutas); cartel `¡ALERTA GENERAL!`. Mientras una cámara te vea repite la posición cada 6 s. El operador que te ve él mismo también da la alerta general (`raiseAlarm`).
    - **Contraataque**: **matar al operador** (cualquier causa) deja las cámaras **ciegas para siempre** (`CÁMARAS CIEGAS`, **+500** si la alarma aún no había saltado; chispas en las cámaras). Matarlo o tumbarlo **durante** el aviso lo corta (`¡AVISO CORTADO!`). Con el operador tumbado no hay aviso. Las cámaras solo detectan con el jugador dentro del edificio y en `playing`.
    - `check:levels` (5d): cámaras en casilla de pared con el origen del cono libre, exactamente 1 operador sentado, alcanzable y a ≥ 20 casillas de la entrada, y a partir del piso 7 no menos enemigos que en el anterior (7: 12, 8: 13).
  - **Piso 9 · EL BÚNKER** (letra `Z`; prompt en `docs/prompt-nivel-9-bunker.md`; `shield.js`, `ShieldGuard extends Enemy`): sala central de 30×19 con barricadas (cajas y estantería, rodeables) y seis salas laterales de metal; 13 enemigos con **3 BLINDADOS**, 1 pesado, 2 corredores y armados; escopetas garantizadas (2).
    - **Blindado** (`kind 'shield'`, hitbox 11, ×0,82 de velocidad, **subfusil**, sin cobertura; sprite `enemyShield` de acero azulado y `shieldCorpse`): lleva siempre un **escudo hacia el jugador** y, si ve al jugador a tiro (`pressure`), **avanza despacio (×0,5) mientras no apunta** hasta unas 110 u (medido: apunta 0,45 s, ráfaga de 4, avanza, repite). Mismo contrato que la coraza del jefe (`guardKill`/`guardKnock`), pero **el escudo se puede romper** (`SHIELD_HP` 4).
    - **De frente** (golpe que viaja contra hacia donde mira, ±63°; `FRONT_ARC`): **pistola y cuerpo a cuerpo rebotan** (chispas, `ricochet`, el jugador se resiente 0,3 s con melé); **subfusil −0,25** por bala (16 balas) y **escopeta −0,6** por perdigón (≈ 7 perdigones = una descarga a quemarropa más uno); los **puños** de frente no lo derriban. Al romperse: `¡ESCUDO ROTO!`, sacudida y chispas; el siguiente golpe ya lo mata. **Por la espalda o los costados**, o con el escudo roto o derribado, **cae de un golpe**. **Arma lanzada, portazo y puños por detrás lo derriban** aunque venga de frente; derribado se remata (la ejecución no la frena).
    - **Dibujo** (`drawGear`, llamado desde `Enemy.draw` ya girado): placa de acero con franjas amarillas, que se agrieta al desgastarse (<75 %, <50 %, <25 %) y destella en blanco al absorber un golpe; aviso flotante `¡BLINDADO! ¡FLANQUÉALO!` la primera vez que algo rebota (una vez por enemigo). `Boss` y `ShieldGuard` son las únicas clases con `guardKill`, así que las armas oxidadas no envenenan a un blindado (golpean como un tubo normal).
    - `check:levels` (5e): ≥ 2 blindados, cada uno con ≥ 18/25 casillas libres alrededor (espacio para flanquear), una escopeta en el suelo y no menos enemigos que el piso anterior (8: 13, 9: 13).
  - **Piso 10 · EL CLÍMAX** (`duo`, `trap`, `noHostages`; tanda B de `docs/prompt-nivel-10-climax.md`): despacho principal de 10×8 arriba al centro con **dos puertas** (sur y oeste), ala oeste y ala este con dos salas cada una, y una **sala central** con barricadas (hall de 46×10); 13 enemigos (incluido 1 blindado junto a la ventilación). Sin rehenes ni auto de extracción (los validadores lo respetan con `noHostages`); sigue usando la moto de la calle para salir (la salida final llegará con la tanda C).
    - **Cinemática por radio y primera instrucción** (`state 'radio'`, `radioCine`, `updateRadio`/`endRadio`/`drawRadioBox`): al sellarse la sala (primera vez; con `R` se salta) el mundo se congela (salvo las puertas, que terminan de cerrarse) con barras de cine, `¡TRAMPA!` y una **caja de diálogo de walkie-talkie** abajo (retrato del que habla, su nombre en su color, texto que se teclea a 30 car./s, walkie con la antena parpadeando): el atrapado avisa por su nombre — `¡VEX, ME HAN ENCERRADO, HAY GAS!` (o `¡JACK, …!`, según el género) — y, tras un corte de cámara a la entrada, el compañero responde `¡AGUANTA, <NOMBRE>! ¡VOY PARA ALLÁ!`. Espacio/Enter/clic la saltan (tras 0,8 s). **El reloj de 60 s no corre hasta que acaba la cinemática**. Entonces el control pasa al compañero (`swapControl(true)`) y aparece la **instrucción**: cartel `¡SALVA A <NOMBRE>!` · `ROMPE LA VENTILACIÓN · PARED ESTE DEL DESPACHO` (3,6 s), un **marcador en el mapa** sobre el punto de la ventilación (`drawObjectiveMarker`, etiqueta `VENTILACIÓN`, flecha hacia ella) y una **guía permanente** bajo el temporizador: `SALVA A <NOMBRE>: ROMPE LA VENTILACIÓN` y `VENTILACIÓN: <rumbo> · <n> CASILLAS` (`ventGuide`), hasta que se llega a ella. Con R en la fase 2 no hay cinemática pero sí el cartel y la guía.
    - **Secuencia** (`Game.updateTrap`, `this.trap` = `{ state 'idle'|'gas'|'done'|'failed', t, hold, victim, … }`; `map.trap` = `room`, `trigger` (el centro del despacho, a ≥ 2 casillas de las paredes), `doors`, `vent`, `center`): 1) con el primer agente (`agentId 'main'`) dentro y en `playing`, al pisar el centro (`beginTrap`) **las dos puertas se sellan** (`Door.lock`, el portazo ya no muestra `SALIDAS BLOQUEADAS` salvo la principal), cartel `¡TRAMPA!` y arranca el gas (`GAS_TIME` 60 s); 2) **el control pasa de inmediato al compañero**, que aparece en la entrada del edificio (`away` hasta ese momento: hasta entonces no se ve, no es objetivo ni recibe balas) con su máscara de apoyo, mientras el primer agente queda atrapado (`victim`, etiqueta `ATRAPADO`, se tambalea y tose `¡COF!` solo si está en pantalla); 3) el compañero debe llegar a la ventilación y **romperla** (`ventNear`: a < 30 u de la casilla exterior y **fuera** del despacho; mantener PATEAR/INTERACTUAR **1,5 s** (`VENT_TIME`), o 3-4 toques en táctil: cada pulsación suma 0,4 s; el progreso decae a 0,6/s si se suelta; aviso con barra `MANTÉN ESPACIO · ROMPER VENTILACIÓN`, el botón de la bota se enciende `ROMPER`). La ventilación está en la cara **este** del despacho (`ventSide 'e'`, dentro del ala este, entrada → ventilación 31 casillas con enemigos de por medio; `'s'` = cara sur).
    - **El liberado se defiende** (`trapSolved`): al romperse la ventilación el agente atrapado pasa a ser un **aliado de IA** hasta el reencuentro (`immortal`, subfusil con munición infinita, `updateAlly` sin `final`: se queda en su sitio y dispara a todo enemigo con visión a ≤ 300 u; `¡ESTOY BIEN! ¡TE CUBRO!`). Así no hay Game Over si un enemigo entra al despacho antes de que llegues. Medido: elimina a un melé y a un armado en < 0,4 s.
    - **Éxito** (`trapSolved`): puertas desbloqueadas y abiertas, chispas y sacudida, `VENTILACIÓN ROTA · EL GAS SE DISIPA`, **+1000 más 20 por segundo sobrante**, el gas se desvanece en 2,5 s y el piso solo se da por **despejado** (`cleared`) cuando la trampa está resuelta y han caído todos los enemigos. **Fracaso** (`trapFail`, tiempo 0): `state 'dead'` con `deathMsg 'SE QUEDÓ SIN AIRE'` y cinemática de asfixia (`stepAsphyx`): la cámara viaja al agente atrapado, cae a los 1,3 s (cadáver en el suelo) y una pantalla verdosa lo apaga; la franja de muerte sale a los 2,6 s.
    - **Reloj**: corre solo en `playing` (se congela en forcejeos, hit-stop, menús y pausa porque `update` no llega) y **no con una ejecución en curso**. HUD: `GAS n` y barra arriba al centro (verde; rojo parpadeante bajo 10 s). **Toxicidad** (`drawGas`): tinte verde y viñeta escalonada que crecen con el tiempo (no estorban a quien juegas, el gas está en el despacho), nubes de gas verde (`particles.gas`) en el despacho. La rejilla (`drawVent`) parpadea en verde mientras hay gas y al romperse queda un hueco que echa humo.
    - **R**: si ya empezó la trampa y no se ha resuelto (`trapRetry`), reintentar vuelve a la **fase 2** (`beginTrap(true)`: primer agente atrapado en el despacho, puertas selladas, 60 s, control en el compañero a la entrada); si se resolvió, o la muerte fue antes de la trampa, reinicia el piso normal (compañero `away` otra vez).
    - `check:levels` (5f): 2 puertas sellables existentes, sin enemigos en el despacho, ventilación en pared con casilla exterior libre y fuera del despacho, centro del despacho y ventilación alcanzables, recorrido entrada → ventilación **≥ 10 casillas y ≤ 70 %** de `GAS_TIME` a velocidad base, y no menos enemigos que el piso 9.
    - **Fase final** (tanda C; `this.final = { role, wave, stage, timer, done, montage }`, estados nuevos `'reunion'` y `'role'`): 1) **Reencuentro**: con la trampa resuelta, al acercarse el jugador (el compañero) a < 46 u del agente rescatado empieza `startReunion` (cinemática de 2,4 s con barras de cine, el mundo congelado, ambos de cara, `REENCUENTRO · ¡LO HICIMOS!`); 2) **Elección de rol** (`drawRoleSelect`, pantalla completa; ←/→ o ratón, Espacio/Enter/clic; táctil: primer toque elige, segundo confirma; 0,5 s de guarda): dos tarjetas con el agente y su máscara — **LIMPIEZA** (te quedas con el **primer agente** dentro; el otro cubre desde la calle) y **PERÍMETRO** (te quedas con el **compañero** fuera; el primer agente limpia dentro). `chooseRole` → `beginFinal(role)` (control al agente elegido con `swapControl(true)`, quien se queda fuera se coloca en `trap.ext`, justo al sur de la puerta principal).
    - **Aliado** (`updateAlly`, el agente que no controlas; **inmortal**: `killPartner`/`partnerStrike` lo ignoran, los enemigos lo siguen viendo y atacando; subfusil con munición infinita): dispara (`allyShoot`, balas `'player'` cada 0,26 s) a todo enemigo con visión a ≤ 300 u; en PERÍMETRO **avanza por el edificio** hacia el enemigo interior más cercano (`findPath` cada 0,7 s, 130 u/s; **atraviesa las puertas**, no las empuja); en LIMPIEZA se queda en su puesto de la calle (de momento sin enemigos a la vista: base para futuras versiones). Medido: en 10 s limpió 10 de 13 enemigos interiores.
    - **LIMPIEZA**: se gana al caer todos los enemigos del edificio. **PERÍMETRO**: **2 oleadas** por los extremos de la calle (`WAVES`, `trap.spawns`: 6 puntos por lado): 1.ª de 4 (2 melé con bate/tubo y 2 con pistola), 2.ª de 6 (2 corredores, 1 pesado con escopeta, 1 blindado con subfusil y 2 con subfusil); empieza 3,5 s tras elegir, 4 s entre oleadas (`OLEADA n/2`); al caer la 2.ª, `PERÍMETRO ASEGURADO`: el compañero **termina la limpieza** (los enemigos interiores que queden caen de uno en uno cada 0,3 s) y el piso se despeja. Las oleadas se añaden a `enemies`, así que el rango se calcula sobre el total (medido: 23 enemigos). HUD: `ROL: LIMPIEZA` / `PERÍMETRO · OLEADA 1/2` y cuenta atrás.
    - **Armas y coberturas para el PERÍMETRO** (`supplyDrop`; `props` del piso 10): quien defiende la calle empieza con un **subfusil 30/30 en la mano** (si no llevaba arma) y cuatro armas por el suelo a su alrededor (escopeta, subfusil, pistola y bate; chispas de neón y `¡SUMINISTROS!`); **entre oleadas** (5 s) caen otras tres (escopeta y 2 subfusiles). La calle tiene **barricadas** fijas (cajas y barriles en las filas 26-27 de la calle, a ambos lados de la puerta) para cubrirse de las balas; los validadores comprueban que no cortan los caminos de las oleadas.
    - **Trampilla de la emboscada** (tanda D; `def.hatch` → `map.trap.hatch`, `game.hatch`, estado nuevo `'ambush'`): una **trampilla de servicio de 2×2 casillas** en la sala central (`['hatch', 25, 17, 2, 2]`, decoración de suelo `DECO_ART.hatch`: placa de acero con remaches, bisagras y tirador, **sin ninguna pista**) que no hace nada hasta que, **al elegir el rol LIMPIEZA, quedan menos de 3 enemigos vivos** (`AMBUSH_MIN`; `final.ambushPending`, comprobado en el primer `updateFinal`, antes del chequeo de `done`, así que aunque quede 0 vivos la emboscada sale antes de dar el piso por despejado). Con 3 o más vivos no ocurre nunca (tampoco tras `R`, que deja 6), ni en PERÍMETRO (ahí ya están las oleadas). Cinemática de ~3,7 s **no saltable** y **sin destellos** (barras de cine, mundo congelado salvo partículas): la cámara va a la trampilla, que **tiembla** 1,4 s soltando polvo; la tapa sale (`¡EMBOSCADA!` · `REFUERZOS POR LA TRAMPILLA`, sacudida 11) y salen **4 refuerzos** de uno en uno cada 0,3 s (`AMBUSH`: subfusil, pistola, corredor y pesado con escopeta), ya en persecución. `drawHatch` dibuja el hueco con peldaños y resplandor naranja y la tapa girando sobre su bisagra. Los refuerzos entran en `enemies` (`ambush: true`): el rango se calcula sobre el total. `check:levels` (5h): trampilla existente, 2×2 casillas libres y alcanzables, fuera del despacho, a ≥ 2 casillas de cualquier puerta y sin enemigos encima.
    - **Relevo**: `swapControl` quita la inmortalidad y la munición infinita (`>= 9999`) a quien vuelve a ser jugador (se quedaba con el subfusil infinito del aliado): recibe un cargador normal.
    - **R en la fase final** (`finalRetry`, `finalRole`; se borran al empezar partida o piso): reintenta **sin repetir la elección de rol**: la trampa ya resuelta (puertas abiertas), ambos agentes en el despacho y solo los **6 enemigos más lejos** (`FINAL_KEEP`), y vuelve a empezar el rol elegido.
    - **Base para civiles** (`game.civilianRecord = { hurt, killed, gifts }`, `civiliansHelp()` → `'help' | 'neutral' | 'hinder'`, definida **solo** en `street.js`): `hurt` al primer daño a un civil, `killed` al morir, `gifts` al darle una moneda; se acumula durante la partida (`civilianBase` = el registro al entrar al piso, R lo restaura). Reglas: `killed ≥ 1` o `hurt ≥ 2` → `hinder`; `gifts ≥ 2` sin heridos → `help`; si no, `neutral`. Sin efecto aún (F1 muestra `CIVILES h/k/g veredicto`).
    - `check:levels` (5g): punto exterior y los **12 puntos de aparición** (6 por extremo) son suelo libre con camino hasta el perímetro, y todos los enemigos llegan al despacho (final LIMPIEZA).
- Los pisos nuevos usan `loadLevel` normal; `loadLevel` devuelve además `strobe` y `boss`. El selector de pisos muestra una **ventana
  deslizante** de tarjetas cuando no caben todas (`floorsLayout`: `first`/`perPage`, flechas `<` `>` y toque en los bordes).
- Los pisos están en `LEVELS` (`src/map.js`): `{ name, floor, par, rows, zones, props, loot, … }`.
  `par` = tiempo objetivo (s); `zones`/`props`: ver "Diseño de niveles".
  Leyenda del tilemap: `#` pared · `.` suelo · `D` puerta · `N` puerta principal del edificio (una por
  piso: se bloquea al entrar) · `P` jugador al bajar de la moto (en la acera) ·
  `E`/`A` enemigo melee/armado (patrulla en el eje más largo) · `V`/`W` melee/armado con patrulla
  vertical forzada (para cruzar patrullas) · `B` bate · `G` pistola · `S` escopeta ·
  `K` cuchillo · `T` tubo · `M` subfusil · `?` arma aleatoria (ver "Reparto de armas") ·
  `R` corredor (melee ágil) · `H` guardia pesado (escopeta) · `X` jefe (uno por piso, en su sitio hasta verte u oírte).
  `loadLevel` valida anchos de fila, `P`, la puerta principal `N` (una, en pared horizontal), la moto
  (mueble `bike`) y la colocación de los muebles; devuelve además `entry` (el punto dos casillas dentro
  de la puerta principal, con `lockY`, el umbral) y `bike`.

### Llegada en moto, bloqueo del edificio y fuga
Cada piso empieza **en la calle**, no dentro. El ciclo (`game.js`) es:

1. **Llegada** (`state 'arriving'`, `beginArrival` + `updateCine`): tras elegir máscara, la moto entra
   por la izquierda con el jugador montado, frena en su plaza (1,9 s) y él baja a la acera (0,55 s).
   Barras de cine arriba y abajo. **Espacio / Enter / clic / toque** la salta. El jugador llega
   **sin máscara** (cabeza `bare`, la máscara agarrada en la mano izquierda; el retrato del HUD
   está apagado) y **sin arma**: las pasivas que dan un arma (BLADE) esperan a ponérsela.
2. **Fuera** (`state 'playing'`, `inside` = false): camina a la puerta principal, marcada con el marco
   neón `ENTRADA` y una flecha (`drawObjectiveMarker`). La música es la tranquila (`menu`) y el
   reloj del piso no corre. La moto es un mueble sólido (no se la atraviesa).
3. **Bloqueo** (`beginLockdown`): al cruzar el **umbral hacia dentro** (`Game.inBuilding`: `y < entry.lockY` —dos casillas dentro de la
   puerta principal, ya fuera del barrido de la hoja— **y** dentro de la huella del edificio `entry.zone`, sin el anillo de calle de arriba y de los lados, que también tiene `y < lockY`) se pone la máscara (`Player.putOnMask`, ráfaga
   de neón + sonido), se anota el arma con la que entra (`entryWeapon`), la puerta principal se
   **cierra de golpe** (`Door.lock()`, 11 rad/s) y se **bloquea**: nadie la mueve (ni el jugador ni los
   enemigos), las patadas no hacen nada (`kickDoor` da un golpe sordo) y la hoja se pinta en rojo
   con un candado. Al acabar de cerrarse (`door.slammed` → `slamEffects`): sonido `lockdown`,
   sacudida, chispas y el aviso `SALIDAS BLOQUEADAS`. Empieza la música de combate y corre el reloj.
4. **Despejar** (`state 'cleared'`, `this.inside && todos muertos`): suena `tapeStop` y entra el ambiente
   vacío (ya existente); la puerta se **desbloquea y se abre** (`Door.unlock()`, sonido `unlock`) y
   salen, **por turnos y nunca a la vez**, dos mensajes:
   1. `drawCallout`: cartel `PISO COMPLETADO` (2,8 s, subtítulo `¡EDIFICIO LIMPIO!`) en una franja oscura que se abre desde el centro con filos
   de neón, texto que entra deslizando con doble sombra rosa/cian, destello que lo barre y fundido final (el mismo cartel
   sirve a `SALIDAS BLOQUEADAS`; `showCallout(text, color, seg, sub)`).
   2. `drawGoalPanel`: al apagarse el cartel (`goalAge` cuenta desde entonces) sube desde abajo un panel `REGRESA A LA MOTO`
   (centro inferior; en escritorio por encima de la línea de controles) con borde cian que late y flecha parpadeante.
   El marco pasa a la moto (`MOTO`).
5. **Fuga** (`state 'leaving'`; la salida se elige **al azar**, ver "Salida de la moto"): al **rozar la moto** (`touchingBike`: su borde + `MOUNT_MARGIN`) el
   jugador se sube (0,4 s) y la moto acelera hasta salir de la pantalla (1,35 s) con polvo y el motor
   (`playMotoDeparture`, ver "La moto"); después fundido y resultados (`finishFloor`). También se puede saltar con
   Espacio/clic. **El piso solo se completa así**: no basta con limpiar el edificio.

- **Reintento (`R`) sigue siendo instantáneo y no repite la llegada** (`reset()` sin opciones):
  - ya habiendo entrado (`entered`): reaparece **justo dentro** (`level.entry`), con la máscara puesta,
    el arma con la que cruzó el umbral (`entryWeapon`) y la puerta ya bloqueada;
  - sin haber entrado todavía (o durante la llegada): otra vez en la acera, sin cinemática.
  `entered`/`entryWeapon` se borran al empezar partida o piso (`startRunAt`, `goToLevel`).
  `reset({ arrival: true })` es el estado de partida (selección de máscara y `confirmMask`).
- **Reloj y rango**: `game.time` corre solo `inside` y antes de despejar; llegada y fuga no cuentan.
- **Cámara**: sigue a la moto mientras va montada y al jugador el resto; `camera.snap` al empezar la
  llegada. Las cinemáticas no usan la entrada salvo para saltarse.
- **Música/sonido**: llegada y fuera `menu` → bloqueo `action` (+ `lockdown`) → despejado `empty`
  (+ `unlock`) → fuga con el motor de la moto (`playMotoArrival` al llegar, `playMotoDeparture` al subirse).
  SFX nuevos en `audio.js`: `lockdown`, `maskOn`, `unlock` y las voces de la moto.
- **Mapas**: cada piso lleva al sur un exterior (ver "Diseño de niveles"). La leyenda cambia: ya no
  hay `X`; `N` = puerta principal y la moto es el mueble sólido `bike` (2×1 casillas).

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
  - Todo (enemigos, `?`, armas, puertas, entrada, moto) alcanzable desde `P`.
  - Las patrullas `E`/`A` no deben cruzar puertas (la patrulla automática sigue el eje más largo
    hasta 7 casillas y atraviesa puertas): colocar al enemigo donde su eje largo quede dentro de la sala.
  - **Exterior de cada piso** (se añade al sur del edificio): la pared sur lleva puertas `D` a las
    salas, detrás hay un **vestíbulo** de 2 filas (sin enemigos, con un arma fija para entrar armado:
    `B` bate / `T` tubo), luego la pared con la puerta principal `N` y, fuera, la **calle**: una fila de
    acera, 4 de asfalto (`asphalt`, raya discontinua `asphaltLine`, plaza `asphaltBay`) y una pared de
    fondo. Los extremos de la calle quedan abiertos al borde del mapa. La moto (`['bike', x, y, 2, 1]`)
    va en la primera fila de asfalto y `P` en la acera justo encima de ella. Ningún enemigo en el
    vestíbulo ni en la calle: la entrada tiene que ser segura (desarmado y sin máscara al llegar).
  - Comprobar con `npm run check:levels` (`tools/validate-levels.mjs`): pasos de puerta libres, todo
    alcanzable, patrullas sin cruzar puertas, exterior sin enemigos y camino de la puerta a la moto.
  - Comprobar después que nadie se atasca simulando movimiento real (`moveAndSlide`) y la
    navegación de los enemigos (`Enemy.goTo`) hacia el jugador, patrullas, armas y la entrada.

### Salida de la moto (`exits.js`, `BikeExit`)
Como la calle está cerrada por la valla perimetral, la moto ya no se va "a través" de ella: al arrancar la fuga (`startLeaving`) se elige **al azar (33 % cada una; medido 91/110/99 de 300)** una de tres salidas. La moto sigue una trayectoria precalculada (`buildPath`: polilínea con las curvas suavizadas) con aceleración constante
(`place(t2)`: distancia ∝ t²; el faro y el humo van en el sistema de la moto, que ahora tiene rumbo `angle`, altura `z` y tamaño `sc`). La cámara amplía sus límites `EXIT_EXTRA` (340 u) hacia donde sale, la carretera de fuera la pinta `drawRoad` y lo que va **encima de la valla** (hojas del portón, abertura) `drawOver`;
la moto y el jugador se dibujan **después de las paredes** mientras dura la fuga (`over` en `render`), así que no los tapa la valla. La cinemática no usa colisiones, pero la elección busca sitio libre (fila despejada / columna despejada al sur; si no hay, cae al carril).
- **Portón** (`gate`, 2,3 s): un sector de 3 casillas de la valla sur se abre (dos hojas de reja que se deslizan, luces naranjas de aviso, sonido `unlock`); la moto acelera hacia una columna despejada al este, **gira 90°** con una curva y cruza hacia una carretera (acera y asfalto con raya amarilla) fuera del mapa.
- **Carril lateral** (`lane`, 1,35 s): la valla del extremo este de la calle se abre (hueco de asfalto con postes) y la moto acelera en línea recta por el **callejón despejado** (se escoge la fila libre más cercana a la suya), con paredes de neón a los lados fuera del mapa.
- **Salto** (`jump`, 2,3 s): aparece una **rampa improvisada** (tablones sobre cajas, franjas de aviso; cae desde arriba con sonido y polvo) pegada a la valla sur; la moto gira al sur, sube y **vuela por encima de la valla** (altura 80, tamaño ×1,5, balanceo, sombra que se reduce), con sacudida, chispas y el cartel `¡SALTO ÉPICO!`.
- **Llegada**: la valla del extremo oeste de la calle también se abre (`BikeExit.drawArrivalGap`) para que entre la moto. Saltar la cinemática (Espacio/Enter/clic) sigue yendo directo a los resultados.

## Actividades de los enemigos y rehenes (dentro del edificio)
### Actividades iniciales (`placeActivities` en `map.js`, `Enemy.setActivity/updateActivity`)
Mientras no saben de ti (estado `patrol`) los enemigos ya no hacen todos la misma ronda. Cada **grunt** recibe al azar (por partida y piso, con la misma semilla que el resto: R repite el reparto, otra partida lo cambia) una actividad; los **pesados** vigilan (60 %) o patrullan; los **corredores**, el **jefe** y los **portadores de máscara** no cambian.
Reparto de los grunts: **patrulla 42 %** · **vigila 26 %** · **fuma 18 %** · **sentado 14 %** (medido sobre 275 enemigos: 48 / 34 / 11 / 6,5 %, porque un sentado sin mesa cercana se queda vigilando). Los enemigos inmóviles por diseño (`axis 'none'`) vigilan.
- **`watch` (vigilar)**: se queda en su sitio y cada 1,1–3 s fija la mirada en otro punto de su sector (±80°) y gira despacio hacia él (sin ruta fija).
- **`smoke` (fumar)**: ciclo de 4,2 s: quieto · **sube el cigarrillo** (blanco con brasa que parpadea) · calada con **humo** (`particles.smoke`: polvo gris que sube despacio) · lo baja. Mira distraído hacia un lado. Pillado fumando tarda **+0,35 s** en reaccionar al verte.
- **`sit` (sentado a una mesa)**: ocupa una casilla libre junto a un escritorio / mesa de cartas / mesa con dinero / barra / cama de su misma sala (a ≤ 7 casillas, a la vista, lejos de puertas), **de cara a la mesa**; se dibuja con **silla detrás y los puños sobre la mesa**, con pequeños movimientos de cabeza. Pillado sentado tarda **+0,5 s**.
- En cuanto ocurre algo (te ven, un ruido) **se levantan y tiran el cigarrillo** (`seated`/`smoking` = false) y siguen la IA de siempre; al volver a `patrol` regresan a su sitio (`home`) y retoman la actividad. F1 muestra `[WATCH]`/`[SMOKE]`/`[SIT]`.
### Rehenes (`hostages.js`, `Hostages`; `placeHostages` en `map.js`; auto en `extraction.js`)
**1 rehén en el piso 1 y 1-2 en los demás**, atados a una silla en una **sala** (no pasillo) vigilada (hay un enemigo de la misma sala a ≤ 7 casillas), lejos de las puertas y de la entrada; reparto al azar por partida y piso.
**Separación**: se colocan a **≥ 3 casillas** de cada enemigo (posición, puntos de ruta y recorrido de patrulla; sentados y fumadores incluidos; si no cabe se relaja a 2,5 y luego a 2) para que las hitboxes no se solapen; `validate-streets.mjs` comprueba ≥ 2 casillas en 20 semillas por piso.
- **Liberar**: `PATEAR/INTERACTUAR` (Espacio / F; en táctil el botón de la bota, ámbar) a ≤ 22 u (aviso `ESPACIO · LIBERAR`): **+1500 puntos** y el rehén **corre a la entrada del edificio** (`freed` → `waiting`, `findPath`, 120 u/s) y espera allí. (La patada es la acción de liberar: no hace daño.)
- **Golpes cuerpo a cuerpo** (clic / ATACAR; `Hostages.meleeHit`): el **primero NO lo mata**: lo **tumba en su silla** (silla volcada, `down`) con un **micro-temblor de cámara** (sacudida 4) y la burbuja de dolor `¡MMMPH!!` roja (aviso); durante **0,8 s** de gracia otro golpe no cuenta; el **segundo lo mata**. Un **disparo** lo mata siempre (la bala se detiene en él).
  Matarlo = `¡REHÉN ABATIDO! -2000 AL FINAL` (**−2000 puntos** al terminar el piso, antes del rango, nunca más que los puntos del piso) y la **culpa** del protagonista (a los 3 s se quita la máscara y vomita). Los rehenes ya liberados que no están atados también se tumban al primer golpe y se levantan a los 1,4 s. Las balas enemigas y las armas lanzadas los atraviesan.
- **Extracción** (con el piso despejado y el jugador ya en la calle, `Hostages.plan()`): los rehenes liberados salen del edificio (`exiting`, 95 u/s; los atascados se colocan solos a los 14 s) y:
  - **1 rehén → moto**: espera de pie junto a la moto (`ready`); al arrancar la fuga **se sube detrás del protagonista** (`boardBike` + `rideUpdate`: viaja en la parte trasera durante toda la animación, con cualquier salida de la moto, y se dibuja tras la moto y antes del jugador).
  - **2 o más → auto de extracción** (`ExtractionCar`): llega 0,9 s después **por el oeste** (la valla se abre, `BikeExit.drawGap`), frena junto a la acera a la altura de la puerta (carril libre debajo de la moto, 1,7 s), los rehenes se colocan al norte del auto, **suben uno a uno** (0,5 s cada uno, con sonido de puerta; el auto abre la puerta y su cartel parpadea) y tras una pausa **arranca hacia el este perdiéndose de vista** (faros, humo y chispas; la valla este se abre) **mientras el jugador se va en su moto** (`stepExtraction` también corre durante la cinemática).
  - **Atropello** (`ExtractionCar.hits`, `Game.runOver`): si el jugador se cruza en el carril del auto **mientras se mueve** (llegando o saliendo, velocidad ≥ 60 u/s; parado esperando a los rehenes no atropella) lo arrolla: `state 'dead'` sin cadáver en el suelo (solo una mancha en la calle) y una animación a pantalla: el sprite del jugador (cuerpo y máscara, con su sangre) **sale despedido hacia la cámara** girando y creciendo (0,7 s, `RUNOVER_FLIGHT`), se **estampa contra el «cristal»** (destello, sacudida 22, crujido) y queda una mancha de sangre con grietas, la máscara aplastada que se desvanece y regueros que resbalan (`drawRunover`). La pantalla de muerte cambia `HAS MUERTO` por una burla al azar (`ATROPELLADO POR TUS ALIADOS`, `EL RESCATE SALIÓ BIEN. PARA ELLOS`, `GRACIAS POR SALVARNOS. ¡CRUNCH!`, `TAXI... Y AL PARABRISAS`, `LOS REHENES VIVEN. TÚ NO`). `R` reintenta como siempre (`reset()` borra `runover`).
  - **Regla estricta de reparto** (`Hostages.refresh/plan`, se recalcula cada fotograma y al arrancar la fuga con los rehenes rescatados **en ese momento**): **1 rescatado → va en la moto; 2 o más → NINGUNO va en la moto**, todos esperan al auto, suben juntos y el auto arranca. Si cambia el número (liberas otro tras haber decidido la moto, o muere uno) se reparte de nuevo (los que esperaban junto a la moto se redirigen a la acera y llega el auto), así no queda ningún «rehén fantasma» sin plaza. Mientras suben al auto el grupo no cambia; los que llegan tarde suben también. Arreglado: antes el plan se fijaba una sola vez y un rehén liberado después —o que aún corría a la entrada al salir— se quedaba sin extracción.
  - **Aviso de rehenes pendientes** (`Game.leaveAsk`, `Hostages.pending/drawLeaveAsk`): al tocar la moto con el piso despejado, si queda algún rehén **atado** la fuga **no arranca sola**: sale sobre la moto un cuadro informativo con el texto exacto `Falta 1 rehén por rescatar.` / `Faltan X rehenes por rescatar.` y `ESPACIO · IRTE IGUALMENTE` (táctil: `TOCA LA MOTO (BOTA)`). El rescate es opcional: el jugador decide irse con **PATEAR/INTERACTUAR** (Espacio / F, o el botón de la moto) o volver a por ellos. Sin rehenes atados la fuga arranca sola como siempre. (La fuente bitmap dibuja todo en mayúsculas.)
  - **La fuga espera** (`extractionBusy`, igual que con la culpa): con 1 rehén, hasta que esté junto a la moto; con 2+, hasta que estén todos a bordo (`¡ESPERA A LOS REHENES!`); el auto sigue su salida durante la fuga. Los rehenes que siguen atados al salir se quedan atrás.
  - Los resultados muestran `REHENES: n/total LIBERADOS · m MUERTOS -pts`. R los vuelve a atar.

## Perímetro exterior y alcantarilla
- **Anillo de calle** (`withOutskirts` en `map.js`, `OUTSKIRT` = 6 casillas): al cargar un piso se rodea el mapa de `LEVELS` por **arriba, izquierda y derecha** (al sur ya está la calle del propio piso)
  con calle nocturna desierta. Lo escrito en `LEVELS` **no cambia**: `rows`, `zones` y `props` se desplazan (6, 6) al cargar, así que los pisos se siguen diseñando con sus coordenadas de siempre. La miniatura
  del selector de pisos y `check:levels` leen el mapa ya cargado / el original, sin problema. El mapa cargado mide `w + 12` × `h + 6`.
- **Capas estáticas por partida**: como la calle es distinta en cada partida, suelo, muebles, paredes y valla se regeneran cuando cambia **piso o partida** (`layersLevel` = `${levelIndex}:${runId}`), no solo el piso; con R se conservan. (Bug corregido: con la clave solo por piso, al empezar una partida nueva se dibujaba la calle de la anterior —huecos de alcantarilla sin tapa, muebles invisibles con colisión—.)
- **Colocación**: los rincones de arriba quedan bajo el HUD (máscara/arma a la izquierda, puntos a la derecha: `hud(x, y)` en `withOutskirts`), así que ahí no se esconden monedas, alcantarillas, contenedores ni la fogata. Las alcantarillas van a ≥ 7 casillas de la fogata y ≥ 4 de los contenedores; las monedas (2, de entre ~14 escondites) reservan su casilla.
  `npm run check:levels` ahora incluye `tools/validate-streets.mjs`: con 20 semillas por piso comprueba que máquina, cabina y contenedores se pueden tocar, 2 monedas y ≥ 3 vagabundos alcanzables, fogata, 3 alcantarillas y las reglas del HUD.
- **Botón de pausa táctil**: está **arriba a la derecha**, justo bajo el HUD de puntos y piso y por encima de la columna de botones (`layout()` en `touch.js`; antes bajo REINICIAR, junto a la máscara del HUD, donde estorbaba); se aparta hacia arriba si la columna de botones sube demasiado en pantallas bajas.
- **Móvil / táctil** (auditado con emulación en 568×320, 844×390 y 1024×768): el **contador de monedas** pasa a la derecha del botón REINICIAR en táctil (ahí estaba); el **cuadro del teléfono** va debajo del HUD y **entre** los botones de la izquierda y la columna de botones de la derecha (el ancho de línea se adapta);
  el botón táctil superior (la bota) se **enciende en ámbar** (`touchAction() → { id: 'interact' }`) cuando hay un contenedor, la máquina, la cabina o un vagabundo al que dar una moneda a tiro, y los avisos dicen `BOTA · REGISTRAR` en vez de la tecla (antes no había forma de interactuar desde el móvil); `Game.keepOnScreen` mantiene todo
  texto dentro de la pantalla, **a la izquierda de la columna de botones** (`TouchControls.rightColumn()`) y **debajo del HUD** de las esquinas de arriba (derecha: puntos y piso; izquierda: arma, máscara y, en táctil, REINICIAR/PAUSA); el panel de estadísticas de la pantalla de muerte respeta la zona segura inferior y, en resultados con
  pantalla estrecha (< 400 px), la línea de estadísticas se parte en dos si no cabe.
- **HUD de la calle**: el nombre del arma se encoge para no pasar de la mitad izquierda (el centro es del combo, la lata y el jefe); solo hablan a la vez los 2 vagabundos más cercanos y sus burbujas no se pisan; los textos flotantes de la máquina van por encima del aviso de interacción.
- **Cámara**: `Camera.setBounds` usa el mapa ampliado, así que la cámara puede subir a la calle; la habitación superior ya no queda bajo el HUD de arriba a la derecha.
- **Contenido** (generado **al azar por partida y piso**: `withOutskirts(def, index, rng)` usa el `rng` del juego —`runId:piso`—, así que **R repite la misma calle** pero una partida nueva o otro piso la cambia: posiciones de contenedores, máquina, cabina, monedas, vagabundos, fogata y tapas): **acera** pegada al edificio (`sidewalk`, losas con juntas y grietas), **asfalto** con grietas y aceite, **farolas** (`lamp`, sólidas, con charco de luz translúcido),
  **contenedores** (`dumpster`, sólidos) contra la valla, basura/barriles/manchas/papeles sueltos y **tapas de alcantarilla** (`sewer`, decorativas). La puerta del edificio sigue siendo la principal (`N`, vestíbulo → calle).
- **Valla**: la casilla más externa del mapa es una pared estructural dibujada como **valla metálica** (`drawFence` en `decor.js`, sin neón): es el límite duro de colisión; fuera de ella la cámara no puede pasar.
- **Cocodrilo** (`Sewer`, `game.sewer`, se recrea en `reset()`; `map.sewers` = tapas): temporizador aleatorio (1.ª vez 14-28 s, luego 25-60 s). Elige una tapa a 190-480 u del jugador (visible). Fases:
  `slide` (la tapa se desliza 11 px al lado contrario del jugador, 0,7 s, sonido `manholeScrape`) → `rise` (0,6 s, `crocUp`) → `grin` (3,6 s: mira al jugador en los 4 ejes, parpadea, sonrisa con dientes que destellan) → `sink` → `close`.
  **Se esconde de golpe** (`scare`: hunde la cabeza en 0,18 s y cierra en 0,3 s) si el jugador está a < 150 u (con la cabeza fuera **chasquea primero**: fase `snap`, 0,32 s: la cabeza se lanza hacia delante y cierra las mandíbulas con fogonazo blanco, `¡CLAC!`, sacudida, sonido `crocSnap`, y de propina **suelta una moneda** —`StreetLife.dropCoin`— o da **+250 puntos**, 50 %) o si `makeNoise` suena a menos de min(radio, 520) de la tapa (disparos, golpes fuertes). Es solo dibujo y sonido:
  no colisiona ni hace daño. Se dibuja con `pixelRect`/`pixelDisc` tras las huellas y antes de la moto. **Orientación** (`pickFace`/`pickDir`/`roomFor`): la cabeza asoma hacia el lado más alineado con el jugador **que tenga sitio** (nada sólido en ~38 u de largo y ±14 de ancho: valla, muebles, paredes) y la tapa se desliza a izquierda o derecha con hueco, nunca hacia donde mira. El recorte de la cabeza incluye siempre el agujero
  (antes, mirando a la izquierda o arriba, quedaba fuera y salía cortada) y `sewer.draw` va tras la capa de muebles. La cabeza va a **×1,5** (`SCALE`; el agujero y la tapa también, `COVER_SHIFT` 16 px) y al sonreír los
  **dientes destellan**: halo aditivo que late sobre la dentadura y una chispa en cruz que salta de diente en diente.
- **Vida de la calle** (`street.js`, `StreetLife`, `game.street`; posiciones en `map.street`: `vending`, `phone`, `npc`, `coin`, generadas por `withOutskirts`). Todo opcional, sin tocar el combate. Se interactúa con
  **PATEAR/INTERACTUAR** (Espacio / F, o el botón de patada táctil) a ≤ 28 u del borde del objeto; sale el aviso `ESPACIO · …` sobre él. El estado que sobrevive a **R** vive en `game.streetRun`
  (`coins`, `coinTaken`, `phoneDone`, `challenge`; se reinicia en cada piso y partida); lo demás (contenedores abiertos) se rehace con el reset.
  - **Contenedores** (`dumpster`, sólidos; 3-5 por piso, repartidos al azar contra la valla, en horizontal arriba y en vertical a los lados): se **registran** una vez (tapa abierta, polvo, `knock`). El primero de cada piso siempre guarda un arma improvisada y los demás un 45 %; el tipo sale de `STREET_LOOT` con pesos
    (tubo oxidado 4 · cuchillo oxidado 3 · palanca 3) y sale despedido junto al jugador como `Pickup`. **Armas de la calle** (cuerpo a cuerpo, exclusivas del exterior; los enemigos no las recogen; mismo gesto de ataque y ejecución que su base, `STYLE_ALIAS` en `player.js`):

    | Arma | Clave | Efecto | Alcance · cadencia |
    |---|---|---|---|
    | Tubo oxidado | `rustpipe` | noquea e intoxica (3,6 s) | 36 · 0,34 s |
    | Cuchillo oxidado | `rustknife` | noquea e intoxica (**2,2 s**, más corto) | 28 · 0,22 s (muy rápido) |
    | Palanca | `crowbar` | **derriba sin veneno** con aturdimiento ×1,6 (`downMul`: 5,1 s) y arco de 162°; la pasiva de BRUTE no la hace mortal (solo vale con los puños) | 38 · 0,46 s |

  - **Tubo oxidado** (`rustpipe`, `WEAPON_DEFS` con `poison: true`, categoría `blunt`, solo se consigue en la calle; sprite oxidado con veneno verde): **no mata, NOQUEA e INTOXICA** (`Game.poisonEnemy`). Pensado como mecánica propia de las **armas oxidadas** (cualquier arma con `poison`):
    - **Noqueo**: el enemigo cae (`knockDown`, suelta el arma: `¡DESARME!`) y queda **intoxicado**: mientras `poison > 0` **no se levanta** (`Enemy.update` no corre su temporizador de derribo) y **muere solo a los 3,6 s** (`POISON_TIME`; causa `poison`: `STYLE` 350 VENENO, `KILL_FEEL.poison`).
      Un nuevo golpe no es posible (los derribados se rematan); si hay otro golpe de veneno solo renueva el tiempo. El noqueo en sí no puntúa: los puntos llegan al morir.
    - **Remate**: el intoxicado es un derribado normal: se **ejecuta** con el tubo (estilo `pipe`, +1000 EJECUCIÓN) o con lo que lleves, y cuenta como siempre (combo, bajas).
    - **Sangre verde tóxica**: toda baja de un enemigo intoxicado (`e.toxic`), y las ejecuciones/golpes con un arma con `poison` en la mano, sangran **verde** (`isToxicKill`): partículas, restos, chispas, gotas horneadas, charcos y manchas en paredes. Paleta `TOXIC` (`particles.js`: `blood`/`mid`/`dark`/`wet` +
      `TOXIC_GIBS`) frente a `RED`; `Game.bpal` es la paleta activa de `splatBlood`/`bloodSmear`/`splatWalls`/`wallSplat`/`bake` (las partículas llevan `tox` y `bake` la elige por partícula). Solo cambia el color: la sangre del jugador, las huellas y el cadáver (sprite) siguen siendo rojos.
    - **Conteo y combo**: la muerte por veneno pasa por `killEnemy`, así que baja el contador `ENEMIGOS X/Y`, suma o extiende el combo (`score.register`) y, si era el último, despeja el piso (`cleared`).
    - **Jefe**: no se envenena (`!e.guardKill` en `Player.attack`): recibe el golpe como un tubo normal (`MELEE_DMG`/`EXEC_DMG`). Los enemigos no recogen armas oxidadas (`nearestWeapon` exige `ENEMY_MELEE`).
  - **Textos siempre dentro de la pantalla**: `Game.keepOnScreen(x, y, ancho, alto, margen)` limita cualquier texto/caja a la pantalla con margen y zonas seguras; lo usan los textos flotantes, los popups de puntos, los avisos de interacción y las burbujas del vagabundo.
  - **Moneda + máquina + lata**: **dos monedas** escondidas en rincones de la calle, al azar (esquinas; destello fino, más visible de cerca; se recoge a ≤ 18 u; `MONEDA xN` arriba). La **máquina expendedora** (`vending`, en la acera de arriba) con una moneda da una **LATA NEÓN**: `game.buff = { t: 45, max: 45 }`,
    **+18 % de velocidad y −20 % de espera entre ataques** (`BUFF_SPEED`/`BUFF_COOLDOWN` en `player.js`). **Los bonus de velocidad se SUMAN** (STRIKE +30 % + lata +18 % = ×1,48) **con tope ×1,45** (`MAX_SPEED_STACK`): pico con empujón ≈ 430 u/s (< 7,2 u por paso: no atraviesa paredes); solos: base 296, STRIKE 385, lata 350. El tiempo **solo corre dentro del edificio** (`inside`, jugando); es solo de la partida actual (se borra al empezar partida, no se guarda). Barra `LATA NEÓN 44S` arriba al centro.
  - **Cabina telefónica** (`phone`, en la acera): **suena al llegar** (timbre cada 1,8 s con `phoneRing` + ondas parpadeantes) hasta contestar o entrar al edificio. Al contestar sale un cuadro abajo: una **pista de lore** o (60 %) un **reto opcional** con bonus
    (sin disparar +2000 · despejar en < 80 % del par +1500 · combo ×4 +1800). El reto se resuelve en `finishFloor` (`street.settle()` → `Score.addBonus`, antes del rango) y sale en los resultados como `RETO: CUMPLIDO +n / FALLIDO`. (`nogun` mira las estadísticas del último intento.)
  - **Vagabundos** (`npcs.js`, `Vagrant`; 3-5 por piso, generados en `map.street.npcs`): cada uno con su **aspecto** (género m/f, color de abrigo, pelo, piel, gorro —ninguno/gorro de lana/gorra/capucha— y objeto —botella/manta—; las mujeres con melena y más estrechas, los hombres con barba, salvo capucha/manta). Dos modos: **'fire'** (un grupo de 2-3 alrededor de una
    **fogata en un tambor metálico**, `firebarrel` sólido con llamas animadas y resplandor naranja aditivo; miran al fuego y tienden las manos) y **'sit'** (1-2 sentados solos junto a un contenedor). **Tranquilos** dicen frases si te acercas (< 90 u, según el modo); si te acercas (< 150 u) **armado** o **manchado de sangre**
    (`bloodLevel` ≥ 2) **se asustan**: tiemblan, abren los ojos, se apartan sin salirse de su rincón y gritan frases distintas en una burbuja pegada a la pantalla. No pueden entrar al edificio (zona vetada `ban`).
  - **Visión de los civiles** (`Vagrant.seesPlayer`): con el jugador en la calle lo ven siempre; con el jugador **dentro del edificio** (su huella hasta la puerta principal, `ban`) solo si hay **línea de visión directa** (`lineOfSight`: las paredes y las puertas cerradas la cortan; las abiertas, no).
    Sin verlo **no reaccionan** a su arma ni a su sangre (no se asustan ni gritan `¡NO ME HAGAS DAÑO!`) ni le hablan. **Ruido indirecto**: `Game.makeNoise` avisa a `StreetLife.noise`; si el ruido (disparo, golpe, patada) viene del interior del edificio, los civiles que no ven al jugador y están a menos de max(radio × 1,2, 320) u
    miran hacia el edificio, muestran un **«?»** ámbar y sueltan una frase de **alerta indirecta** (`¿ESCUCHASTE ESO?` · `VIENE DE ADENTRO...` · `¿DISPAROS?` · `ALGO PASA AHÍ DENTRO...` · `MEJOR NO ASOMARSE...`); los que están de duelo, agonizando o huyendo no.
  - **Estados del vagabundo** (`Vagrant.state`): `idle` · `scared` · `flee` · `cower` · **`agony`** · **`mourn`** · **`happy`** · `dead`. Las **armas oxidadas** (`poison`) no hieren a un civil: lo **envenenan** (`poisonHit`): cae, **agoniza** el `poisonTime` del arma (3,6 s tubo, 2,2 s cuchillo) con gotas verdes y **muere con sangre verde tóxica**
    (`toxic` → `Game.bleed(..., tox)`: partículas, charcos y paredes, igual que en los enemigos). Cuenta como herido al golpe y como muerto al morir (si el piso acaba mientras agoniza, ya cuenta como muerto: `civilianPenalty`).
  - **Culpa y vómito** (`Game.guilt`, `Player.startVomit/updateVomit`): al **matar o herir de muerte** a un civil (muerte directa, o el golpe envenenado) empieza una cuenta atrás de **3 s** (`StreetLife.startGuilt`; corre en `playing` **y en `cleared`**, así que no se pierde si el piso se despeja enseguida; se congela en pausa, forcejeo y ejecuciones). **Garantía**: `startLeaving` no arranca mientras haya culpa pendiente o vómito en curso: si intentas subir a la moto con la culpa en cuenta atrás, el vómito empieza ya (`guilt.t = 0`) y la fuga arranca cuando termina; al acabar el jugador **se quita la máscara** (queda en su mano; el HUD la apaga),
    se encorva y **vomita 3 arcadas** (2,7 s en total) con partículas y charco **amarillo verdoso** (paleta `VOMIT`, `Game.vomitSplat`: no mancha las suelas ni cuenta como sangre) y sonido `retch`. Mientras tanto está **quieto y vulnerable** (sin mover, atacar ni recoger; `killPlayer` lo cancela). Al terminar se vuelve a poner la máscara (si la llevaba) y hay 0,4 s de espera antes de atacar.
  - **Duelo de los demás civiles** (`civilianDied` → `Vagrant.mourn`): los que quedan vivos a menos de 340 u de la muerte entran en **pánico profundo**: corren (55 u/s) hasta el cuerpo y se **acurrucan** junto a él (más bajos, cubriéndose la cara) **llorando** (lágrimas animadas, frases entrecortadas en burbuja azul y sonido `sob`) hasta que se reinicia el piso. Los que huían de un golpe pasan al duelo al acabar de huir.
  - **Darle una moneda a un vagabundo**: con una moneda en mano aparece `ESPACIO · DAR MONEDA` bajo cada vagabundo al que se pueda dar (`canGift`: una sola vez por persona; ni heridos, ni de duelo, ni muertos); al darla se pone **feliz y agradecido** 7 s (sonrisa, corazón, frases de gracias en burbuja dorada, ya no se asusta) y da **+300 puntos** (`¡BUENA ACCIÓN!`).
  - **Contador de monedas flotante**: un icono de moneda con `xN` bajo la máscara del HUD (arriba a la izquierda) que **solo aparece (y se ilumina con un destello) cuando la cantidad SUBE** (recoger una moneda, la del cocodrilo) y se desvanece solo a los 3,5 s (`coinFlash`). Gastar una moneda no lo muestra.
  - **Daño a civiles**: se pueden **atacar** (puños 1 de daño, cualquier arma 2, balas 3; tienen **3 de vida**; `StreetLife.meleeHit`/`bulletHit`, enganchados en `Player.attack` y `Game.updateBullets`: la bala se detiene en el civil). Al primer daño **huyen despavoridos** 5 s a 150 u/s (con colisión), luego se quedan acobardados
    (`cower`); al morir dejan sangre, un cuerpo tumbado y manchan al jugador. **Penalización** al terminar el piso (`civilianPenalty`, aplicada **antes** del rango en `finishFloor`, nunca más que los puntos del piso): **-400 por civil herido y -1500 por civil muerto**; sale un aviso flotante `¡CIVIL! -400 AL FINAL` al dañarlos y en los resultados la fila `CIVILES: -n (x HERIDOS · y MUERTOS)`.
    Los civiles no puntúan, no cuentan como bajas ni combo, y se reinician con R (como el piso).
- **Puerta principal y umbral**: el bloqueo solo salta cuando el jugador **entra de verdad** al edificio (`Game.inBuilding`); antes (bug) también saltaba al pisar la calle de arriba o de los lados. Fuera del edificio la puerta nunca se cierra: se cruza libremente en ambos sentidos antes de entrar y, tras despejar, al salir.
- **Puerta principal (resto)**: **no cambia**. Antes de entrar y tras despejar el piso se cruza libremente en ambos sentidos; solo se bloquea durante el combate (`SALIDAS BLOQUEADAS`, ver "Llegada en moto, bloqueo del edificio y fuga"), que es la mecánica central del piso. Los objetos de la calle se pueden usar antes de entrar y tras despejar (estado `cleared`).

## Pantallas y estados (`game.state`)
Correspondencia entre las pantallas conceptuales y los valores reales de `game.state`:

| Pantalla | `game.state` | Notas |
|---|---|---|
| MENU | `'menu'` | subpantallas en `game.menu.screen`: `'title'`, `'floors'`, `'records'` (`menu.js`) |
| MASK_SELECT | `'masks'` | antes de cada piso; `Esc` vuelve al menú |
| ARRIVAL | `'arriving'` | cinemática de llegada en moto (saltable); sin combate |
| FORCEJEO | `'scuffle'` | el golpe frontal de un enemigo melee abre un duelo de aporreo con zoom y cámara lenta; ver "Forcejeo" |
| PAUSA | (`game.panel`) | no es un estado: menú modal sobre `playing`/`cleared` (Esc o icono de pausa) que congela el juego |
| PLAYING | `'playing'` · `'dead'` | `playing` incluye fuera del edificio (`inside` false) y dentro con el piso bloqueado; `dead`: `R` reintenta (instantáneo), `Enter` termina la partida |
| LEVEL_CLEAR | `'cleared'` → `'leaving'` → `'results'` | `cleared` = edificio despejado y puerta abierta, vuelve a la moto; `leaving` = se sube y se va (saltable); `results` = rango/tiempo/puntos |
| INITIALS | `'initials'` | solo si la partida entra en el Top 5: pantalla "¡NUEVO RÉCORD! INGRESA TUS INICIALES" antes de `gameover`; ver "Firma de récords" |
| GAME_OVER | `'gameover'` | edificio completado o muerte definitiva; Top 5. `Espacio` partida nueva, `Esc` menú |

Flujo: arranque → `menu/title` → JUGAR (o un piso desbloqueado en `floors`) → `startRunAt(i)` →
`masks` → `arriving` → `playing` (fuera → cruza el umbral: lockdown) → `cleared` → rozar la moto →
`leaving` → `results` → `Enter` → `masks` del
siguiente piso (`goToLevel`) … tras el último → `gameover` → `menu` o partida nueva.

### Transiciones
- `game.transition(action, duración = FADE_TIME 0,25 s)`: fundido a `COLORS.background` con barrido
  de una línea rosa y otra cian; `action` cambia de estado con la pantalla en negro.
  Mientras hay fundido el juego está congelado y la entrada se ignora; no se encadenan dos.
- Usan fundido: menú ↔ subpantallas (0,15 s), menú/selector → máscaras, máscaras → piso,
  fuga en moto → resultados (`finishFloor`), resultados → siguiente piso / fin, muerte (`Enter`) → fin,
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

## Firma de récords (iniciales de arcade, estado `'initials'`)
- `endRun` (edificio completado o muerte definitiva) guarda la partida y, **si entra en el Top 5** (`position` > 0), abre `startInitials` en vez de la tabla: título `¡NUEVO RÉCORD!` (o `¡ENTRAS EN EL TOP 5!`), `INGRESA TUS INICIALES`, el puesto (`1ST`…) y los puntos. Al confirmar
  (`confirmInitials` → `history.setInitials(runId, texto)`) pasa a `gameover` con la tabla y la fila recién firmada destellando. Sin puntos / fuera del Top no se pide nada.
- **4 casillas** (`INITIALS_MAX`) con A-Z, 0-9 y blanco; al menos 1 carácter (con todo en blanco, CONFIRMAR no hace nada y la fila tiembla). Las iniciales salen **preseleccionadas con la última firma**, así que confirmar rápido es solo Enter / OK.
- **PC**: escribir (A-Z, 0-9; Espacio = blanco; avanza solo) · Retroceso/Supr borra (y retrocede si la casilla ya estaba vacía) · ↑/↓ cambian la letra de la casilla · ←/→ cambian de casilla · Enter confirma. Mientras se escribe, `M`, `V`, `R`, `T` y F1 son letras (los atajos globales se desactivan en este estado).
- **Táctil y ratón** (sin teclado del sistema): botones **▲ / ▼** sobre y bajo cada casilla (triángulos de píxeles), tocar una casilla la selecciona, **⌫** y un gran **CONFIRMAR** que late en neón. Tamaño por dedo (`touch.px(46)`, 22-38 px internos) y colocado con `initialsLayout()`, que comparten dibujo y puntero.
- **Tabla HIGH SCORES** (`drawRecordsTable`, también en el menú y con `T`): `1ST/2ND/3RD…`, **iniciales en neón** con halo (`???` si no hay), puntos, piso (`n/6` o `FIN`), combo, máscara y fecha; la fila de la partida recién firmada alterna fondo rosa/ámbar, marcador `>` y las iniciales en blanco/ámbar.

## Guardado de récords (`scores-history.js`)
- Clave `neonrush.scores.v1` en `localStorage`, JSON:
  `{ version: 1, entries: [{ id, score, floor, completed, combo, mask, maskName, date, initials }] }`
  (máx. 5, ordenadas por `score` desc.). `id` = partida (`newRunId()`); `floor` = piso máximo
  alcanzado; `date` = ms epoch (null en entradas heredadas).
- `initials` = la **firma de arcade** (1-4 caracteres A-Z / 0-9, `cleanInitials`; `null`/`???` en entradas antiguas). `record()` conserva las iniciales ya puestas al actualizar la entrada de la misma partida, y
  `saveRun` le pone la última firma usada hasta que se firme. La **última firma** se guarda aparte en `neonrush.signature.v1` (`lastInitials()`/`saveSignature`).
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
| **BLADE** | `tiburon` | tiburón | te pones la máscara con un **cuchillo de carnicero** exclusivo (si no has cogido otra arma antes) |
| **GHOST** | `buho` | búho | tus balas van +20 % más rápidas y con la mitad de dispersión |

- **El `id` no se cambia nunca**, solo el `name`: lo usan los sprites (`head_<id>`, `body_<id>`) y
  los récords guardados (`mask`). La tabla de récords muestra el nombre **actual** buscando por
  `id` (`MASKS.find`), así las partidas guardadas con un nombre antiguo (OSO, GUEPARDO…) salen
  con el nuevo; `maskName` solo es el respaldo si el `id` ya no existe. Este juego es de un solo
  golpe y no tiene vida, por eso ninguna máscara da "resistencia".
- **Agente (JACK / VEX, `playerGender`)**: JACK = `'male'`, VEX = `'female'` (nombres en clave de mercenario arcade, `AGENTS` en `portraits.js`). Selección **puramente cosmética** (silueta, chaqueta,
  coleta, retrato del duelo VS y voz); ambos comparten hitbox, velocidad, daño y armas, y todas las ventajas siguen siendo de las 5 máscaras. Se elige en la propia pantalla ELIGE TU MÁSCARA
  (sin pantallas extra) y se guarda en `neonrush.settings.v1` (opción `playerGender`, también en OPCIONES → JUEGO → AGENTE; `apply` → `game.setGender`): la próxima vez ya sale elegido y
  basta Espacio / Enter. `player.gender` lo fija Game al crear el jugador y al cambiar el ajuste.
  - **Composición** (`maskLayout()`, de arriba abajo): título (y 6) · subtítulo `PRÓXIMO: PISO n · …` (y 25) · **selector JACK / VEX** (y 37) · las 5 tarjetas (con `iconScale` 2-5 según el sitio que dejan la franja
    y el pie) · una **franja** inferior de 64 px con el **visor de vista previa a la izquierda** y el nombre y la pasiva de la máscara a su derecha · una sola línea de ayuda al pie
    (`FLECHAS: MÁSCARA · Q/E: AGENTE · ESPACIO / ENTER: EMPEZAR`). En escritorio, `ESC: MENÚ` y `T: RÉCORDS` van discretos en las esquinas de arriba (en táctil son los botones VOLVER y RÉCORDS).
  - **Botones del agente**: JACK cian (`#05d9e8`) y VEX magenta (`#ff2a85`), con su símbolo ♂ / ♀ de píxeles 9×9 (`drawGenderIcon`); el activo lleva borde y halo de su color y fondo teñido. 74 px de ancho; en táctil
    miden `touch.px(36)` de alto (tamaño de dedo). Se pulsan con **clic / toque** (no empiezan el piso) o con **Q / ↑ / W = JACK · E / ↓ / S = VEX** (← / → / A / D siguen cambiando de máscara).
  - **Vista previa en vivo** (`drawAgentPreview`, 64×64): el agente elegido con la máscara elegida, dibujado con los mismos sprites del juego (`playerBody(máscara, 0, género)`, `drawMaskHead`, `ponytail`), en guardia
    (vaivén de 1 px, puños que suben y bajan, mirada que barre unos grados, coleta de VEX que se balancea) sobre una rejilla con un barrido de luz, marco neón del color del agente y su nombre dentro. Se redibuja cada
    fotograma, así que cambia al instante al alternar JACK / VEX o de máscara (las 10 combinaciones dan imágenes distintas).
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
- **Máscara del HUD con sangre** (`Game.drawHudMask` → `bloodyMaskPortrait(máscara, nivel, 'male', maskBits)`): la miniatura de arriba a la izquierda se va llenando de manchas procedurales (7/16/28/42/60 gotas por nivel, las viejas oscuras y las recientes vivas, con coágulos, regueros y brillos húmedos)
  a medida que sube `player.bloodLevel`; el bitmap está en caché por máscara, nivel y mezcla, así que dibujarla cuesta un solo `drawImage`.
  - **Mezcla rojo / verde**: `Game.maskBits` guarda, por cada gota de la máscara, si es **verde tóxica (1)** o **roja (0)**. `stainPlayer(power, angle, tox)` acumula lo que ensucia desde el último nivel (`accG`/`accT`) y, al subir de nivel, las gotas NUEVAS salen verdes con esa proporción (aleatoriamente), así que la máscara muestra la mezcla de fluidos que el personaje ha acumulado.
    Mancha en verde: matar/rematar con un arma oxidada o a un intoxicado (`isToxicKill`), y civiles envenenados. **Pisar un charco o cadáver** mancha un poco (`Game.soak`, 0,2 de sangre como mucho cada 1,4 s) con el color del charco (`bloodUnderfoot` devuelve 0 · 1 roja · 2 verde; los charcos guardan `tox`). Todo se reinicia con `resetStains()` (piso o partida nuevos); R lo conserva. El cuerpo del jugador y las huellas siguen siendo rojos.
  - **Giro frenético**: al llegar al **nivel máximo** (5) la miniatura gira (~9 rad/s con tirones y un latido de tamaño ±7 %) mientras `state === 'playing'`; se **detiene de golpe y vuelve recta** en cuanto el estado deja de ser `playing` —al caer el último enemigo (`cleared`, "SALIDAS DESBLOQUEADAS"), en la fuga, la muerte o los menús—. Un solo `drawImage` con transformación por fotograma: sin coste apreciable.
  - **Fondo arcoíris de adrenalina** (mismo estado que el giro): detrás de la máscara, dentro del marco de 26×26, un patrón cónico de bandas de píxeles de 7 colores algo oscuros (`RAINBOW`, 2 vueltas del espectro, hecho una sola vez en `rainbowPattern()`) que gira en sentido contrario a la máscara, un velo oscuro (para que se lean las manchas rojas y verdes) y un marco que recorre los colores del espectro. Con `LUCES ESTROBOSCÓPICAS` apagado en Opciones queda **quieto** (bandas fijas, marco de un solo color). Desaparece junto con el giro cuando el estado deja de ser `playing` (al caer el último enemigo).
- HUD: miniatura del retrato (12×12 a ×2) bajo el arma y, debajo del nombre, el contador de
  brutalidad (ver abajo); los resultados muestran la máscara usada.

### Personaje femenino (VEX, `'female'`)
- **Cuerpo** (`PLAYER_BODY_F` en `sprites.js`, misma plantilla y letras que `PLAYER_BODY`): hombros dos filas más estrechos (una por lado), bomber entallada con **rayas rosas** (`q`) en las mangas y en el
  dobladillo de la espalda (que sustituye a la capucha). Mantiene la identidad cian y los colores de cada máscara (`OUTFITS`). Variantes horneadas `body_f_<id>` y `body_f_<id>_b1..5`
  (mismo reparto de sangre por nivel sobre su plantilla); `playerBody(maskId, nivel, gender)` elige la correcta, y `goreEnabled` apagado = nivel 0, como siempre.
- **Cola de caballo**: sprite aparte `ponytail` (10×5, pelo violeta `p/P`, goma rosa `t`) que `Player.draw` pinta bajo la cabeza, con la base en la nuca, rotado por `player.tailA`.
  `Player.updateTail` lo balancea (≈ ±0,3 rad a ~3 Hz al correr, un vaivén mínimo parada) y lo deja **atrás al girar** (proporcional al giro del ángulo de apuntado, tope ±0,8 rad).
  Solo dibujo. Sin máscara (llegada en moto) la cabeza es `bare_f` (el pelo de `bare` en violeta); funciona con armas, ejecuciones, la moto y las capas de sangre.
- **Retrato del duelo VS** (`bloodyMaskPortrait(máscara, nivel, gender)`): lienzo de 28×28 (24 + 2 de margen) mostrado a 56×56 en marcos de 60: la máscara con su sangre y, en `female`, **detrás**
  de ella pelo violeta por arriba y los lados, una coleta con goma rosa que cuelga a la derecha, cuello y hombros estrechos de la bomber con raya rosa bajo la máscara.
- **Voz** (`sfx.voice`: 1 hombre, 1,22 mujer; `setGender`): escala los tonos de los sonidos del jugador `death`, `scuffleIn` y `scuffleWin` y el nuevo gruñido de esfuerzo `grunt` (sierra con formantes
  que baja de tono + soplo de ruido; se oye al empezar el forcejeo, al contraatacar y al morir). Más grave en `male`, algo más agudo en `female`.

### Compañero y relevo (tanda A del piso 10; `docs/prompt-nivel-10-climax.md`)
Base para el piso 10: un **segundo agente** controlable. Sin ningún piso `duo` todavía (el piso 10 llegará en las tandas B y C), así que de momento solo se ve con la tecla de debug.
- **Estado** (`game.js`): `player` = agente activo y `partner` = el otro (`Player`, `agentId 'main' | 'support'`, género opuesto al del primero: `setGender` lo mantiene), con **su propia máscara** (`partnerMask`, `partnerMaskIndex`) y **su propia sangre** (`partnerBlood`: `gore`, `goreGreen`, `maskBits`, `accG`, `accT`). `swapBundles()` intercambia máscara y sangre con el relevo, así el HUD, los resultados y las manchas siguen al activo sin tocar el resto del código. Un piso con `duo: true` en `LEVELS` (devuelto por `loadLevel`) crea al compañero en `reset()` (`makePartner`).
- **Relevo** (`swapControl()`; solo en `playing`/`cleared`, sin ejecución, vómito ni panel): intercambia `player`/`partner`, máscara y sangre, `snap` de cámara, voz del agente, cartel `RELEVO: <MÁSCARA>`, 0,25 s sin atacar. El inactivo **se queda quieto, visible y vulnerable** (`Player.idleUpdate`: solo anima la cola) y se dibuja con una flecha y el nombre de su máscara (`drawPartner`).
- **Vulnerable**: `Enemy.update` elige el **objetivo** (`this.focus`): el jugador, o el compañero si es al único que ve (`canSee`); persecución, cobertura, pánico y disparos usan `focus`. Las balas enemigas lo alcanzan (`updateBullets`) y el golpe cuerpo a cuerpo lo mata sin forcejeo (`partnerStrike`). Si cae: `killPartner` → Game Over con el mensaje `TU COMPAÑERO HA CAÍDO` (`deathMsg`). Si muere el activo, Game Over normal.
- **R**: `reset()` deshace el relevo (`swapped`): vuelve a mandar el primer agente con su máscara y su sangre, y el compañero **reaparece donde estaba** (`partnerPos`, se actualiza cada fotograma; se borra al empezar partida o piso).
- **Selección**: en pisos `duo`, `confirmMask` abre una segunda fase (`maskPhase 'support'`, título `MÁSCARA DE APOYO`, preselecciona la primera desbloqueada distinta); se deniega repetir la misma máscara si hay otra desbloqueada; Esc vuelve a elegir la tuya. **El primer protagonista queda bloqueado**: en esa fase el botón del agente ya elegido (JACK o VEX) sale oscurecido con **candado**, `pickGender` y las teclas Q/E/W/S/↑/↓ solo dan el aviso de denegado (sacudida y sonido), el subtítulo dice `<AGENTE> YA ESTÁ ELEGIDO · ELIGE LA MÁSCARA DE <OTRO>` y el visor y el rótulo muestran al **otro** agente (equipo siempre mixto, un JACK y una VEX).
- **HUD**: mini retrato del compañero con `APOYO` y el nombre de su máscara bajo el retrato principal (en táctil, a su derecha: abajo va REINICIAR); `CAÍDO` si ha muerto.
- **Debug** (con F1 activo): **P** = aparece/desaparece el compañero (máscara desbloqueada siguiente) · **L** = relevo.

### Máscaras bloqueadas y enemigos portadores
- **Estado** (`unlockedMasks` dentro de `neonrush.settings.v1`, `Settings.isMaskUnlocked/unlockMask`; lectura defensiva: solo ids válidos): **NEON y BRUTE** vienen desbloqueadas; **STRIKE, BLADE y GHOST** llevan `lockFloor` 2, 3 y 4 en `masks.js`.
  Nunca se pierden (ni con RESTAURAR).
- **ELIGE TU MÁSCARA**: las bloqueadas salen oscurecidas con un **candado neón** (`drawPadlock`) y su nombre apagado; se pueden mirar pero **no elegir** (Espacio / Enter / clic / segundo toque → `deniedMask`: sacudida, sonido, candado
  y pista parpadean en rojo). La ficha y el visor muestran `BLOQUEADA` · `BUSCA AL PORTADOR EN PISO n` · `ABATE AL ENEMIGO QUE LA LLEVA`.
- **Portador** (`CARRIERS` en `map.js`: piso 2 → STRIKE, 3 → BLADE, 4 → GHOST; `Game.makeEnemy` → `Enemy.setCarrier`, **solo si la máscara aún no está desbloqueada**): un enemigo élite, el más alejado de la entrada, que lleva
  la máscara puesta (cabeza de la máscara sobre su sprite) y un **aura neón** pulsante del color de la máscara (naranja / acero / violeta) con chispas. Su ventaja es la de la máscara:
  STRIKE grunt desarmado **+30 % de velocidad** (patrulla, investigación y persecución) · BLADE grunt con **cuchillo**, golpe **−40 % de preparación** y **+30 % de resistencia en forcejeos** (`scuffleBonus`) · GHOST grunt con **pistola**
  de balas **+25 % más rápidas y la mitad de dispersión**. Con la máscara ya desbloqueada, el enemigo es normal (aunque conserve el reparto de armas del portador).
- **Recompensa** (`Game.dropMask`, al abatirlo con cualquier causa): la máscara **se desbloquea al instante y se guarda**, cae al suelo con un brillo neón aditivo y un icono que flota (`maskDrops`; se recoge por proximidad con
  otra ráfaga de neón y `pickup`; solo es el último destello, no hace falta para desbloquear), sale el texto flotante `¡MÁSCARA <NOMBRE> DESBLOQUEADA!` (2,8 s), ráfaga de neón, sacudida y sonido. Con `R` el enemigo ya no es portador.

### Anuncios (`ads.js`)
- `game.ads` (`Ads`): `triggerInterstitial(onComplete)` y `triggerRewarded(onReward, onCancel)`. **Sin SDK conectado (`enabled = false`, lo actual) son instantáneos y no pausan nada.** Con `ads.connect(adaptador)`
  (`{ interstitial(done), rewarded(done(true|false)) }`, con ejemplos de Poki y CrazyGames en el propio archivo) `pause()` detiene el bucle (`Game.loop` no avanza la simulación mientras `ads.active`, solo redibuja), limpia la entrada y llama a
  `sfx.setAdSilence(true)` (**master a 0 y `AudioContext.suspend()`**: tampoco corre la música; respeta el silencio manual `M`); `resume()` lo restaura sin salto de tiempo. Red de seguridad: reanuda sola a los 45 s.
- **Puntos de anuncio marcados**: entre pisos (`Game.advance()`) y tras X muertes (`Game.restartLevel()` cuando `ads.countDeath()` llega a `AD_EVERY_N_DEATHS` = 3, solo desde la pantalla de muerte; R sigue siendo instantáneo sin SDK).
  `triggerRewarded` queda listo para, p. ej., continuar tras morir.

### Sangre en el personaje
El jugador se va manchando con las bajas **del piso** y la máscara también.
- **Acumulación** (`game.gore`, `game.stainPlayer`): cada baja suma la `power` de su `KILL_FEEL`
  (disparo 1, melé 1,35, ejecución 2,2), así que lo cuerpo a cuerpo mancha más. `bloodLevelFor(gore)`
  (`player.js`) lo traduce en nivel 0..`BLOOD_LEVELS` (5) con `BLOOD_STEPS` = 1, 3, 6, 10, 15. Como
  cada piso empieza limpio y tiene 5, 8 y 11 enemigos, en el piso 1 se llega al nivel 2-3 (4 con
  muchas ejecuciones), en el 2 al 3-4 y el máximo (15 de `gore`) solo en el 3 y con mucho cuerpo a
  cuerpo. Al subir de nivel caen unas gotas sobre el jugador para que se note. `player.bloodLevel`
  es lo que se dibuja.
- **Alcance: por piso, y R lo conserva** (`game.gore`):
  - **Piso nuevo** (`goToLevel`) y **partida nueva** (`startRunAt`): `gore = 0`. Tras subirse a la moto
    el jugador llega al siguiente piso con ropa y máscara limpias (`bloodLevelFor(0)` = 0 → variantes
    sin sufijo `_b`).
  - **Reintento con `R`** (`restartLevel`): **no toca `gore`**: reaparece con la sangre con la que
    murió, aunque esas bajas se deshagan (los enemigos reviven y la puntuación vuelve a la de la
    entrada). Consecuencia: reintentar varias veces **sigue acumulando** sobre lo ya conservado,
    así que un piso difícil se afronta cada vez más manchado (hasta el nivel 5). Si se prefiere
    que R devuelva la sangre a la de la entrada, bastaría guardar `gore` al empezar el piso y
    restaurarlo en `restartLevel`.
- **Dibujo** (`sprites.js`): para cada máscara y nivel se hornean, una sola vez, una variante del
  cuerpo (`body_<id>_b<n>`) y otra de la cabeza (`head_<id>_b<n>`) con las manchas encima. Dibujar
  solo elige el bitmap: cuesta lo mismo con sangre que sin ella (medido: 7 ms para hornear los 77
  bitmaps y ~35 µs por jugador dibujado, igual limpio que en el nivel 5).
- **Densidad** (`BODY_BLOOD`/`HEAD_BLOOD`): cada nivel cubre una fracción exacta y creciente de la
  ropa/pelaje (`fractions`): en el nivel 5 el cuerpo va empapado (75 %) y la cabeza muy manchada
  (60 %). Hay tres tipos de mancha: **racimos** (alrededor de `k` centros), **goterones** (`clots`:
  bloques de hasta 2×2, oscuros, que aparecen a ciertos niveles) y **gotas sueltas** (`drops`).
- **La sangre envejece** (`bloodTimeline`/`bloodAtLevel`): cada mancha recuerda el nivel en que
  nació; la recién salpicada es rojo vivo (`blood`, con algún brillo `bloodWet`), una generación
  después `bloodMid` y luego `bloodDark`; los goterones son `bloodDark` → `gore`. Así el nivel 5 es
  sobre todo sangre oscura con lo último brillando, y la cresta roja del gallo (`#ff2e55`) sigue
  destacando sobre la coagulada.
- **Reglas para que la máscara siga reconociéndose**: las manchas solo caen sobre píxeles de ropa
  o pelaje (`BODY_STAINABLE` `jJLhHx`, `HEAD_STAINABLE` `MRN`), nunca sobre contornos, ojos,
  hocico, pico ni cresta; cada nivel contiene al anterior (la sangre solo se acumula) y son
  deterministas por máscara. Se dimensiona con **fracciones, no con radios**: con radios el nivel
  alto lo cubría todo y el gallo dejaba de verse. Al subir el tope, comprobar las 5 máscaras × 6
  niveles a varios ángulos y que se siguen distinguiendo (en el nivel 5 la máscara BRUTE es la
  que más cerca está del límite: casi todo su pelaje es sangre, pero el hocico y los ojos aguantan).
- **HUD**: una gota roja por nivel (`BLOOD_LEVELS` huecos) bajo el nombre de la máscara; F1 muestra
  el nivel y la sangre acumulada.

### Huellas de sangre
Pisar sangre fresca mancha las suelas y al andar se dejan huellas rojas que se van apagando.
- **Qué mancha las suelas** (`game.bloodUnderfoot(x, y)`): el **cadáver** de un enemigo muerto
  (`e.corpse`, el centro donde se estampa, a `CORPSE_STEP_RADIUS` 14 u) o un **charco de baja**
  (`game.pools`: `splatBlood` anota `{ x, y, r }` con el radio del charco, tope `MAX_POOLS` 60).
  Los derribados no cuentan: no sangran.
- **Carga** (`Player.updateSoles`, `SOLE_MIN`/`SOLE_MAX` = 8..14 pisadas al azar): mientras sigues
  sobre la sangre las suelas se mantienen empapadas y **no se imprime nada** (no se vería); la
  secuencia empieza al salir, con el primer paso a media zancada. Volver a pisar sangre recarga.
- **Zancada**: una huella cada `STEP_DIST` (24 u) de camino **real** (se mide lo que se movió de
  verdad, así empujar una pared no deja huellas), alternando pie (±`FOOT_SPREAD` 5 u de desvío
  lateral respecto al rumbo) y orientada según el rumbo del movimiento, también con joystick.
- **Intensidad en la secuencia**: de 1 (primera, rojo vivo) a 0,12 (última, un rastro apenas
  visible), con `SOLE_FADE` y una curva ^0,85. Elige el tono (`foot` / `footMid` / `footDark`).
- **Con el tiempo** (`Footprints`, `particles.js`): cada huella dura de 6 a 14 s según su
  intensidad, aguanta el 40 % y luego se desvanece (alfa) hasta desaparecer; las más intensas
  duran más. Tope `MAX_PRINTS` 90 (se descartan las más viejas).
- **Capa**: lista corta que se dibuja cada fotograma (`game.prints.draw`) justo después de la capa
  de sangre del suelo: encima de las baldosas, bajo los muebles, los personajes y las partículas.
  No va a la capa de sangre porque esa es permanente y las huellas deben borrarse solas. Se limpia
  en `reset()` (`R` y cambio de piso). Coste medido: 0,6 ms por fotograma con 90 huellas en Edge
  sin GPU (lo normal son menos de 15); actualizar recompacta la lista en el sitio, sin crear
  arrays.
- F1 muestra el nº de huellas vivas (`PISADAS`) y las pisadas de carga que le quedan (`SUELAS`).

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
- **Limpieza de nodos**: toda fuente lleva `onended` que desconecta lo suyo (`tone` y `noise` lo hacen
  y devuelven su fuente con `startAt`; `motoVoice` desconecta toda la cadena al acabar la última). Lo
  que dure más de un instante y pueda cancelarse (la moto) es una **voz con `stop…()`** que se llama
  desde `reset()` (R, piso nuevo), al saltar una cinemática y con `M`; al cortarla caen a 0,0001 en
  unos ms y los sonidos puntuales aún por empezar arrancan y paran a la vez, sin sonar. En silencio
  (`M`) no se crea ningún nodo nuevo.

### La moto (`playMotoArrival` / `playMotoDeparture` / `stopMoto`)
El motor es una **voz propia** de `Sfx` (`motoVoice`), no un efecto de `SOUNDS`: dura varios segundos,
cambia de régimen todo el rato y se tiene que poder cortar limpia. Es Web Audio puro, sin archivos.
- **Cadena**: sierra + triángulo (45-165 Hz; el triángulo desafinado +9 cents) → `WaveShaper` tanh
  (`saturationCurve`, simétrico: sin DC) → paso-bajo resonante (Q 7; su frecuencia es el "cuerpo" y se abre
  al acelerar) → **modulación de amplitud por un LFO** (el pistoneo, a `0,22 ×` las revoluciones,
  profundidad variable) → envolvente `out` → `bus` de la voz → master. Un ruido grave filtrado hace de
  escape. Los chirridos y clics cuelgan del mismo `bus` (`v.fx`), así que se paran con la voz.
- **Llegada** (`beginArrival`, `playMotoArrival({ ride, dismount })`, 2,45 s): las revoluciones siguen la
  velocidad de la moto en pantalla —(1 − t/ride)²: 150 → 40 Hz—; chirrido de goma sobre el asfalto
  (dos capas solapadas, ~0,45 s) y raspado seco al clavar; ralentí en ~41 Hz; al bajar el jugador se
  apaga (tosido grave, cae a ~26 Hz) y calla.
- **Fuga** (`startLeaving`, `playMotoDeparture({ board, ride, tail })`, 0,4 + 1,35 + 0,3 s): 1) clic de
  contacto, golpe del arranque y motor de arranque; 2) ralentí (~41 Hz) con un golpe de gas y, al
  arrancar la moto, **acelerón**: 62 → 160 Hz en 0,22 s con el filtro abriéndose a ~2,6 kHz y dos cambios
  de marcha; 3) al salir de la pantalla el volumen cae, el filtro se cierra y el tono baja ~260 cents
  (Doppler de alejamiento). El `tail` (0,3 s) cubre el fundido (`FADE_TIME` 0,25 s): la voz sigue
  sonando al llegar a resultados, ya en −80 dBFS, y se libera sola; no se corta de golpe.
- **Faro y humo** (solo dibujo): en la **fuga** (`state 'leaving'`, tras subirse) `drawBike` proyecta desde el faro un **cono de luz** semitransparente (22 bloques sumados que se abren y se apagan con la distancia; su luz crece
  en los primeros 0,5 s) y, mientras acelera, el escape deja **humo gris** (más denso al arrancar, `particles.dust`) y chispas de **neón** cian/magenta (`particles.neon`) hacia atrás.
- **Cortes** (`stopMoto(fade)`: rampa exponencial a 0,0001 y para fuentes y sonidos puntuales ya
  programados): `reset()` (R, piso nuevo, nueva partida: 0,05 s), saltar la llegada (0,12 s) o la fuga
  (0,2 s), `toggleMute` (0,03 s) y cualquier nueva `playMoto…` (0,04 s). En silencio o con el contexto
  suspendido (`motoReady`) no se crea ningún nodo.
- **Medido** (render offline en el navegador, `OfflineAudioContext`): pico 0,31 (llegada) y 0,37 (fuga),
  sin saturación ni NaN; el tono sigue las curvas previstas (llegada 108 → 91 → 76 → 64 → 54 → 47 → 43 →
  41 Hz; fuga 41 → 149 → 162 → 128 Hz) y el brillo de la fuga sube de ~190 a ~1440 Hz y baja a ~170 Hz.
  Balance: el acelerón queda ~6 dB sobre el ambiente vacío (cuya energía es casi toda sub-grave) y
  la llegada ~9-11 dB sobre la música tranquila; el ambiente recupera el protagonismo al irse la moto.
  Si se retocan las curvas, repetir esa medición y el banco de pruebas (Web Audio simulada estricta:
  rampas a ≤ 0, nodos sin desconectar tras 80 inicios/cortes rápidos).

## Mecánicas de combate
- Daño: todo es de un golpe, con una excepción: el choque cuerpo a cuerpo de frente se resuelve con la matriz de combate (forcejeo, disparo de pánico o muerte según las armas; ver "Matriz de combate"); por la espalda, de bala o del jefe sigue matando al instante. Lo que cambia es el efecto: **matar** o **derribar** (estado `down`
  ~3,2 s, luego se levanta; se remata con una **ejecución**, ver "Ejecuciones").
  Cualquier arma **lanzada** (clic derecho) derriba si va a más de 160 px/s.

### Game feel de arcade (solo dibujo y partículas)
- **Disparo**: además del sprite del fogonazo (`muzzle`) y del **casquillo** de latón que sale despedido hacia un lado y queda en el suelo (`particles.shell`, ya existían), la boca del arma lleva un **halo de luz aditivo**
  (`Player.drawMuzzleGlow`: tres discos de píxeles ámbar/crema/blanco que se apagan en 0,06 s) tanto en el disparo normal como en las ejecuciones con arma de fuego.
- **Textos flotantes** (`game.floatingTexts`, `addFloat`/`drawFloatingTexts`; se limpian en `reset`, tope 15): suben ~26 u, entran con un "pop" a doble tamaño y se desvanecen al final. `¡QUEMARROPA!` en el disparo defensivo,
  `¡DESARME!` (o `¡GOLPE!` si iba sin arma) al derribar con un arma lanzada (`cause 'thrown'`) y el **multiplicador** del combo (`x2`, `x3`…; cian, ámbar desde x3, rojo desde x5, a doble tamaño desde x4) en cada baja encadenada
  (`addScore`). Conviven con los popups de puntos (`score.popups`).

### Estadísticas del intento (`game.stats`, `statsSummary`, `drawStatsPanel`)
- Se cuentan por **intento de piso** (`newStats()` en `reset()`, así que R las reinicia): `attacks` (golpes cuerpo a cuerpo —sin patadas a puertas ni ejecuciones— y disparos, `recordAttack`), `hits` (golpes que conectan y disparos
  cuyas balas alcanzan a alguien, `recordShotHit` por `b.shot`; el disparo defensivo y el contraataque cuentan como acierto), `kills` (cada `killEnemy`) y `uses` por arma (puños = `fists`). Resumen: `TIEMPO: m:ss` (`game.time`), `PRECISIÓN: hits/attacks`
  (`--` sin ataques), `BAJAS` y `MÁS USADA` (el arma que más veces se ha usado en el intento, con su nombre corto `short` de `WEAPON_DEFS` si lo tiene —p. ej. `CUCH. CARNICERO`—; el panel ensancha lo justo, hasta 190 px, para que etiqueta y valor no se solapen: `statsPanelWidth`; no la de más bajas, porque en un piso se cambia de arma).
- Un **mini panel flotante** (marco neón, 4 líneas) sale en los **resultados** (a la izquierda del bloque en pantallas de ≥ 400 px; en estrechas, una línea `BAJAS · PRECISIÓN · ARMA`; la instantánea queda en `results.stats`) y en la **pantalla de muerte**, bajo la franja `HAS MUERTO`.

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
| Cuchillo | `knife` | mata | 30 (arco 108°) | 0,25 s | — | el de los enemigos y de los pisos |
| Cuchillo de carnicero | `cleaver` | mata | **38** (arco 144°) | 0,27 s | — | **exclusivo de BLADE** (arma inicial): más alcance, golpe más pesado (sacudida 3,5) y **ejecución más rápida**: 2 hachazos en 0,44 s (el cuchillo: 3 puñaladas en 0,7 s); contra el jefe quita 3,5 por golpe y 4,5 en ejecución (cuchillo: 2 y 3,5). No sale en pisos ni contenedores y los enemigos no lo recogen. Se anima como el tubo (levanta y golpea; `POSE_STYLE`) |
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
- Toda baja/derribo pasa `cause` (`execution`, `door`, `thrown`, `melee`, `bullet`, `fists`) a
  `killEnemy`/`knockDown` para puntuar con `score.register`.

### Armas enemigas (`ENEMY_WEAPONS`)
| Arma | Alcance | Aviso (mira láser) | Disparos | Pausa | Suelta |
|---|---|---|---|---|---|
| Pistola | 320 | 0,38 s | 1 | 0,7 s | pistola con 4 balas |
| Subfusil | 280 | 0,45 s | ráfaga de 4 (cada 0,09 s) | 0,95 s | subfusil con 12 balas |
| Escopeta (guardia pesado) | 250 | 0,55 s | 5 perdigones en abanico ±0,3 rad (alcance 270) | 1,2 s | escopeta con 2 balas |

- **Armas de los enemigos** (`ENEMY_MIX` en `map.js`, sorteado con el `rng` del piso: R no lo cambia): además de las pistolas/subfusiles/escopetas, los enemigos desarmados
  (grunt y corredor) pueden llevar **bate, tubo o cuchillo** (`e.meleeWeapon`; `ENEMY_MELEE`: bate alcance +22 y preparación 0,28 s, tubo +19 y 0,22 s, cuchillo +12 y 0,16 s;
  el corredor ×0,7 de preparación) con probabilidad por piso 0,5 · 0,6 · 0,65 · 0,8 (Club) · 0,55 · 0,6, y un grunt de cada 10-30 % lleva pistola (`arm`). Dibujan el arma
  (se levanta al prepararse, barre al golpear) y la **sueltan** al morir o caer derribados (`Game.dropWeapon`), para que el jugador pueda recogerla.
- **IA de pánico** (`Enemy.updatePanic`, estado `'panic'`): un enemigo **desarmado** (nunca tuvo arma o la perdió, p. ej. por un lanzamiento) que te ve con **cualquier arma** en la
  mano no corre a pegarte: tiembla (1 px), suda (gotas cian) y muestra un `!` cian. 1) Si hay un arma **usable** en el suelo a ≤ 360 u (cuerpo a cuerpo, o de fuego con balas;
  alcanzable y a > 40 u de ti) corre a por ella (`nearestWeapon`) y se arma (`takeWeapon`: vuelve a `chase` con 0,5 s de respiro); 2) si no, **huye** (`pickFlee`: de 16 rumbos
  y 3 distancias elige el punto más lejano de ti, mejor si queda fuera de tu línea de visión); 3) si lo **acorralas** (< 42 u durante 1 s) se rinde a pelear con los puños
  (`noPanic` 4 s). Si te quedas sin arma o muere el jugador, vuelve a `chase`. Los armados, el jefe y los forcejeos no entran en pánico.
- **Variantes de enemigo** (`Enemy(kind)`, letra del mapa): **corredor** `R` (sprite rosa; patrulla ×1,5 y persigue ×1,16 ≈ 223 u/s,
  aún por debajo del jugador; golpea tras 0,12 s en vez de 0,17 s) y **guardia pesado** `H` (hitbox 11, ×0,88 de velocidad, escopeta; sprite
  granate). Cada uno tiene su `sprite`/`corpseSprite` (recolores en `sprites.js`).
- Si el enemigo pierde la línea de visión, el aviso y la ráfaga se cancelan (cubrirse tras
  esquinas funciona). Al morir o ser derribado suelta su arma.

### IA táctica: ruidos, alarmas y coberturas (`enemy.js`, `Game.makeNoise/raiseAlarm`)
- **Investigar ruidos** (`Enemy.hear`): disparos, golpes y patadas (`makeNoise`) hacen que los enemigos en patrulla/búsqueda se **paren 0,35 s mirando hacia el ruido** (`listenT`) y vayan a investigarlo. Un ruido detrás de una pared o puerta cerrada se oye **apagado** (radio ×0,6, `lineOfSight`). Si ya investigan, se quedan con el ruido más cercano. Los que persiguen, están alerta o derribados lo ignoran.
- **Alertas en cadena**: el enemigo que **te ve por primera vez** (cada 5 s como mucho, `shoutCd`) o que **descubre un cadáver** a la vista (`scanCorpses`, cada ~0,35 s, `¡CADÁVER!`, el cuerpo queda `found`) da la voz: `Game.raiseAlarm` hace **un solo BFS** por el grid (atraviesa puertas, `ALARM_REACH` 18 casillas de recorrido) y los enemigos alcanzados (salas contiguas) pasan a `answerAlarm`: **corren** (92 % de la velocidad de persecución, `hurry`) a la zona con un retraso de 0,03 s por casilla, en **estado de combate** (`alarmed`: si te ven reaccionan en 0,07 s en vez de 0,18). El jefe no responde. Al volver a patrulla se les pasa.
- **Frases de los enemigos** (`barks.js`, `Game.bark`; texto flotante sobre su cabeza): **`¡CADÁVER!` solo lo grita el primer enemigo que encuentra cada cadáver** (`found`, con alarma); los que lo ven después (cada enemigo reacciona a cada cadáver una sola vez, `seenCorpses`) sueltan una frase de tensión el 45 % de las veces (`¡MIERDA!`, `¡SIGUE FRÍO!`, `¡NOS ESTÁN CAZANDO!`…) o se quedan callados, sin repetir la alarma. Al **avistarte por primera vez** (`spotted`, una vez por enemigo) eligen: **45 % frase de tu máscara** (tiburón: `¡ES EL DEL TIBURÓN!`, `¡VIENE CON EL CUCHILLO!`; gallo, oso, guepardo y búho tienen las suyas, de reconocimiento, burla o pánico), **30 % frase de tu género** (`game.gender`: `¡ES UNA CHICA!`… / `¡A POR ÉL!`…) y el resto neutras (`¡AHÍ ESTÁ!`). Límite global: **una frase cada 0,9 s** en toda la partida (`barkCd`) y nunca la misma dos veces seguidas (`lastBark`), salvo `¡CADÁVER!`. Sin coste de IA: es un texto flotante.
- **Cobertura al disparar** (`updateCover`/`findCover`; el 80 % de los armados, `coverOk`; nunca el jefe): al verte a ≤ 1,4× su alcance **buscan una casilla a ≤ 6 casillas pegada a un mueble o esquina** que los oculte de ti, con una casilla contigua desde la que te vean a tiro, alcanzable en línea recta, a > 110 u de ti y no reservada por otro enemigo. Juegan al **asomar**: `seek` (corren a la cobertura) → `hide` (0,5-1,4 s, mirándote) → `peek` (salen, disparan su ráfaga) → `hide`… Tras **3 ciclos**, si te pegas a < 80 u, si tardan > 3,5 s en llegar o si rodeas la cobertura, la dejan (enfriamiento 3-6 s) y se lanzan a por ti. Los cuerpo a cuerpo no se cubren. F1 sigue mostrando el estado `chase`.
- **Rendimiento / móvil** (`resetAiBudget`, lo llama `Game.update` cada fotograma): presupuesto compartido de **4 rutas BFS por fotograma (2 en táctil)** y **1 búsqueda de cobertura**; lo que se queda sin presupuesto sigue por línea recta o con su ruta anterior y reintenta en el siguiente fotograma. Los `repath` van **desfasados al azar** al crear al enemigo. Medido: `findCover` ≈ 0,08 ms por llamada, `raiseAlarm` un BFS de unos cientos de casillas (con enfriamiento), nada por fotograma salvo `scanCorpses` (≤ 12 enemigos cada ~0,35 s).

### Matriz de combate cuerpo a cuerpo y forcejeo ("estilo VS", `game.js`: `enemyStrike`, `startScuffle`, `updateScuffle`, `drawScuffleFx/UI`)
Cuando un enemigo te alcanza con su golpe, `Enemy.updateChase` llama a `game.enemyStrike(e, ángulo)`. El resultado es **determinista** y sale de la **categoría de
armamento** de cada uno (`weaponCategory` en `weapons.js`: `unarmed` puños · `blunt` bate y tubo · `blade` cuchillo · `gun` pistola, escopeta y subfusil; una arma de
fuego **sin balas cuenta como puños**, `Game.playerCategory`; la del enemigo es `Enemy.category`):

| Tú \ Él | unarmed | blunt / blade |
|---|---|---|
| **unarmed** | **FORCEJEO** de puños (`PUÑO CONTRA PUÑO`) | te mata (su arma es superior) |
| **blunt / blade** | matas tú, al instante (`playerCounter`) | **FORCEJEO** = choque de armas (`BATE CONTRA TUBO`…) |
| **gun** con balas | **DISPARO DE PÁNICO** (`defensiveShot`) | **DISPARO DE PÁNICO** |

- Bate/tubo/cuchillo entre sí son el mismo escalón (cualquier combinación melee contra melee es un choque de armas). Un golpe **por la espalda** (fuera de ~100° de hacia
  donde miras: `|angleDiff(ángulo+π, p.angle)| < 1,75`), estar **rematando**, un enemigo con **arma de fuego** y el **jefe** matan siempre al instante (`killPlayer`).
- **Disparo de pánico**: tiro instintivo a quemarropa: abate al enemigo, gasta 1 bala, retroceso del arma, pausa de recuperación de 0,5 s (`p.cooldown`) y cartel
  `¡DISPARO DE PÁNICO!`. Con la pistola vacía el enemigo sí te golpea (o forcejeas si va con puños).
- **Iniciativa** (`Player.attack`): quien golpea primero gana. Un enemigo que ya prepara su golpe o su disparo (`windup`/`aim` > 0) se alcanza con un arco ×1,3 (tope 216°)
  y +6 u de alcance, así que tu golpe conecta antes de que complete el suyo; tus disparos son instantáneos. Tras un forcejeo hay 0,6 s de inmunidad (`scuffleGrace`).
- **Choque de armas**: igual que el forcejeo de puños pero con efectos propios: en cada pulsación saltan chispas de metal y suena `ricochet` si hay un cuchillo, o astillas
  (`particles.splinters`) y un golpe seco si son contundentes; el titular de la pantalla VS dice quién contra quién (`sc.label`, nombres de `WEAPON_DEFS`).
- **Estado** `'scuffle'` (`this.scuffle = { e, bar, t, mult, surge, … }`): el mundo se congela (solo corre `updateScuffle`, partículas a ×0,35).
  Se mira a la cara; `Esc` no pausa; `R` reinicia (`reset()` limpia `scuffle`, zoom y audio).
- **Minijuego** (`SCUFFLE`): barra 0..1 que empieza en 0,5. Cada pulsación nueva (flanco de **ATACAR, PATEAR o REMATAR** con las teclas que estén asignadas, o `tapAttack`, es decir el botón
  ATACAR táctil o un toque del joystick derecho; mantener no cuenta) suma **0,10**; el enemigo la baja a **0,33/s × resistencia**, con un pico ×1,8 durante 0,4 s
  cada 1,3 s. Llena = **contraataque** (`winScuffle`: remate `killEnemy(…, 'execution')`, sacudida 22, hit-stop 0,14, cartel `¡CONTRAATAQUE!`); a 0, o a
  los 7,5 s con la barra bajo la mitad = el enemigo te ejecuta (`loseScuffle` → `killPlayer`: pantalla de muerte, **R** = `restartLevel`).
  La pulsación que llena la barra gana antes de que el empuje la baje.
- **Fatiga**: `resistencia = min(2,2, 1 + 0,22 × (forcejeos del piso − 1))`, mostrada como `RESISTENCIA X1,7`. `scuffleCount` se reinicia al empezar piso o partida y **se
  conserva con R** (como la sangre). Medido (pulsaciones/s necesarias): 1.º ≈ 5/s, 3.º ≈ 6-7/s, 8.º ≈ 10/s.
- **Retratos** (`src/portraits.js`; el del jugador a 56×56 en marcos de 60, el del rival a 48×48 centrado; ver también "Personaje femenino"): el tuyo es `bloodyMaskPortrait(máscara, player.bloodLevel)`: el retrato de frente de la máscara (el de las
  tarjetas) a 24×24 con gotas sobre los píxeles opacos en un orden fijo por máscara (semilla), 0/7/16/28/42/60 según el nivel de sangre, con la antigua más oscura, coágulos 2×2,
  regueros que solo bajan por la máscara y brillos húmedos; con `goreEnabled` apagado sale limpia (nivel 0). El del rival es `villainPortrait(kind)`: un rostro 12×12 en penumbra por tipo
  (`grunt`: gorra morada, ojos ámbar, cicatriz y mandíbula; `runner`: capucha rosa, pañuelo cian y rendijas de neón), con marco y `VS` del color del villano, sombra sobre la mitad
  inferior y ojos que parpadean cada ~2 s. Para añadir un villano: entrada en `VILLAINS` (`rows`, `palette`, `eyes`, `frame`).
- **Zoom** (`Camera`: `base` × `mul`, `zoom` es un getter; `mulTarget` 2 y se acerca con `1 − e^(−9dt)`; el seguimiento va más rápido, centrado en el punto medio
  de los dos). Vuelve a 1 al resolverse. Es un múltiplo exacto (×2), así el pixel art sigue nítido.
- **Filtro VS** (`drawScuffleFx`, intensidad `scuffleI` suavizada): tinte `overlay` magenta/cian que alterna cada 120 ms, viñeta escalonada de 7 anillos,
  bandas cian (tú) / magenta (ellos) en los laterales, barras de cine con filos de color y aberración cromática (`fx.kick`). **UI** (`drawScuffleUI`): retratos
  enfrentados con un gran `VS` con doble sombra, barra de tensión cian/magenta con marcador y chispas, que late más rápido (y se pone roja) por debajo del 30 %,
  y el aviso `¡APORREA CLIC / ESPACIO!` (`¡APORREA ATACAR!` en táctil). En táctil el botón ATACAR parpadea en rojo/blanco.
- **Audio en cámara lenta** (`Sfx.setSlowMo`, `slow` 0..1 que `scheduleMusic` acerca a su objetivo ≈ 0,35 s): tono −40 % (`pitch`: lo aplican `tone`, `noise` y los
  osciladores propios de la música y el ambiente) y velocidad −50 % (`nextNote += STEP_TIME / (1 − 0,5·slow)`), como una cinta que se frena; vuelve solo.
  Sonidos nuevos `scuffleIn` (frenazo grave) y `scuffleWin`. Sin contexto de audio solo se guarda el objetivo; en silencio no se crean nodos.
- La puerta/otros: durante el forcejeo no avanzan enemigos, balas ni puertas; `killPlayer` exige `state === 'playing'`, por eso `endScuffle` vuelve a ese estado antes.

### El jefe: EL EJECUTOR (`boss.js`, piso 6)
Un matón hiper-acorazado (`Boss extends Enemy`, hitbox 14, **12 de vida**, barra arriba al centro con marcas al 60 % y 30 %). Se queda quieto
(`awake` = false, vigila) hasta verte a ≤ 150 u, oírte o recibir un golpe; al despertar sale el cartel `¡EL EJECUTOR!`. El resto del piso
cuenta igual: el piso se despeja al caer todos, jefe incluido.
- **Ataques** (cada uno con aviso; `mode`: `cool` → ataque → `recover` → `cool`): **embestida** (`windCharge` 0,78/0,62/0,50 s según fase: línea roja
  en el suelo; el rumbo se bloquea en el último 30 % del aviso; carga a 430 u/s hasta 1,7 s, lo bastante para cruzar la arena; mata si te
  alcanza), **tajo** (`windSlash` a < 52 u, arco de ~63°) y **descarga** de escopeta con mira láser (`windVolley`, solo si te ve; 2 en la fase 3).
  Las fases (`phase` 0/1/2 por vida) lo aceleran y acortan el respiro (1,0/0,7/0,45 s).
- **Entorno**: si la embestida choca con una pared o un mueble (`moveAndSlide` con `hitX/hitY`) queda **aturdido** 2,4 s (`crash`: sacudida 16,
  polvo, chispas). **Las puertas las revienta** (`door.kick`) y sigue; las bloqueadas cuentan como pared. Úsalo de cebo: ponte tras una columna
  de la arena o al fondo en línea con un muro.
- **Coraza** (`guardKill`/`guardKnock`, los llama `Game.killEnemy`/`knockDown` antes de matar): un golpe cuya dirección difiere más de
  `π − 1,22` del frente del jefe viene de frente (si está derribado no cuenta la coraza). De frente: pistola y subfusil **rebotan** (0), escopeta
  0,3 por perdigón, cuerpo a cuerpo 0 (rebota y el jugador se resiente 0,3 s). Por la espalda/costados: pistola 1,5 · subfusil 0,6 ·
  perdigón 0,9 · bate 3 · tubo 2,5 · cuchillo 2 · puños 1,5. Las balas del jugador llevan `b.src` (tipo de arma) para distinguirlo.
- **Aturdimiento**: arma lanzada (2,6 s), portazo o choque (2,4 s) → `state 'down'`, rematable. La ejecución es lo que más daña
  (`EXEC_DMG`: bate y escopeta 4,5 · tubo/cuchillo/pistola 3,5 · puños/subfusil 3; los golpes intermedios `onWound` restan 0,8 y nunca
  rematan). Tras levantarse es **inmune a nuevos derribos 2,5 s** (sin aturdimiento encadenado). Los puños no lo derriban.
- **Dificultad justa**: con arma lanzada o un choque + remate (≈ 4,5) bastan unos 3 ciclos; la escopeta de cerca y el bate por la espalda
  aceleran la pelea. Cambiar de arma importa: pistola/subfusil solo sirven si lo rodeas.
- Cadáver: `bossCorpse` a escala 1,5 (`corpseScale`). F1 muestra `mode` y vida sobre el jefe.

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
  - **Patada**: la acción PATEAR/INTERACTUAR (`Espacio` o `F` por defecto), golpe cuerpo a cuerpo sin enemigo delante o botón ATACAR en táctil
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
- Hit-stop (`HITSTOP` en `game.js`): baja por disparo 50 ms, baja cuerpo a cuerpo 55 ms, ejecución
  70 ms, derribo 35 ms, portazo 70 ms, muerte del jugador 120 ms. Con varias bajas o un portazo en
  curso se queda el mayor (`Math.max`), nunca se acorta.

### Ejecuciones (remate de un derribado)
Un enemigo derribado (estado `down`, ~3,2 s) se remata con una **ejecución**: una secuencia corta
en lugar de un golpe instantáneo. Sustituye al antiguo remate instantáneo (`finisher`).
- **Detección** (`Player.executionTarget(game)`): el derribado más cercano a `FINISH_RANGE` (34 u
  más su radio), **a la vista** (`lineOfSight`: una pared o una puerta no se atraviesan) y que no
  esté ya siendo rematado. Es la única fuente de verdad: la usan el ataque, las teclas PATEAR/REMATAR y el
  indicador, así que lo marcado en pantalla es exactamente a quien se golpea. Con dos derribados
  juntos se ejecuta primero el más cercano y el otro sigue con su aturdimiento.
- **Disparador**: clic izquierdo / botón ATACAR en táctil (en `attack()`, antes que cualquier
  golpe al aire) o las teclas **REMATAR** (`E`) y **PATEAR** (`Espacio`/`F`) (esta última patea la puerta y, si hay
  un derribado a tiro y, si no, patea).
- **Indicador** (`game.drawExecuteMarks` + `drawExecutePrompt`): corchetes neón rojo/blanco sobre el
  objetivo (más tenues sobre los otros derribados al alcance), que parpadean más rápido si está a
  punto de levantarse (`timer` < 0,9 s) y se cierran sobre él durante la carga, y la etiqueta
  `E · CLIC IZQ` (las teclas asignadas a REMATAR y ATACAR, `keys.label`; `REMATAR` en táctil, con `game.hint`) debajo del enemigo para no chocar con los
  popups de puntos, que flotan por encima.
- **Secuencia** (`Player.exec = { target, t, hit, hitIdx, style, spec }`; `EXEC_STYLES[style] = { time, hits[] }`): el jugador queda
  **clavado** (sin movimiento, ataque ni recoger/lanzar: `update` sale pronto), mirando al objetivo. Cada golpe es un ciclo de carga y
  recogida; los `hits` intermedios solo **hieren** (`game.woundEnemy`: sangre, sacudida, sonido) y el último es la baja. Suena
  `execWind` al empezar y `crunch` al golpear.
- **Una ejecución distinta por arma** (`startExecution` elige el estilo; `execPose`/`drawExecTool` lo dibujan):

  | Arma | Estilo | Tiempo | Golpes (s) | Qué se ve |
  |---|---|---|---|---|
  | Puños | `stomp` | 0,42 | 0,27 | pisotón (sprite `boot`) |
  | Bate | `bat` | 0,64 | 0,44 | swing enorme y lento hacia la cabeza: se levanta a ×2,4, el cuerpo se echa atrás y cae con sacudida 16 |
  | Tubo | `pipe` | 0,58 | 0,20 · 0,40 | dos golpes secos seguidos |
  | Cuchillo | `knife` | 0,70 | 0,17 · 0,30 · 0,44 | no se levanta: el brazo se echa atrás y puñala tres veces hacia delante |
  | Pistola | `shoot` | 0,42 | 0,27 | disparo a quemarropa |
  | Escopeta | `blast` | 0,52 | 0,32 | descarga con gran retroceso (sacudida 18, chispas ×16) |
  | Subfusil | `burst` | 0,52 | 0,24 · 0,31 · 0,38 | ráfaga de tres (gasta 3 balas) |
  | Arma de fuego vacía | `smash` | 0,42 | 0,27 | culatazo de arriba abajo |

  Las herramientas que se levantan (pisotón, bate, tubo, culatazo) se dibujan al doble de tamaño y por **encima** del jugador (en vista
  cenital "arriba" es hacia la cámara); el cuchillo y las armas de fuego no se levantan.
- **Ataque normal por arma** (`Player.draw`): el **bate** barre un arco que arranca lento y acaba fuerte (`t^1,6`); el **tubo**, un arco
  uniforme; el **cuchillo** puñala hacia delante (sin girar) con un empuje del cuerpo; las armas de fuego **retroceden** (`RECOIL`: pistola 3 u,
  escopeta 6 u + bombeo de la corredera, subfusil 1,5 u por disparo). Todo vive en el jugador, así que sirve igual con ratón y con táctil.
- **Golpe** (`landExecution` → `killEnemy(e, ángulo, 'execution')`): `KILL_FEEL.execution` (ver la
  tabla de arriba) con hit-stop **70 ms**, la sacudida más fuerte (14), el charco mayor y un
  salpicado hacia donde cae el golpe; `crunch` en vez de `hit`; +1000 puntos **EJECUCIÓN** (el
  doble que el antiguo remate; se multiplican por el combo); `stainPlayer` con `power` 2,2 (sube el
  nivel de sangre del jugador) y `wetSoles()` (suelas empapadas: 8..14 huellas). Ruido de 220 u (un
  golpe sordo) o el del disparo.
- **Seguridad, sin estados bloqueados**: mientras lo rematan, el derribado tiene `executing` y su
  aturdimiento se **congela** (no se levanta a mitad del golpe; sacude el sprite 1 px); el
  jugador sigue siendo vulnerable (el juego es de un solo golpe: es el riesgo de ejecutar). Si lo
  matan a mitad, `killPlayer` llama a `cancelExecution()` y el derribado queda libre; si el
  objetivo desaparece o se levanta antes del golpe, la ejecución se aborta sola (`updateExecution`)
  y no hay doble baja. Al acabar queda un enfriamiento de 0,12 s. F1 muestra `EJECUCION`.

### Sangre y ejecuciones
Cada baja pasa por `killEnemy(e, ángulo, causa)` (y la del jugador por `killPlayer`), que consulta
`KILL_FEEL` (`game.js`) según la causa y llama a `bleed()`:

| Causa | Sangre/restos (`power`) | Salpicado (`wide`) | Sacudida | Hit-stop |
|---|---|---|---|---|
| `bullet` | 1 | cono estrecho (±0,55 rad) | 7 | 50 ms |
| `melee` (tubo, bate, cuchillo, puños de BRUTE) | 1,35 | arco abierto (±0,9) | 10 | 55 ms |
| `execution` (remate de un derribado) | 2,2 | cono abierto hacia el golpe (±1,3) | 14 | 70 ms |

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
  Moto (`bike`, 32×13 px, ruedas con banda de rodadura clara para que no se pierdan sobre el
  asfalto) con sombra propia dinámica (`bikeShadow`: la moto se mueve en las cinemáticas, no va en la
  capa estática). Puerta principal: `doorMain` (cian) / `doorLocked` (roja) + `lock`.
  Jugador sin máscara: cabeza `bare` (pelo y piel) y la máscara en la mano izquierda.
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
- **Configuración** (`TOUCH_CONFIG` en `touch.js`; `TouchControls.config` / `setConfig(patch)`): `joystickRadius` (px CSS, 56),
  `buttonScale` (1), `buttonOpacity` (1), `aimAssist` (0 / 0,5 / 1, por defecto 1), `autoFire` (false), `hapticsEnabled` (true), `moveDeadzone` (0,12),
  `aimDeadzone` (0,15), `fireThreshold` (0,85; > 1 = el joystick nunca dispara). Todo el dibujo y la detección de toques leen de ahí. **La persistencia y el menú
  los lleva `settings.js`** (ver "Ajustes y menús"): escribe en `config` al arrancar y al cambiar una opción. La antigua clave
  `neonrush.touch.v1` ya no se usa.
- **Controles** (`touch.js`, solo en `playing`/`cleared`):
  - Joystick izquierdo flotante → `input.moveAxis` analógico con **zona muerta reescalada** (la velocidad arranca de
    cero justo al salir de ella) y **seguimiento**: si el dedo se sale del círculo, el círculo se desplaza con él.
  - Joystick derecho flotante → **arrastrarlo solo apunta** (`input.aimActive/aimAngle`); llevarlo al borde
    (más allá de `fireThreshold`, marcado con un anillo de puntos; **0,85 por defecto**: con 0,6 apuntar con precisión, que lleva el dedo lejos del centro, disparaba sin querer) ataca a la cadencia del arma (`input.aimFiring`, con
    histéresis de 0,1 al volver hacia dentro). Un toque rápido (< 0,25 s) sin disparar = un ataque (`tapAttack`).
    Ya no dispara por mantener el dedo quieto (cambio respecto a la versión anterior: ATACAR cubre el "mantener").
  - **Aim-assist en tres niveles** (`config.aimAssist`: 0 OFF · 0,5 SUAVE · 1 ALTO, por defecto ALTO; `ASSIST_LEVELS` en `touch.js`).
    Con un enemigo vivo (no derribado) a la vista —`lineOfSight`: ni paredes ni puertas de por medio— dentro de un cono alrededor de
    donde apunta el dedo, `assistAngle` inclina la mira hacia él. **SUAVE**: cono 0,3 rad, tirón 0,35, alcance 360 u (ligero
    magnetismo). **ALTO** (soft lock-on): cono 0,7 rad (~40°), tirón 0,9, alcance 440 u (casi se alinea del todo). El cono se estrecha un
    40 % con la distancia y el tirón baja un poco si el enemigo está en el borde del cono. Siempre parte del ángulo crudo del dedo (no
    se acumula) y el objetivo ya fijado tiene prioridad (+20 % de cono) para no saltar entre enemigos.
  - **Disparo automático** (`config.autoFire`, opción `DISPARO AUTOMÁTICO`, desactivado por defecto): mientras el joystick derecho apunta
    (más allá de la zona muerta) y hay un enemigo fijado a tiro, `input.aimFiring` se activa solo, sin llegar al borde (`autoFireWants`).
    "A tiro" = cuerpo a cuerpo: dentro del alcance del arma; de fuego: hasta 440 u y con munición (no gasta el aviso SIN MUNICIÓN). Con la
    asistencia en OFF sigue detectando el objetivo con el cono SUAVE pero sin mover la mira; apuntar a otro lado o soltar el joystick lo corta.
  - **Marca de objetivo fijado** (`touch.lock` → `game.drawLockMark`): solo en táctil y mientras el joystick derecho apunta; anillo de neón
    con cuatro segmentos que gira bajo el enemigo más cuatro marcas fijas (cian/rosa; rojo mientras se ataca). Se dibuja entre las marcas de
    remate y los pickups, dentro de la cámara.
  - Botones de la derecha, **de abajo a arriba y sin texto**, alineados al borde derecho (casi cuadrados): **ATACAR**
    (retícula, grande, en la esquina) · **LANZAR** (arma en vuelo; clic derecho: recoger/lanzar) · **PATEAR/INTERACTUAR**
    (bota; el icono pasa a doble chevron cian junto a la moto). **REINICIAR** (R) sigue con texto bajo la máscara.
  - **Iconos** (`ICONS` en `touch.js`): cuadrículas de 11×11 (`#` = rojo neón `ICON_COLOR`, `o` = blanco) dibujadas por
    `drawIcon` a **escala entera** (≈60 % del lado menor del botón) y en posiciones enteras, así salen nítidas en cualquier
    pantalla. Al pulsar el icono se vuelve blanco. Un botón con `icon` en `drawTouchButton` no pinta texto.
  - **Botón superior** (`contextAction`, `id: 'act'`): la pulsación virtual `kick`/`execute` según `game.touchAction()`: derribado a tiro → remata (borde
    rojo/blanco parpadeante), puerta delante → patea (borde rosa), `cleared` junto a la moto → `startLeaving()`; apagado si no hay nada
    que hacer. La pulsación virtual se guarda 0,25 s (`ACT_BUFFER`) si el arma está en cadencia.
  - **ATACAR también es inteligente** (misma lógica que el botón superior, sin cambiar de aspecto) y
    lo mismo hace el toque rápido del joystick derecho (`TouchControls.smartAttack`): derribado a tiro → `REMATAR`
    (rojo/blanco parpadeante; atacar ya ejecuta, mismo objetivo que el indicador); puerta de enfrente → `PATEAR`
    (con arma cuerpo a cuerpo atacar ya patea; con arma de fuego envía la pulsación virtual `kick` en vez de disparar); `cleared` y cerca de la
    moto (borde + 3·`MOUNT_MARGIN`) → `MOTO` (cian), que llama a `startLeaving()`. El dedo que patea o monta se marca
    `button:used` y no cuenta como ATACAR mantenido (si no, dispararía a la vez). Si el arma está en cadencia, la pulsación
    se guarda 0,25 s (`ACT_BUFFER`). Mantener el joystick en el borde sigue atacando (no patea).
  - **Feedback**: al tocar un botón crece hasta 2 px y se ilumina (`PRESS_FLASH` 0,15 s) y vibra 12 ms; ATACAR
    mantenido/disparo continuo vibra 8 ms cada 0,12 s; empezar una ejecución 30 ms; morir `[40,30,90]`. Todo vía
    `TouchControls.haptic()`, que respeta `hapticsEnabled` y falla en silencio sin `navigator.vibrate` (iOS).
  - Los botones son independientes de los joysticks: cada dedo tiene su rol por `pointerId`, así que se puede mover,
    apuntar y pulsar un botón a la vez (comprobado con tres dedos simultáneos).
  Tamaños en píxeles CSS (`joystickRadius`, `BUTTON_CSS_HEIGHT` × `buttonScale`) para que midan lo mismo que un dedo.
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

## Ajustes y menús (`settings.js`, `options-menu.js`)
- **Datos**: `OPTIONS` es una lista declarativa; añadir una opción = añadir un objeto
  `{ id, section, label, type, default, apply(game, valor) }` con `type` `toggle` (boolean, SÍ/NO), `step`
  (`min`/`max`/`step`/`format`) o `choice` (`choices: [{ label, value }]`). El menú se genera solo desde la lista.
  `Settings` guarda `{ version: 1, values: {…} }` en `localStorage` clave **`neonrush.settings.v1`** (lectura defensiva
  con `sanitize`: JSON corrupto, tipos o valores fuera de rango → valor por defecto; escritura con try/catch). `set`/`adjust`
  guardan y llaman a `apply`; `applyAll` (al final del constructor de `Game`) aplica lo guardado; `reset` restaura.
- **Opciones actuales**: AUDIO `musicVolume`, `sfxVolume` (0–100 % de 10 en 10) · JUEGO `playerGender` (AGENTE: JACK / VEX, cosmético), `strobeEnabled` (LUCES ESTROBOSCÓPICAS del club), `goreEnabled` · TÁCTIL `buttonScale`
  (PEQUEÑO 0,85 / NORMAL 1 / GRANDE 1,2), `buttonOpacity` (BAJA 0,5 / MEDIA 0,75 / ALTA 1), `stickFire` (DISPARO CON JOYSTICK: BORDE 0,85 / FÁCIL 0,6 / NO = solo apunta; escribe `fireThreshold`), `autoFire` (DISPARO AUTOMÁTICO), `hapticsEnabled`,
  `aimAssist` (OFF / SUAVE / ALTO; el antiguo sí/no se migra: true → SUAVE, false → OFF). Las táctiles escriben en `touch.setConfig`.
- **Audio** (`audio.js`): `sfx.setVolumes({ music, sfx })`. Hay un `sfxBus` nuevo entre todos los efectos (y la moto) y el master;
  `musicBus`/`ambientBus` escalan su nivel por `musicVol` (`applyMusicMode`). `M` sigue silenciando el master por encima de ambos.
  Con `sfxVol` en 0 no se crean nodos de efectos. Antes de que exista el `AudioContext` (primer gesto) solo se guardan.
- **Sin sangre** (`game.goreOn`, `refreshGore`): `bleed` usa `particles.cleanKill` (chispas de neón, metal y humo) y no pinta
  suelo/paredes; `bake`, `bloodUnderfoot`, `updateSoles` y `stainPlayer` no hacen nada (`gore` se sigue acumulando, así que
  al reactivarla el personaje recupera su nivel); las huellas, la capa de sangre de las paredes, las variantes `_b1..5` del personaje
  y las gotas del HUD se ocultan al instante. **Limitación conocida**: la capa de sangre del suelo también lleva los cadáveres, así
  que lo ya manchado en el suelo se queda hasta el siguiente reinicio del piso (`R` o piso nuevo); lo nuevo sale limpio.
- **Menús** (`ListMenu`, en `game.panel`): modal con marco doble cian/magenta y título con aberración. Items `header`, `button`
  y `value` (opción de `OPTIONS`). Teclado: ↑/↓ (W/S) navegar · ←/→ (A/D) ajustar (se paran en los topes) · Enter/Espacio avanza
  un paso (da la vuelta) · Esc vuelve. Ratón: moverlo selecciona, clic en el lado izquierdo/derecho del valor resta/suma, en el resto
  avanza. Táctil: un toque es un clic (alto de fila ≈ 40 px CSS; si no cabe, se quitan las cabeceras y luego se encogen las filas).
  Mientras hay panel `game.update` solo llama a `panel.update` (el juego y los joysticks están congelados; `touch.update` lo trata
  como pantalla fuera de partida). Se dibuja sobre todo, bajo el cursor (`drawPanel`).
- **Accesos**: OPCIONES en el título (`TITLE_OPTIONS` de `menu.js`) y en la PAUSA. La **pausa** (`openPause`: CONTINUAR · OPCIONES ·
  SALIR AL MENÚ) se abre con **Esc** en `playing`/`cleared` o con el icono de pausa táctil (dos barras, bajo REINICIAR; pulsa Esc).
  Opciones abierta desde la pausa vuelve a la pausa; desde el título, al título. Cerrar el panel da 0,25 s de cooldown al jugador.

## Controles de PC reasignables (`keybinds.js`)
- **Estructura** (`KEY_CONFIG`): cada acción tiene **dos casillas** (principal y secundaria) con un código de `KeyboardEvent.code` (`KeyW`, `Space`…) o un botón del
  ratón (`Mouse0` izquierdo, `Mouse1` central, `Mouse2` derecho). Por defecto: mover `W/↑ · S/↓ · A/← · D/→`; **ATACAR** `Mouse0`; **LANZAR/RECOGER** `Mouse2`;
  **PATEAR/INTERACTUAR** `Espacio` y `F`; **REMATAR** `E`. Patear también remata si hay un derribado a tiro (por eso Espacio sirve para ambas cosas); `E` solo remata.
  (La petición mencionaba E para lanzar y Espacio para rematar: se dejaron así para que ninguna tecla tenga dos significados distintos por defecto.)
- **Lectura**: el juego no compara códigos fijos para estas acciones: `game.keys.down(acción)` / `pressed(acción)` (`KeyBinds`) miran el mapa vigente.
  `Player.update` lo usa para mover, atacar, lanzar, patear y rematar; el forcejeo cuenta pulsaciones de ATACAR, PATEAR y REMATAR. Los controles táctiles escriben
  **pulsaciones virtuales** (`input.virtualPress('throw'|'kick'|'execute')`, se limpian en `endStep`), que `pressed` también ve: el táctil funciona sea cual sea la asignación.
  `input.js` registra además el botón central (`mouse.middle`) y anula la acción por defecto del navegador de las teclas asignadas (`input.block`).
- **Fijos** (no reasignables): Esc (pausa/volver), Enter y Espacio en los menús, `R` reintentar, `M` silencio, `V` efectos, `T` récords y `F1` debug; por eso
  `RESERVED` rechaza Esc, Enter, F1, R, M, V y T en una acción (Espacio sí vale).
- **Persistencia**: dentro de `neonrush.settings.v1` (`{ version, values, keys }`); `Settings.load/save` llaman a `keys.load/toJSON`; `game.keys.onChange` guarda al instante.
  Lectura defensiva (`KeyBinds.load`): códigos inválidos o reservados → valor por defecto; si queda una tecla repetida entre acciones o una principal vacía, se vuelve a los valores por defecto.
- **Menú** (OPCIONES → `CONTROLES (PC)`, `buildControlsMenu`; filas `kind: 'bind'` de `ListMenu`): una fila por acción con dos casillas `[ W ] [ FL.ARRIBA ]`
  (`keyLabel` da el texto). Izquierda/derecha (o el puntero) eligen casilla; **Enter o clic** entra en el **modo de escucha**: la casilla parpadea `PULSA...` y la siguiente tecla o botón
  del ratón se asigna al momento y se guarda. **Esc cancela** sin tocar nada; **Supr/Retroceso** quita la secundaria (la principal nunca se queda vacía). Si la entrada ya estaba en otra acción se
  **intercambian** (la otra recibe la anterior; su casilla parpadea en rojo y un aviso lo dice); si el intercambio dejaría vacía una principal, se rechaza (`blocked`); una repetida en la misma
  acción también (`dup`). El botón **RESTAURAR CONTROLES** vuelve a `KEY_CONFIG`. En táctil las filas solo avisan "CONECTA UN TECLADO".
- **Avisos de pantalla dinámicos**: el marcador de remate (`E · CLIC IZQ`), el `¡APORREA …!` del forcejeo y la ayuda de controles de la esquina inferior (`WASD MOVER · … ATACAR · … RECOGER/LANZAR`,
  `… PATEAR · … REMATAR`) usan `keys.label(acción)` y muestran las teclas actuales.

## Debug
- `F1` activa/desactiva el modo debug: hitboxes, conos de visión (cortados por puertas),
  líneas de visión, rutas BFS, estados de la IA (incluido aim/windup y temporizador de
  derribo), velocidad angular de puertas (y si la principal está `BLOQUEADA`/`CERRANDO`), fuera o
  dentro del edificio, contadores de partículas, de manchas permanentes, nivel de sangre del
  personaje, huellas vivas y FPS. Mantener siempre
  esta tecla funcionando al añadir sistemas nuevos (cada entidad nueva debería tener su `drawDebug`).
- Cuidado: los `drawDebug` que cambian `textAlign` sin `save/restore` afectan al HUD;
  `renderHud` lo reinicia al empezar.

## Controles
`WASD` (o flechas) mover · ratón apuntar · clic izquierdo atacar/disparar · clic derecho recoger/lanzar arma (reasignables en OPCIONES → CONTROLES) ·
`Espacio`/`F` patear (o rematar si hay un derribado a tiro) · `E` rematar · `R` reintentar piso (reaparece dentro, sin repetir la llegada) ·
`Espacio`/`Enter`/clic saltan las cinemáticas de llegada y fuga; en resultados **solo `Enter`** (o tocar) continúa, nunca Espacio y no antes de 0,8 s (`resultsAge`) ·
`T` mejores partidas (selección de máscara y muerte) · **`Esc` dos veces (en 3 s) en la muerte: terminar partida** (Espacio y Enter ya no hacen nada ahí; la primera pulsación avisa `ESC DE NUEVO: TERMINAR Y PERDER EL PROGRESO`; en táctil el botón dice `¿SEGURO?`) ·
`Esc` pausa (con OPCIONES) · `F1` debug · `M` silenciar sonido y música · `V` efectos CRT on/off
