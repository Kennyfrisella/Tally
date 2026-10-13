import { Actor, GameCtx, canSee, visibilityRange } from './actor';
import { aiFire } from '../combat/ballistics';
import { Enemy } from './enemy';
import type { Gruppe } from '../command/platoon';
import type { Vec2 } from '../world/layout';

export type Role = 'Gfhr' | 'Stv' | 'San' | 'Mg' | 'Sdt';

export class Soldier extends Actor {
  task: 'slot' | 'sweep' | 'arrest' | 'treat' = 'slot';
  slot: Vec2 | null = null;
  sweepPoint: Vec2 | null = null;
  sweepDone = false;
  taskTarget: Actor | null = null;
  target: Enemy | null = null;
  treated = false;
  bleed = 150;
  private treatT = 0;
  private nextScan = Math.random() * 0.4;
  private nextShot = 0;
  private burst = 0;
  arrived = false;
  readonly skill: number;

  constructor(readonly gruppe: Gruppe, readonly rank: string, readonly role: Role, first: string, last: string, x: number, z: number) {
    super('blue', 'soldier');
    this.name = `${rank} ${last}`;
    void first;
    this.pos.set(x, 0, z);
    this.skill = role === 'Gfhr' ? 0.62 : role === 'Mg' ? 0.55 : 0.45 + Math.random() * 0.15;
  }

  get canFight() { return this.status === 'ok' && this.task !== 'treat'; }

  private acquire(ctx: GameCtx): Enemy | null {
    const range = visibilityRange(Math.max(this.pos.z, -620));
    let best: Enemy | null = null, bd = Infinity;
    for (const a of ctx.actors) {
      if (!(a instanceof Enemy) || a.status !== 'ok') continue;
      const d = a.distTo(this);
      if (d > range || d >= bd) continue;
      if (!canSee(ctx, this, a, range)) continue;
      best = a; bd = d;
    }
    return best;
  }

  update(dt: number, ctx: GameCtx) {
    if (this.status === 'wounded') {
      if (!this.treated) {
        this.bleed -= dt;
        if (this.bleed <= 0) {
          this.status = 'dead';
          ctx.event('kia', { who: this, bledOut: true });
        }
      }
      this.speed = 0;
      this.syncMesh(dt);
      return;
    }
    if (this.status !== 'ok') { this.speed = 0; this.syncMesh(dt); return; }
    const G = this.gruppe;

    // --- perception ---
    if (ctx.time >= this.nextScan) {
      this.nextScan = ctx.time + 0.25 + Math.random() * 0.25 + (1 - G.morale / 100) * 0.3;
      this.target = this.acquire(ctx);
      if (this.target) {
        this.target.spottedAt = ctx.time;
        G.reportContact(ctx, this.target);
      }
    }
    const t = this.target && this.target.status === 'ok' ? this.target : null;
    const threatened = ctx.time - G.underFireAt < 6;
    const mayFire = !!t && (G.roe === 'free' || threatened) && this.task !== 'treat';
    if (t && !mayFire && t.distTo(this) < 30) G.challenge(ctx, t);

    // --- fire ---
    this.aiming = mayFire || G.order.kind === 'clear';
    if (mayFire && t) {
      this.lookAt(t.pos.x, t.pos.z);
      if (ctx.time >= this.nextShot) {
        const acc = this.skill * (0.55 + 0.35 * G.morale / 100) * (this.crouch ? 1.1 : 1);
        aiFire(ctx, this, t, acc, [30, 55]);
        if (this.burst <= 0) this.burst = this.role === 'Mg' ? 6 : 1 + Math.floor(Math.random() * 3);
        this.burst--;
        this.nextShot = ctx.time + (this.burst > 0 ? (this.role === 'Mg' ? 0.09 : 0.18) : 0.6 + Math.random() * 0.9);
      }
    }

    // --- tasks ---
    let goal: Vec2 | null = null;
    switch (this.task) {
      case 'treat': {
        const w = this.taskTarget;
        if (!w || w.status !== 'wounded' || (w as Soldier).treated) { this.task = 'slot'; this.treatT = 0; break; }
        goal = { x: w.pos.x + 0.7, z: w.pos.z };
        if (this.distTo(w) < 1.4) {
          this.treatT += dt;
          this.crouch = true;
          this.lookAt(w.pos.x, w.pos.z);
          if (this.treatT > 7) {
            (w as Soldier).treated = true;
            ctx.event('treated', { who: w, by: this });
            ctx.radio(this.gruppe.callsign, `${w.name} ist versorgt und stabil.`, 'info');
            this.task = 'slot';
            this.treatT = 0;
          }
          goal = null;
        }
        break;
      }
      case 'arrest': {
        const e = this.taskTarget as Enemy | null;
        if (!e || e.status !== 'surrendered') { this.task = 'slot'; break; }
        goal = { x: e.pos.x, z: e.pos.z + 1 };
        if (this.distTo(e) < 1.9) {
          e.status = 'arrested';
          ctx.event('arrest', { who: e, by: this });
          ctx.radio(G.callsign, `Person festgenommen bei ${G.where(e.pos.x, e.pos.z)}. Entwaffnet und gefesselt.`, 'info');
          this.task = 'slot';
          goal = null;
        }
        break;
      }
      case 'sweep':
        goal = this.sweepPoint;
        if (goal && this.distTo(goal) < 1.2) { this.sweepDone = true; this.task = 'slot'; }
        break;
      default:
        goal = this.slot;
    }

    if (goal) this.goTo(ctx, goal);
    const pathLeft = this.path.length ? ctx.nav.pathLength(this.pos, this.path) : 0;
    const run = !mayFire && !threatened && pathLeft > 18 && G.morale > 30 && G.order.kind !== 'clear';
    let speed = mayFire ? 1.5 : run ? 4.3 : 2.4;
    if (G.order.kind === 'follow') {
      const p = ctx.playerActor();
      speed = Math.max(speed, Math.min(5.2, p.speed + 0.6));
    }
    if (G.morale < 25) speed *= 0.75;
    const done = this.move(dt, ctx, speed);
    this.arrived = done && this.task === 'slot';
    if (this.arrived && !mayFire && this.task === 'slot') this.lookYaw(G.holdYaw + this.facingJitter());
    if (this.task !== 'treat') this.crouch = (this.arrived && G.order.kind !== 'follow' && G.order.kind !== 'idle') || (threatened && this.speed < 0.3);
    this.turn(dt, mayFire ? 10 : 5);
    this.syncMesh(dt);
  }

  private facingJitter(): number {
    // each soldier covers a slightly different sector
    return ((this.id % 5) - 2) * 0.18;
  }
}
