import * as THREE from 'three';
import { Renderer } from './engine/renderer';
import { Input } from './engine/input';
import { Audio } from './engine/audio';
import type { Quality } from './engine/quality';
import { Textures } from './world/textures';
import { NavGrid } from './world/navgrid';
import { buildTerrain, buildForest } from './world/terrain';
import { buildTunnel, TunnelBuild } from './world/tunnel';
import { buildPortal, PortalBuild } from './world/portal';
import { buildVehicles, VehicleBuild } from './world/vehicles';
import { Environment } from './world/environment';
import { CIVILIANS, ENEMIES, POINTS, Vec2, describeLocation } from './world/layout';
import { initHumanoids } from './actors/humanoid';
import { Actor, GameCtx, GameEventType, vision } from './actors/actor';
import { Player } from './actors/player';
import { Rifle } from './actors/weapon';
import { Soldier } from './actors/soldier';
import { Enemy } from './actors/enemy';
import { Civilian } from './actors/civilian';
import { Effects } from './combat/effects';
import { rayCast } from './combat/ballistics';
import { buildPlatoon, Gruppe, Order, OrderKind, ORDER_LABEL } from './command/platoon';
import { TacMap, buildMapImage } from './command/tacmap';
import { Hud } from './ui/hud';
import { Scenario, Debrief, SitrepOption } from './rpg/scenario';
import type { Plan, RoleId } from './rpg/plan';
import type { Attrs } from './rpg/career';

interface PathReq { actor: Actor; to: Vec2; cb: (p: Vec2[] | null) => void }

export class Game implements GameCtx {
  time = 0;
  nav: NavGrid;
  effects: Effects;
  audio = new Audio();
  env: Environment;
  scene = new THREE.Scene();
  actors: Actor[] = [];
  attrs: Attrs;

  renderer: Renderer;
  camera: THREE.PerspectiveCamera;
  cineCamera: THREE.PerspectiveCamera;
  input: Input;
  player: Player;
  rifle = new Rifle();
  groups: Gruppe[] = [];
  soldiers: Soldier[] = [];
  enemies: Enemy[] = [];
  civilians: Civilian[] = [];
  hud: Hud;
  tacmap: TacMap;
  scenario: Scenario | null = null;
  plan: Plan | null = null;

  tunnel: TunnelBuild;
  portal: PortalBuild;
  vehicles: VehicleBuild;

  mode: 'cinematic' | 'play' | 'ended' = 'cinematic';
  paused = false;
  dialogOpen = false;
  selected = new Set<number>([1]);
  onEnd: (d: Debrief) => void = () => {};
  onPause: (p: boolean) => void = () => {};

  private pathQueue: PathReq[] = [];
  private clock = new THREE.Clock();
  private cineT = 0;
  private interactT = 0;
  private interactKey = '';
  private lastShout = -99;
  private realTime = 0;
  private endTimer = -1;

