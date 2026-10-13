import { Actor, GameCtx, canSee, visibilityRange } from './actor';
import { aiFire } from '../combat/ballistics';
import type { EnemySpec, Vec2 } from '../world/layout';

// Armed saboteurs. They hold cover positions, pop up to fire in bursts, fall back when hurt and can be
// talked into surrendering when they are clearly outnumbered — the outcome the ROE prefers.

export class Enemy extends Actor {
  state: 'unaware' | 'alert' = 'unaware';
  cell: string;
  home: Vec2;
  fallback: Vec2 | null;
  spottedAt = -99;
  private target: Actor | null = null;
  private nextScan = 0;
  private nextShot = 0;
  private burst = 0;
  private coverPhase = 0;
  private coverTimer = 0;
  private nextSurrenderCheck = 0;
  private retreated = false;
  nerve: number;

  constructor(spec: EnemySpec) {
    super('red', 'enemy');
    this.cell = spec.cell;
    this.pos.set(spec.x, 0, spec.z);
    this.home = { x: spec.x, z: spec.z };
    this.yaw = spec.face;
    this.fallback = spec.fallback ?? null;
    this.nerve = 0.6 + Math.random() * 0.4;
    this.hp = 130;
    this.name = `Saboteur ${spec.cell}`;
  }

  alert(ctx: GameCtx) {
    if (this.state === 'alert' || this.status !== 'ok') return;
    this.state = 'alert';
    for (const a of ctx.actors) if (a instanceof Enemy && a.cell === this.cell && a.state === 'unaware') a.alert(ctx);
    if (this.cell === 'C') ctx.event('chargeArmed');
  }

  private blueNear(ctx: GameCtx, r: number): number {
    let n = 0;
    for (const a of ctx.actors) if (a.faction === 'blue' && a.active && a.distTo(this) < r && ctx.nav.los(a.pos.x, a.pos.z, this.pos.x, this.pos.z)) n++;
    return n;
  }

  private matesDown(ctx: GameCtx): number {
    let n = 0;
    for (const a of ctx.actors) if (a instanceof Enemy && a.cell === this.cell && a !== this && a.status !== 'ok') n++;
    return n;
  }

  /** Response to "Halt! Armee! Waffe weg!" */
  challenge(ctx: GameCtx, bonus = 0): boolean {
    if (this.status !== 'ok') return false;
    const near = this.blueNear(ctx, 25);
    if (near < 2) return false;
    let p = 0.12 + near * 0.06 + this.matesDown(ctx) * 0.15 + (this.hp < 60 ? 0.3 : 0) + bonus - (this.nerve - 0.6) * 0.5;
    if (this.state === 'unaware') p += 0.2; // surprised
    if (Math.random() < p) { this.surrender(ctx); return true; }
    this.alert(ctx);
    return false;
  }

  surrender(ctx: GameCtx) {
    this.status = 'surrendered';
    this.aiming = false;
    this.stop();
    ctx.event('surrender', { who: this });
  }

  update(dt: number, ctx: GameCtx) {
    if (this.status === 'surrendered') {
      const p = ctx.playerActor();
      this.lookAt(p.pos.x, p.pos.z);
      this.turn(dt, 2);
      this.speed = 0;
      this.syncMesh(dt);
      return;
    }
    if (this.status !== 'ok') { this.speed = 0; this.syncMesh(dt); return; }

    const range = visibilityRange(this.pos.z);
    if (ctx.time >= this.nextScan) {
      this.nextScan = ctx.time + 0.35 + Math.random() * 0.3;
      let best: Actor | null = null, bd = Infinity;
      for (const a of ctx.actors) {
        if (a.faction !== 'blue' || !a.active) continue;
        const d = a.distTo(this);
        // unaware enemies only notice what is in front of them, at shorter range
        const r = this.state === 'unaware' ? range * 0.55 : range;
        if (d > r || d >= bd) continue;
        if (this.state === 'unaware') {
          const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
          const dot = ((a.pos.x - this.pos.x) * fx + (a.pos.z - this.pos.z) * fz) / Math.max(d, 0.01);
          if (dot < 0.2 && d > 6) continue;
        }
        if (!canSee(ctx, this, a, r)) continue;
        best = a; bd = d;
      }
      this.target = best;
      if (best && this.state === 'unaware') this.alert(ctx);
      // gunfire nearby alerts the cell
      if (this.state === 'unaware') {
        for (const a of ctx.actors) if (a.faction === 'blue' && ctx.time - a.lastShotAt < 0.5 && a.distTo(this) < 70) { this.alert(ctx); break; }
      }
    }

    if (this.state === 'alert' && ctx.time >= this.nextSurrenderCheck) {
      this.nextSurrenderCheck = ctx.time + 1.5;
      const near = this.blueNear(ctx, 18);
      const down = this.matesDown(ctx);
      if ((near >= 3 && (this.hp < 60 || down >= 1) && Math.random() < 0.3 * (1.4 - this.nerve)) || (near >= 6 && Math.random() < 0.2)) {
        this.surrender(ctx);
        this.syncMesh(dt);
        return;
      }
      if (this.hp < 50 && this.fallback && !this.retreated) {
        this.retreated = true;
        this.goTo(ctx, this.fallback);
      }
    }

    let moving = false;
    if (this.path.length || this.pathPending) {
      moving = !this.move(dt, ctx, 3.8);
      this.crouch = false;
    }

    if (this.state === 'alert' && this.target && this.target.active && !moving) {
      this.lookAt(this.target.pos.x, this.target.pos.z);
      // cover cycle: duck, then pop up and fire a burst
      this.coverTimer -= dt;
      if (this.coverTimer <= 0) {
        this.coverPhase = 1 - this.coverPhase;
        this.coverTimer = this.coverPhase === 1 ? 1.2 + Math.random() * 1.6 : 1.0 + Math.random() * 1.8;
        this.burst = this.coverPhase === 1 ? 3 + Math.floor(Math.random() * 4) : 0;
      }
      this.crouch = this.coverPhase === 0;
      this.aiming = this.coverPhase === 1;
      if (this.aiming && this.burst > 0 && ctx.time >= this.nextShot && canSee(ctx, this, this.target, range)) {
        aiFire(ctx, this, this.target, 0.42, [26, 42]);
        this.burst--;
        this.nextShot = ctx.time + 0.11 + Math.random() * 0.12;
      }
    } else if (this.state === 'alert') {
      this.aiming = false;
      this.crouch = !moving;
    } else {
      this.crouch = false;
      this.aiming = false;
    }
    this.turn(dt, 7);
    this.syncMesh(dt);
  }
}
