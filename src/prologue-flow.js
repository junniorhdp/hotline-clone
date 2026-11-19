import { PROLOGUE_LINES, markPrologueSeen } from './prologue.js';
import { AGENTS } from './portraits.js';
import { MASKS } from './masks.js';
import { lineOfSight } from './map.js';
import { drawText, measureText } from './pixelfont.js';
import { COLORS } from './utils.js';

// FLUJO DEL PRÓLOGO: la lógica y el estado del tutorial aparte (ver "Prólogo" en CLAUDE.md), fuera de game.js. `PrologueFlow` vive en `game.flow`; `Game` solo conserva
// delegadores finos (`skipPrologue`, `endPrologue`, `prologueLine`, `updatePrologue`, `drawTutorial`) para no cambiar su API. Los DATOS (mapa y líneas de lore) siguen en
// prologue.js, que no importa nada del juego para poder cargarse desde los validadores de Node.
//   · líneas de lore por momento (intro / enter / kill / free / clear) → `Comms` (comms.js), con el texto de `PROLOGUE_LINES`;
//   · instrucciones contextuales no modales (golpear → rematar → recoger → usar arma; guardias / liberar cerca del compañero) con desplazamiento suave de cámara;
//   · salto del prólogo (mantener P / botón táctil / doble pulsación en la pausa) y fin (huida en moto) → campaña.
export const SKIP_HOLD = 1.5; // s que hay que mantener P / el botón táctil para saltar el prólogo

export class PrologueFlow {
  constructor(game) {
    this.game = game;
    this.t = 0;                                             // s jugados en `playing` desde el último reset (para la línea `intro`)
    this.skipHold = 0;                                      // progreso (s) del salto mantenido
    this.skipAsk = 0;                                       // marca de tiempo del primer toque de «SALTAR PRÓLOGO» en la pausa
    this.tut = { done: new Set(), seen: new Set(), cur: null }; // instrucciones: aprendidas / ya enseñadas con cámara / la que se muestra ahora
    this.focus = null;                                      // { x, y, t, life }: desplazamiento de cámara hacia el objetivo de una instrucción nueva
  }

  forget() { this.skipHold = 0; this.tut.done.clear(); this.tut.seen.clear(); }      // partida o piso nuevo
  resetAttempt() { this.t = 0; this.tut.cur = null; this.focus = null; }             // reintento con R (done / seen se conservan)

  agentInfo(gender) { return { name: AGENTS[gender].name, color: AGENTS[gender].color }; }

  // Aspecto del compañero (rehén `partner`): el otro agente; la otra máscara (NEON, o BRUTE si llevas NEON) se la cedes al liberarlo.
  dressPartner(level) {
    const g = this.game;
    for (const hd of level.hostages) {
      if (!hd.partner) continue;
      hd.look = { ...hd.look, gender: g.gender === 'male' ? 'f' : 'm', hair: g.gender === 'male' ? '#7a2fb8' : '#140a08' }; // (aspecto antiguo, ya no se dibuja)
      hd.agent = g.gender === 'male' ? 'female' : 'male';
      const spare = MASKS.find((m) => m.id === (g.mask.id === 'neon' ? 'oso' : 'neon'));
      hd.maskId = spare.id; hd.maskName = spare.name;
    }
  }

  // Las líneas del prólogo (una sola vez por partida: R no las repite). `id` = momento.
  line(id) {
    const g = this.game, lines = PROLOGUE_LINES[id];
    if (!lines) return;
    const pg = g.gender === 'male' ? 'female' : 'male', me = this.agentInfo(g.gender).name, pa = this.agentInfo(pg);
    const ph = g.hostages.list.find((x) => x.partner), mask = ph ? MASKS.find((m) => m.id === ph.maskId) : null;
    // El retrato lleva la sangre que el compañero tiene encima (herido: nivel 2, roja; sin sangre si está desactivada), igual que su sprite.
    const partner = { name: pa.name, color: pa.color, portrait: mask ? { mask, gender: pg, level: g.goreOn ? 2 : 0, bits: [] } : null };
    const fill = (t) => t.replace(/\{ME\}/g, me).replace(/\{PARTNER\}/g, pa.name);
    g.comms.say(id, lines.map((l) => ({ speaker: l.who === 'partner' ? partner : 'central', text: fill(l.text) })), { urgent: id === 'free' }); // el compañero habla justo al liberarlo
  }

  // Cada paso de simulación (solo con `game.prologue`): dispara las líneas de lore, deja que empiecen las que esperan y evalúa las instrucciones.
  update(dt) {
    const g = this.game;
    if (g.state === 'playing') this.t += dt;
    if (g.state === 'playing' && !g.inside && this.t > 1.5) this.line('intro');
    if (g.state === 'playing' && g.inside && g.time > 2.5) this.line('enter');
    if (g.state === 'playing' && g.inside && g.stats.kills >= 1 && g.time > 4) this.line('kill');
    if (g.state === 'cleared' && g.goalAge > 0.3) this.line('clear');
    g.comms.update(dt);
    this.updateTutorial(dt);
  }