  constructor(container: HTMLElement, readonly quality: Quality, attrs: Attrs) {
    this.attrs = attrs;
    this.renderer = new Renderer(container, quality);
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, quality.drawDistance);
    this.cineCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, quality.drawDistance);
    this.renderer.onResize = () => {
      for (const c of [this.camera, this.cineCamera]) { c.aspect = window.innerWidth / window.innerHeight; c.updateProjectionMatrix(); }
    };
    this.input = new Input(this.renderer.renderer.domElement);

    const tex = new Textures(quality.textureSize);
    initHumanoids(tex);
    this.nav = new NavGrid();

    this.scene.add(buildTerrain(tex, quality));
    this.scene.add(buildForest(quality.trees));
    this.tunnel = buildTunnel(tex, quality);
    this.scene.add(this.tunnel.group);
    this.portal = buildPortal(tex);
    this.scene.add(this.portal.group);
    this.vehicles = buildVehicles();
    this.scene.add(this.vehicles.group);
    this.env = new Environment(this.scene, this.renderer.renderer, quality, this.tunnel.lamps, this.vehicles.policeLights);
    this.effects = new Effects(this.scene);

    // actors
    this.player = new Player(this.camera);
    this.player.pos.set(POINTS.playerStart.x, 0, POINTS.playerStart.z);
    this.player.yaw = 0;
    this.actors.push(this.player);
    const pl = buildPlatoon(this.nav, POINTS.assembly);
    this.groups = pl.groups;
    this.soldiers = pl.soldiers;
    for (const s of this.soldiers) this.addActor(s);
    ENEMIES.forEach((e) => { const en = new Enemy(e); this.enemies.push(en); this.addActor(en); });
    CIVILIANS.forEach((c, i) => { const cv = new Civilian(c.x, c.z, i); this.civilians.push(cv); this.addActor(cv); });

    this.scene.add(this.camera);
    this.camera.add(this.rifle.model);
    this.rifle.model.visible = false;

    const mapImg = buildMapImage(this.nav);
    this.hud = new Hud(mapImg, this.nav);
    this.hud.initSquads(this.groups);
    this.hud.setVisible(false);
    this.tacmap = new TacMap(this.nav, mapImg);
    this.tacmap.onOrder = (kind, at) => this.orderSelected(kind, at, this.player.yaw, true);
    this.tacmap.onSelect = (id, add) => this.select(id, add);

    this.renderer.setup(this.scene, this.cineCamera);
    this.renderer.renderer.domElement.addEventListener('click', () => {
      if (this.mode === 'play' && !this.paused && !this.tacmap.open && !this.dialogOpen && !this.input.locked) this.input.lock();
    });
    this.input.onLockChange = (locked) => {
      if (this.mode !== 'play') return;
      if (!locked && !this.tacmap.open && !this.dialogOpen) this.setPaused(true);
      if (locked) this.setPaused(false);
    };

    // compile shaders up front to avoid hitches on first sight of each material
    this.renderer.renderer.compile(this.scene, this.camera);
  }

  private addActor(a: Actor) {
    this.actors.push(a);
    if (a.body) this.scene.add(a.body.root);
    a.syncMesh(0);
  }

  // ---------------------------------------------------------------- GameCtx --------------------------------------
  playerActor() { return this.player; }

  radio(from: string, text: string, kind: 'info' | 'contact' | 'warn' | 'cmd' = 'info') {
    if (this.mode !== 'play') return;
    this.audio.radio();
    this.hud.radio(from, text, kind);
    if (kind === 'contact') {
      const g = this.groups.find((x) => x.callsign === from);
      if (g) this.hud.flashSquad(g.id);
    }
  }

  requestPath(a: Actor, to: Vec2, cb: (p: Vec2[] | null) => void) {
    const i = this.pathQueue.findIndex((r) => r.actor === a);
    if (i >= 0) this.pathQueue.splice(i, 1);
    this.pathQueue.push({ actor: a, to, cb });
  }

  event(type: GameEventType, data: Record<string, unknown> = {}) {
    this.scenario?.onEvent(this, type, data);
  }

  onDamage(victim: Actor, source: Actor | null, amount: number) {
    void amount;
    if (victim === this.player) {
      this.hud.damage();
      if (this.player.hp <= 0) {
        this.player.status = 'dead';
        this.hud.toast('Sie sind ausgefallen', 'Der Zug ist führungslos.', 5000);
      }
      return;
    }
    if (victim.hp > 0) return;
    if (victim instanceof Soldier && victim.status === 'ok') {
      const g = victim.gruppe;
      g.losses++;
      if (Math.random() < 0.62) {
        victim.status = 'wounded';
        victim.bleed = 150 * (this.scenario?.bleedFactor ?? 1);
        g.morale = Math.max(0, g.morale - 12);
        this.event('wounded', { who: victim });
        this.radio(g.callsign, `Verwundeter! ${victim.name} getroffen. Sanität!`, 'warn');
      } else {
        victim.status = 'dead';
        g.morale = Math.max(0, g.morale - 20);
        this.event('kia', { who: victim });
        this.radio(g.callsign, `${victim.name} ist gefallen.`, 'warn');
      }
    } else if (victim instanceof Enemy && victim.status !== 'dead') {
      victim.status = 'dead';
      this.event('kill', { who: victim });
      if (source instanceof Soldier) {
        source.gruppe.kills++;
        source.gruppe.morale = Math.min(100, source.gruppe.morale + 6);
        this.radio(source.gruppe.callsign, `Bewaffnete Person ausgeschaltet bei ${describeLocation(victim.pos.x, victim.pos.z)}.`, 'info');
      }
    } else if (victim instanceof Civilian && victim.status === 'ok') {
      victim.status = 'dead';
      if (this.scenario) this.scenario.stats.civKilled++;
      this.radio('Kapo Uri', 'Eine Zivilperson wurde tödlich getroffen!', 'warn');
    }
  }

  // ---------------------------------------------------------------- Flow -------------------------------------------
  start(plan: Plan) {
    this.plan = plan;
    this.scenario = new Scenario(plan, this.enemies, this.civilians, this.groups);
    this.mode = 'play';
    this.time = 0;
    this.renderer.setCamera(this.camera);
    this.rifle.model.visible = true;
    this.hud.setVisible(true);
    if (plan.measures.includes('power')) { this.tunnel.stabilize(); vision.bonus = 1.25; }
    if (plan.measures.includes('recon')) for (const e of this.enemies) if (e.cell !== 'C') e.spottedAt = 75;
    for (const g of this.groups) g.roe = plan.roe;

    // initial orders from the Befehlsgebung
    const counts: Partial<Record<RoleId, number>> = {};
    for (const g of this.groups) {
      const role = plan.roles[g.id];
      const k = (counts[role] = (counts[role] ?? 0) + 1) - 1;
      let order: Order;
      switch (role) {
        case 'portal': order = { kind: 'move', target: POINTS.checkpoint, facing: 0 }; break;
        case 'road': order = { kind: 'move', target: { x: 0, z: -45 + k * 16 }, facing: 0 }; break;
        case 'gallery': order = { kind: 'move', target: { x: 30, z: -40 + k * 16 }, facing: 0 }; break;
        case 'evac': order = { kind: 'move', target: { x: k ? 2 : -2, z: -14 - k * 6 }, facing: 0 }; break;
        default: order = { kind: 'move', target: { x: -6 + k * 4, z: 46 }, facing: 0 }; break;
      }
      g.assignment = role;
      g.issue(this, order, true);
    }
    this.selected = new Set([this.groups.find((g) => plan.roles[g.id] === 'road')?.id ?? 2]);
    this.hud.toast('Operation RIEGEL', 'Nordportal Gotthard · 16:20 · Befehl erteilt', 4500);
    this.clock.getDelta();
  }

  lock() { this.input.lock(); }

  setPaused(p: boolean) {
    if (this.paused === p) return;
    this.paused = p;
    this.onPause(p);
  }

  abort() {
    if (!this.scenario) return;
    const d = this.scenario.finish(this, false, 'Einsatz durch den Zugführer abgebrochen.');
    this.finish(d);
  }

  private finish(d: Debrief) {
    if (this.mode === 'ended') return;
    this.mode = 'ended';
    this.input.unlock();
    this.hud.setVisible(false);
    this.tacmap.show(false);
    this.onEnd(d);
  }

  // ---------------------------------------------------------------- Commands ---------------------------------------
  private select(id: number, add: boolean) {
    if (id === 0) { this.selected = new Set(this.groups.map((g) => g.id)); return; }
    if (add) { if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); }
    else this.selected = new Set([id]);
    this.audio.click(1200, 0.06, 0.03);
  }

  /** Point under the crosshair (on the ground), used for move/clear/evac orders. */
  private aimPoint(): Vec2 | null {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const hit = rayCast(this, this.camera.position, dir, 250, this.player);
    const p = hit.point.clone().addScaledVector(dir, -0.6);
    return this.nav.nearestWalkable(p.x, p.z, 8);
  }

  private orderSelected(kind: OrderKind, at: Vec2 | null, facing: number, fromMap = false) {
    const gs = this.groups.filter((g) => this.selected.has(g.id) && g.leader);
    if (!gs.length) { this.hud.toast('Keine Gruppe gewählt', 'Tasten 1–5 oder 0 für alle'); return; }
    const target = at ?? { x: this.player.pos.x, z: this.player.pos.z };
    if (this.scenario) this.scenario.stats.ordersIssued++;
    gs.forEach((g, i) => {
      // several groups to one point: stagger them along the axis instead of piling up
      const off = gs.length > 1 && kind !== 'follow' ? (i - (gs.length - 1) / 2) * 7 : 0;
      const fx = -Math.sin(facing), fz = -Math.cos(facing);
      const t = this.nav.nearestWalkable(target.x - fx * off, target.z - fz * off, 8) ?? target;
      g.issue(this, { kind, target: t, facing });
      if (kind !== 'follow' && kind !== 'hold') this.effects.ping(t.x, t.z, g.color);
    });
    const names = gs.length === this.groups.length ? 'Ganzer Zug' : gs.map((g) => g.callsign).join(', ');
    const where = kind === 'follow' || kind === 'hold' ? '' : ` – ${describeLocation(target.x, target.z)}`;
    this.radio('Riegel', `${names}: ${ORDER_LABEL[kind]}${where}.`, 'cmd');
    void fromMap;
  }

  private toggleRoe() {
    const gs = this.groups.filter((g) => this.selected.has(g.id));
    if (!gs.length) return;
    const to = gs[0].roe === 'free' ? 'hold' : 'free';
    gs.forEach((g) => (g.roe = to));
    this.radio('Riegel', `${gs.map((g) => g.callsign).join(', ')}: ${to === 'free' ? 'Feuer frei!' : 'Feuer halt! Feuer nur in Notwehr.'}`, 'cmd');
  }

  private shout() {
    if (this.time - this.lastShout < 3) return;
    this.lastShout = this.time;
    this.audio.say('Halt! Armee! Waffe weg! Hände hoch!', 1.15, 0.95);
    this.radio('Riegel', '«Halt! Armee! Waffe weg – Hände hoch!»', 'cmd');
    for (const e of this.enemies) {
      if (e.status !== 'ok' || e.distTo(this.player) > 32) continue;
      if (!this.nav.los(e.pos.x, e.pos.z, this.player.pos.x, this.player.pos.z)) continue;
      e.challenge(this, 0.08 + this.attrs.fuehrung * 0.03);
    }
  }

  openSitrep(): SitrepOption[] | null {
    if (!this.scenario) return null;
    return this.scenario.sitrepOptions();
  }

  answerSitrep(o: SitrepOption) {
    if (!this.scenario) return;
    if (this.scenario.sitrepDue > 0) this.scenario.answerSitrep(this, o);
    else this.radio('Bastion', 'Verstanden, Riegel. Danke für die Meldung.', 'cmd');
  }

  // ---------------------------------------------------------------- Frame ------------------------------------------
  frame() {
    const rawDt = Math.min(0.05, this.clock.getDelta());
    this.realTime += rawDt;
    const dt = this.paused ? 0 : rawDt; // SITREP dialog and map run in real time on purpose
    const t = this.realTime;
    this.tunnel.update(t);
    this.portal.update(t);
    this.vehicles.update(t);

    if (this.mode === 'cinematic') {
      this.cinematic(rawDt);
      this.env.update(rawDt, t, this.cineCamera, this.cineCamera.position.x, Math.max(5, this.cineCamera.position.z));
      for (const a of this.actors) if (a !== this.player) a.syncMesh(rawDt);
      this.effects.update(rawDt);
      this.renderer.render(this.scene, this.cineCamera, this.env.exposure);
      this.input.endFrame();
      return;
    }

    if (this.mode === 'play' && !this.paused) {
      this.time += dt;
      this.handleInput(dt);
      // pathfinding budget
      for (let i = 0; i < 6 && this.pathQueue.length; i++) {
        const r = this.pathQueue.shift()!;
        r.cb(this.nav.findPath(r.actor.pos.x, r.actor.pos.z, r.to.x, r.to.z));
      }
      for (const g of this.groups) g.update(dt, this);
      for (const a of this.actors) if (a !== this.player) a.update(dt, this);
      this.scenario!.update(dt, this);
      this.effects.update(dt);
      const end = this.scenario!.checkEnd(this, this.player);
      if (end && this.endTimer < 0) {
        this.endTimer = end.success ? 4 : 3;
        this.hud.toast(end.success ? 'Auftrag erfüllt' : 'Einsatz beendet', end.reason, 4000);
      }
      if (this.endTimer > 0) {
        this.endTimer -= dt;
        if (this.endTimer <= 0 && end) this.finish(end);
      }
    }

    this.env.update(dt, t, this.camera, this.player.pos.x, this.player.pos.z);
    this.audio.setListener(this.player.pos.x, this.player.pos.z, this.player.yaw, this.env.inside);
    // flashlight on the rifle
    const fl = this.env.flashlight;
    fl.intensity = this.rifle.flashlightOn ? 60 : 0;
    if (this.rifle.flashlightOn) {
      const d = new THREE.Vector3();
      this.camera.getWorldDirection(d);
      fl.position.copy(this.camera.position).addScaledVector(d, 0.3).add(new THREE.Vector3(0, -0.1, 0));
      fl.target.position.copy(this.camera.position).addScaledVector(d, 10);
    }
    const fovT = THREE.MathUtils.lerp(this.player.baseFov, 50, this.player.ads);
    if (Math.abs(this.camera.fov - fovT) > 0.01) { this.camera.fov = fovT; this.camera.updateProjectionMatrix(); }

    this.hud.update(this.hudState(), rawDt);
    this.tacmap.draw({ groups: this.groups, selected: this.selected, actors: this.actors, player: this.player, objectives: this.scenario?.objectives ?? [], time: this.time, spotMemory: this.spotMemory });
    this.renderer.render(this.scene, this.camera, this.env.exposure);
    this.input.endFrame();
  }

  get spotMemory() { return 6 + this.attrs.uebersicht * 3; }

  private promptText = '';
  private promptProgress = 0;

  private hudState() {
    return {
      player: this.player, rifle: this.rifle, camera: this.camera, groups: this.groups, selected: this.selected,
      objectives: this.scenario?.objectives ?? [], actors: this.actors, time: this.time, prompt: this.promptText,
      progress: this.promptProgress, chargeTimer: this.scenario?.chargeTimer ?? -1, spotMemory: this.spotMemory,
      minimapRange: 55 + this.attrs.uebersicht * 10, inside: this.env.inside,
    };
  }

  private handleInput(dt: number) {
    const inp = this.input;
    const live = inp.locked && this.player.status === 'ok';
    this.player.control(dt, inp, this, live);

    if (inp.wasPressed('KeyM') || (this.tacmap.open && inp.wasPressed('Escape'))) {
      const open = !this.tacmap.open && inp.wasPressed('KeyM');
      this.tacmap.show(open, this.player.pos);
      if (open) inp.unlock(); else inp.lock();
    }
    // selection also works while the map is open
    if (live || this.tacmap.open) {
      for (let i = 1; i <= 5; i++) if (inp.wasPressed(`Digit${i}`)) this.select(i, inp.isDown('ShiftLeft') || inp.isDown('ShiftRight'));
      if (inp.wasPressed('Digit0') || inp.wasPressed('Backquote')) this.select(0, false);
      if (inp.wasPressed('KeyG')) this.toggleRoe();
    }
    if (!live) { this.player.ads = Math.max(0, this.player.ads - dt * 6); this.rifle.pose(dt, this.player, 0, 0); return; }

    // orders
    if (inp.wasPressed('KeyQ') || inp.mousePressed[1]) {
      const p = this.aimPoint();
      if (p) this.orderSelected('move', p, Math.atan2(-(p.x - this.player.pos.x), -(p.z - this.player.pos.z)));
    }
    if (inp.wasPressed('KeyX')) this.orderSelected('hold', null, this.player.yaw);
    if (inp.wasPressed('KeyF')) this.orderSelected('follow', null, this.player.yaw);
    if (inp.wasPressed('KeyV')) { const p = this.aimPoint(); if (p) this.orderSelected('clear', p, this.player.yaw); }
    if (inp.wasPressed('KeyB')) { const p = this.aimPoint(); if (p) this.orderSelected('evac', p, this.player.yaw); }
    if (inp.wasPressed('KeyH')) this.shout();
    if (inp.wasPressed('KeyN')) { this.rifle.mode = this.rifle.mode === 'Einzel' ? 'Serie' : 'Einzel'; this.audio.click(700, 0.1, 0.04); }
    if (inp.wasPressed('KeyL')) { this.rifle.flashlightOn = !this.rifle.flashlightOn; this.audio.click(1500, 0.08, 0.02); }
    if (inp.wasPressed('KeyR') && this.rifle.reload()) this.audio.reload();

    // weapon
    const p = this.player;
    const adsWanted = inp.mouseDown[2] && !p.sprinting && this.rifle.reloading <= 0;
    p.ads += ((adsWanted ? 1 : 0) - p.ads) * Math.min(1, dt * 12);
    const canFire = !p.sprinting && !this.tacmap.open;
    if (this.rifle.mag === 0 && inp.mousePressed[0] && this.rifle.reloading <= 0) {
      if (!this.rifle.reload()) this.audio.click(400, 0.1, 0.03); else this.audio.reload();
    }
    if (canFire && this.rifle.tick(dt, inp.mouseDown[0], inp.mousePressed[0])) this.playerShot();
    else if (!canFire) this.rifle.tick(dt, false, false);
    this.rifle.pose(dt, p, inp.mouseDX, inp.mouseDY);

    this.interact(dt);
  }

  private playerShot() {
    const p = this.player;
    p.lastShotAt = this.time;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const spread = (0.003 + (1 - p.ads) * 0.022 + Math.min(1, p.speed / 4) * 0.02 + this.rifle.bloom * 0.02) * (1 - this.attrs.schiessen * 0.1);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    const muzzle = new THREE.Vector3();
    this.rifle.muzzle.getWorldPosition(muzzle);
    const hit = rayCast(this, this.camera.position, dir, 400, p);
    this.effects.tracer(muzzle, hit.point);
    this.env.flash(muzzle, 40);
    this.audio.shot(p.pos.x, p.pos.z, 'player');
    p.recoilPitch += 0.012 + Math.random() * 0.006;
    p.recoilYaw += (Math.random() - 0.5) * 0.008;
    if (hit.actor) {
      const a = hit.actor;
      const wasStatus = a.status;
      this.effects.impact(hit.point, hit.normal, 'blood');
      this.audio.hitMarker();
      if (a instanceof Civilian) { this.event('civHit'); this.radio('Kapo Uri', 'Feuer einstellen! Sie haben eine Zivilperson getroffen!', 'warn'); }
      else if (a instanceof Soldier) { this.event('friendlyFire'); this.radio(a.gruppe.callsign, 'Eigenes Feuer! Feuer einstellen!', 'warn'); }
      else if (a instanceof Enemy && (wasStatus === 'surrendered' || wasStatus === 'arrested')) {
        this.event('roeViolation');
        this.radio('Bastion', 'Riegel! Feuer auf eine Person, die sich ergeben hat – das ist ein schwerer Verstoss!', 'warn');
      }
      if (wasStatus === 'ok' || wasStatus === 'surrendered' || wasStatus === 'arrested') {
        a.takeDamage(this, hit.head ? 120 : 45, p);
      }
      this.hud.hit(a.status === 'dead');
    } else {
      this.effects.impact(hit.point, hit.normal, 'concrete');
      this.audio.impact(hit.point.x, hit.point.z);
    }
  }

  private interact(dt: number) {
    const p = this.player;
    const E = this.input.isDown('KeyE');
    const Epress = this.input.wasPressed('KeyE');
    let prompt = '';
    let key = '';
    let hold = 0;
    let action: (() => void) | null = null;
    // nearest candidate within reach
    let best: Actor | null = null, bd = 2.6;
    for (const a of this.actors) {
      if (a === p) continue;
      const d = a.distTo(p);
      if (d >= bd) continue;
      const relevant = (a instanceof Civilian && a.status === 'ok') || (a instanceof Soldier && a.status === 'wounded' && !a.treated) || (a instanceof Enemy && a.status === 'surrendered');
      if (relevant) { best = a; bd = d; }
    }
    const charge = this.tunnel.chargePos;
    const chargeOpen = this.scenario && !this.scenario.chargeSecured && !this.scenario.chargeExploded;
    if (chargeOpen && Math.hypot(charge.x - p.pos.x, charge.z - p.pos.z) < 2.4) {
      const hostile = this.enemies.some((e) => e.status === 'ok' && e.distTo(p) < 15);
      if (hostile) prompt = 'Sprengladung – zuerst Raum sichern!';
      else { prompt = '[E] halten: Sprengladung sichern'; key = 'charge'; hold = 5; action = () => this.event('chargeSecured'); }
    } else if (best instanceof Civilian) {
      const c = best;
      if (c.followTarget === p) { prompt = '[E] «Warten Sie hier.»'; if (Epress) { c.follow(null); } }
      else { prompt = '[E] «Armee! Folgen Sie mir, bitte!»'; if (Epress) { c.follow(p); this.audio.say('Folgen Sie mir, bitte!', 1.1, 1); } }
    } else if (best instanceof Soldier) {
      const s = best;
      prompt = `[E] halten: ${s.name} versorgen`; key = `treat${s.id}`; hold = 4;
      action = () => {
        s.treated = true;
        s.gruppe.morale = Math.min(100, s.gruppe.morale + 6);
        this.event('treated', { who: s, by: p });
        this.radio('Riegel', `${s.name} versorgt. Liegend abtransportieren.`, 'info');
      };
    } else if (best instanceof Enemy) {
      const e = best;
      prompt = '[E] Festnehmen';
      if (Epress) {
        e.status = 'arrested';
        this.event('arrest', { who: e, by: p });
        this.radio('Riegel', `Person festgenommen bei ${describeLocation(e.pos.x, e.pos.z)}.`, 'info');
      }
    }
    if (hold > 0 && E && key) {
      if (this.interactKey !== key) { this.interactKey = key; this.interactT = 0; }
      this.interactT += dt;
      this.promptProgress = Math.min(1, this.interactT / hold);
      if (this.interactT >= hold && action) { action(); this.interactT = 0; this.interactKey = ''; this.promptProgress = 0; }
    } else {
      this.interactT = 0;
      this.interactKey = '';
      this.promptProgress = 0;
    }
    if (this.scenario && this.scenario.sitrepDue > 0 && !prompt) prompt = '[T] Lage melden';
    this.promptText = prompt;
  }

  private cinematic(dt: number) {
    this.cineT += dt;
    const t = this.cineT * 0.035;
    const r = 70;
    const c = this.cineCamera;
    c.position.set(Math.sin(t) * r * 0.8 + 6, 14 + Math.sin(t * 0.7) * 4, 62 + Math.cos(t) * r * 0.5);
    c.lookAt(0, 6, -2);
  }
}
