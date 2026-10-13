import * as THREE from 'three';
import type { NavGrid } from '../world/navgrid';
import type { Vec2 } from '../world/layout';
import type { Effects } from '../combat/effects';
import type { Audio } from '../engine/audio';
import type { Environment } from '../world/environment';
import { Humanoid, Outfit } from './humanoid';

export type Faction = 'blue' | 'red' | 'civ';
export type Status = 'ok' | 'wounded' | 'dead' | 'surrendered' | 'arrested' | 'evacuated';

/** What actors need from the running game. Implemented by Game. */
export interface GameCtx {
  time: number;
  nav: NavGrid;
  effects: Effects;
  audio: Audio;
  env: Environment;
  scene: THREE.Scene;
  actors: Actor[];
  radio(from: string, text: string, kind?: 'info' | 'contact' | 'warn' | 'cmd'): void;
  onDamage(victim: Actor, source: Actor | null, amount: number): void;
  requestPath(a: Actor, to: Vec2, cb: (p: Vec2[] | null) => void): void;
  playerActor(): Actor;
  event(type: GameEventType, data?: Record<string, unknown>): void;
  /** Leadership attributes of the Lt (0..5 each). */
  attrs: { fuehrung: number; uebersicht: number; fuersorge: number; schiessen: number };
}

export type GameEventType =
  | 'contact' | 'kill' | 'arrest' | 'surrender' | 'wounded' | 'kia' | 'treated' | 'evacuated' | 'cleared'
  | 'civHit' | 'friendlyFire' | 'roeViolation' | 'chargeArmed' | 'chargeSecured' | 'orderConflict';

let NEXT_ID = 1;

export abstract class Actor {
  readonly id = NEXT_ID++;
  pos = new THREE.Vector3();
  yaw = 0;
  hp = 100;
  status: Status = 'ok';
  crouch = false;
  aiming = false;
  speed = 0;
  body: Humanoid | null = null;
  path: Vec2[] = [];
  pathGoal: Vec2 | null = null;
  pathPending = false;
  underFireAt = -99;
  lastShotAt = -99;
  private stuck = 0;
  private pathFailAt = -99;
  private arrivedAt = -99;
  private wantYaw: number | null = null;
  name = '';

  constructor(readonly faction: Faction, outfit: Outfit | null, civColor?: number) {
    if (outfit) this.body = new Humanoid(outfit, civColor);
  }

  get active() { return this.status === 'ok'; }
  get standing() { return this.status === 'ok' || this.status === 'surrendered' || this.status === 'arrested'; }
  get eyeY() { return this.crouch ? 1.1 : 1.62; }
  get chestY() { return this.crouch ? 0.85 : 1.3; }

  chest(out = new THREE.Vector3()) { return out.set(this.pos.x, this.chestY, this.pos.z); }

  distTo(o: { pos: THREE.Vector3 } | Vec2): number {
    const p = 'pos' in o ? o.pos : { x: o.x, z: o.z };
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  /** Ask the pathfinder for a route; arrives asynchronously (queued, a few per frame). */
  goTo(ctx: GameCtx, to: Vec2) {
    const same = this.pathGoal && Math.hypot(this.pathGoal.x - to.x, this.pathGoal.z - to.z) < 0.3;
    if (same && (this.path.length || this.pathPending)) return;
    if (Math.hypot(to.x - this.pos.x, to.z - this.pos.z) < 0.45) { this.path = []; this.pathGoal = { x: to.x, z: to.z }; return; }
    if (same && (ctx.time - this.pathFailAt < 2 || ctx.time - this.arrivedAt < 1.5)) return;
    this.pathGoal = { x: to.x, z: to.z };
    this.pathPending = true;
    ctx.requestPath(this, to, (p) => {
      this.pathPending = false;
      this.path = p ?? [];
      if (!p) this.pathFailAt = ctx.time;
      this.stuck = 0;
    });
  }

  stop() { this.path = []; this.pathGoal = null; }

  lookAt(x: number, z: number) { this.wantYaw = Math.atan2(-(x - this.pos.x), -(z - this.pos.z)); }
  lookYaw(y: number) { this.wantYaw = y; }

  /** Moves along the current path with simple separation. Returns true when there is no path left. */
  move(dt: number, ctx: GameCtx, speed: number): boolean {
    if (!this.path.length) { this.speed *= 0.8; return !this.pathPending; }
    const t = this.path[0];
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) {
      this.path.shift();
      if (!this.path.length) { this.speed = 0; this.arrivedAt = ctx.time; return true; }
      return false;
    }
    let mx = dx / d, mz = dz / d;
    // separation from other standing actors
    let sx = 0, sz = 0;
    for (const o of ctx.actors) {
      if (o === this || !o.standing) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const dd = ox * ox + oz * oz;
      const r = o.body ? 0.8 : 1.4; // keep clear of the Lt's camera
      if (dd < r * r && dd > 1e-4) { const d = Math.sqrt(dd); sx += (ox / d) * (r - d); sz += (oz / d) * (r - d); }
    }
    mx += sx * 1.5; mz += sz * 1.5;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const step = Math.min(d, speed * dt);
    const nx = this.pos.x + mx * step, nz = this.pos.z + mz * step;
    const nav = ctx.nav;
    let moved = true;
    if (nav.walkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    else if (nav.walkable(nx, this.pos.z)) this.pos.x = nx;
    else if (nav.walkable(this.pos.x, nz)) this.pos.z = nz;
    else moved = false;
    this.speed = moved ? speed : 0;
    if (!moved) {
      this.stuck += dt;
      if (this.stuck > 1.5 && this.pathGoal) { const g = this.pathGoal; this.pathGoal = null; this.goTo(ctx, g); }
    } else this.stuck = 0;
    if (this.wantYaw === null || !this.aiming) this.wantYaw = Math.atan2(-mx, -mz);
    return false;
  }

  turn(dt: number, rate = 6) {
    if (this.wantYaw === null) return;
    let d = this.wantYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * rate);
  }

  syncMesh(dt: number) {
    if (!this.body) return;
    this.body.root.position.copy(this.pos);
    this.body.root.rotation.y = this.yaw;
    const pose = this.status === 'dead' ? 'dead' : this.status === 'wounded' ? 'wounded' : this.status === 'surrendered' ? 'surrender' : this.status === 'arrested' ? 'arrested' : 'normal';
    this.body.setPose(pose);
    this.body.animate(dt, this.speed, this.crouch && this.status === 'ok', this.aiming);
  }

  takeDamage(ctx: GameCtx, amount: number, source: Actor | null) {
    if (this.status === 'dead' || this.status === 'evacuated') return;
    this.hp -= amount;
    this.underFireAt = ctx.time;
    ctx.onDamage(this, source, amount);
  }

  abstract update(dt: number, ctx: GameCtx): void;
}

/** Can `a` see `b`? Range shrinks in the dark parts of the tunnel. */
export function canSee(ctx: GameCtx, a: Actor, b: Actor, range: number): boolean {
  const d = a.distTo(b);
  if (d > range) return false;
  return ctx.nav.los(a.pos.x, a.pos.z, b.pos.x, b.pos.z);
}

/** Global vision modifier (e.g. emergency power restored). */
export const vision = { bonus: 1 };

export function visibilityRange(z: number): number {
  if (z > -5) return 160;
  if (z > -260) return 95;
  if (z > -400) return 70 * vision.bonus;
  return 55 * vision.bonus;
}