  // INSTRUCCIONES CONTEXUALES (no modales): un recuadro sobre el objetivo y, la primera vez de cada una, un desplazamiento suave de cámara hacia él.
  // En orden, y cada una solo mientras tenga sentido: golpear al enemigo paralizado (sin arma) → rematarlo → recoger un arma → usarla (y lanzarla) con el siguiente.
  // Se dan por aprendidas según lo que haces (una baja, recoger un arma...), así que no insisten ni salen si ya lo hiciste (`tut.done` persiste con R).
  updateTutorial(dt) {
    const g = this.game, p = g.player, T = this.tut, k = g.keys;
    if (this.focus && (this.focus.t += dt) > this.focus.life) this.focus = null;
    T.cur = null;
    if (g.state !== 'playing' || !p.alive || p.exec || p.vomit || g.panel || g.callout) return; // (no mientras hay un cartel grande en pantalla)
    const kills = g.stats.kills, armed = !!p.weapon;
    if (armed) { T.done.add('punch'); T.done.add('pickup'); }
    if (kills >= 1) { T.done.add('punch'); T.done.add('execute'); }
    if (kills >= 2) T.done.add('weapon');
    const near = (list, r) => {
      let best = null, bd = r;
      for (const o of list) {
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bd && lineOfSight(g.map, p.x, p.y, o.x, o.y)) { best = o; bd = d; }
      }
      return best;
    };
    const live = g.enemies.filter((e) => e.alive);
    let id = null, t = null, l1 = '', l2 = '', l3 = '';
    if (!T.done.has('punch') && (t = near(live.filter((e) => e.state === 'frozen'), 150))) {
      id = 'punch'; l1 = '¡ESTÁ PARALIZADO!'; l2 = g.hint(`${k.label('attack')} · GOLPEAR`, 'ATACAR · GOLPEAR');
    } else if (!T.done.has('execute') && (t = near(live.filter((e) => e.state === 'down'), 170))) {
      id = 'execute'; l1 = '¡REMÁTALO YA!'; l2 = g.hint(`${k.label('execute')} · ${k.label('attack')}`, 'REMATAR');
    } else if (!T.done.has('pickup') && (t = near(g.pickups.filter((q) => q.alive && !q.flying), 90))) {
      id = 'pickup'; l1 = 'ARMA EN EL SUELO'; l2 = g.hint(`${k.label('throw')} · RECOGER`, 'LANZAR · RECOGER');
    } else if (!T.done.has('weapon') && armed && (t = near(live.filter((e) => e.state === 'frozen'), 170))) {
      id = 'weapon'; l1 = 'USA TU ARMA'; l2 = g.hint(`${k.label('attack')}: GOLPEAR`, 'ATACAR: GOLPEAR'); l3 = g.hint(`${k.label('throw')}: LANZAR (DERRIBA)`, 'LANZAR: DERRIBA');
    }
    if (!id && g.prologue) {   // al llegar al compañero atado: si hay guardias cerca, despejar primero; si no, liberarlo (solo una pista a la vez, sin bloquear nada)
      const ph = g.hostages.list.find((x) => x.partner && x.state === 'tied');
      const dph = ph ? Math.hypot(ph.x - p.x, ph.y - p.y) : 0;
      if (ph && dph < 150 && dph > 46 && lineOfSight(g.map, p.x, p.y, ph.x, ph.y)) {
        const name = AGENTS[ph.agent].name;
        if (live.some((e) => e.state !== 'down' && Math.hypot(e.x - ph.x, e.y - ph.y) < 230)) { id = 'guards'; t = ph; l1 = '¡HAY GUARDIAS CERCA!'; l2 = 'DESPEJA LA SALA PRIMERO'; }
        else { id = 'free'; t = ph; l1 = `LIBERA A ${name}`; l2 = g.hint(`${k.label('kick')} · LIBERAR`, 'BOTA · LIBERAR'); }
      }
    }
    if (!id) return;
    T.cur = { id, x: t.x, y: t.y, lines: l3 ? [l1, l2, l3] : [l1, l2], below: id === 'guards' || id === 'free' }; // (las del compañero van DEBAJO: arriba habla)
    if (!T.seen.has(id)) { T.seen.add(id); this.focus = { x: t.x, y: t.y, t: 0, life: 1.8 }; }
  }

  // El recuadro de la instrucción actual, sobre su objetivo (en la escena, no en el mundo: texto nítido). Parpadea el borde para llamar la atención sin tapar la acción.
  drawTutorial(ctx) {
    const g = this.game, c = this.tut.cur;
    if (!c || g.state !== 'playing') return;
    const s = g.camera.worldToScreen(c.x, c.y + (c.below ? 26 : -30));
    const bw = Math.max(...c.lines.map((l) => measureText(l))) + 12, bh = 4 + c.lines.length * 10;
    const p = g.keepOnScreen(s.x, c.below ? s.y : s.y - bh, bw, bh, 6);
    const bx = Math.round(p.x - bw / 2), by = Math.round(p.y);
    ctx.fillStyle = 'rgba(13, 2, 33, 0.92)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = Math.floor(performance.now() / 350) % 2 ? '#05d9e8' : '#ffbe0b';
    ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
    c.lines.forEach((l, i) => drawText(ctx, l, bx + bw / 2, by + 4 + i * 10, { color: i ? COLORS.text : '#ffbe0b', align: 'center', shadow: null }));
  }

  // Desplazamiento suave de la cámara hacia el punto medio entre tú y el objetivo de una instrucción nueva (sin zoom: el pixel art solo escala en enteros).
  cameraFocus(tx, ty) {
    const F = this.focus;
    if (!F) return [tx, ty];
    const env = Math.max(0, Math.min(1, F.t / 0.45, (F.life - F.t) / 0.6));
    const k = 0.5 * env * env * (3 - 2 * env);
    return [tx + (F.x - tx) * k, ty + (F.y - ty) * k];
  }

  // ¿Hay un dedo sobre el botón táctil de saltar? (el salto del prólogo exige mantenerlo)
  skipTouchHeld() {
    const g = this.game, b = g.screenButtons().find((x) => x.id === 'skip');
    if (!b) return false;
    for (const t of g.input.touches.values()) {
      if (t.ended) continue;
      const p = g.toInternal(t.x, t.y);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return true;
    }
    return false;
  }

  // Selección de máscara del prólogo: saltar exige MANTENER P (o el botón táctil) SKIP_HOLD s, así no se salta por accidente. Devuelve true si ha saltado.
  updateMaskSkip(input) {
    const g = this.game;
    if (input.wasPressed('KeyP')) g.showToast(g.hint('MANTÉN P PARA SALTAR EL PRÓLOGO', 'MANTÉN PULSADO PARA SALTAR'), 2);
    const held = input.down('KeyP') || this.skipTouchHeld();
    this.skipHold = held ? this.skipHold + 1 / 60 : Math.max(0, this.skipHold - 2 / 60);
    if (this.skipHold >= SKIP_HOLD) { this.skipHold = 0; this.skip(); return true; }
    return false;
  }

  // Ayuda y barra de progreso del salto en la pantalla ELIGE TU MÁSCARA.
  drawMaskSelectExtras(ctx, w, h, cx) {
    const g = this.game;
    if (!g.input.touchMode) drawText(ctx, 'MANTÉN P: SALTAR PRÓLOGO', cx, h - 23 - g.safe.b, { color: COLORS.enemy, align: 'center' });
    if (this.skipHold > 0) {
      const bw = 150, bx = cx - bw / 2, by = Math.round(h * 0.5);
      ctx.fillStyle = 'rgba(13, 2, 33, 0.92)'; ctx.fillRect(bx - 4, by - 14, bw + 8, 30);
      ctx.fillStyle = COLORS.enemy; ctx.fillRect(bx - 4, by - 14, bw + 8, 1); ctx.fillRect(bx - 4, by + 15, bw + 8, 1);
      drawText(ctx, 'SALTANDO PRÓLOGO...', cx, by - 9, { color: COLORS.enemy, align: 'center', shadow: null });
      ctx.fillStyle = '#3a2a5a'; ctx.fillRect(bx, by + 3, bw, 7);
      ctx.fillStyle = COLORS.enemy; ctx.fillRect(bx, by + 3, Math.round(bw * Math.min(1, this.skipHold / SKIP_HOLD)), 7);
    }
  }

  // «SALTAR PRÓLOGO» de la pausa: un menú no se puede «mantener», así que hay que pulsarlo dos veces en 3 s.
  askSkip() {
    const g = this.game;
    if (this.skipAsk && performance.now() - this.skipAsk < 3000) { this.skipAsk = 0; g.closePanel(); this.skip(); }
    else { this.skipAsk = performance.now(); g.showToast('OTRA VEZ PARA SALTAR EL PRÓLOGO', 3); }
  }

  // Fin del prólogo (huida en moto): queda marcado como visto y empieza la campaña (puntuación a 0, selección de máscara del piso 1).
  end() {
    markPrologueSeen();
    this.game.startRunAt(0, false);
  }

  // Saltar el prólogo (P en la selección de máscara, su botón táctil o la pausa): mismo destino que terminarlo.
  skip() {
    const g = this.game;
    if (!g.prologue) return;
    markPrologueSeen();
    g.sfx.play('pickup');
    g.transition(() => g.startRunAt(0, false));
  }
}
