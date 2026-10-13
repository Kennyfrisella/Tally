import { Actor, GameCtx } from './actor';
import { GALLERY } from '../world/layout';

const COATS = [0x7a2e2e, 0x2e4a7a, 0xc9a227, 0x3c3c3c, 0x6b8e4e, 0xd9d4c7, 0x8c4f9e];

// Motorists stranded in the tunnel. They hide by their cars until someone leads them out.

export class Civilian extends Actor {
  followTarget: Actor | null = null;
  private nextRepath = 0;
  private goneTimer = -1;
  private exitPath = false;

  constructor(x: number, z: number, i: number) {
    super('civ', 'civilian', COATS[i % COATS.length]);
    this.pos.set(x, 0, z);
    this.yaw = Math.random() * 6.28;
    this.name = 'Zivilperson';
  }

  get safe(): boolean {
    return this.pos.x > GALLERY.x - GALLERY.halfWidth - 0.2 || this.pos.z > 12;
  }

  follow(a: Actor | null) {
    this.followTarget = a;
  }

  evacuate(ctx: GameCtx) {
    if (this.status !== 'ok') return;
    this.status = 'evacuated';
    this.followTarget = null;
    ctx.event('evacuated', { who: this });
    // walk out of sight, then disappear
    const out = this.pos.x > GALLERY.x - 3 ? { x: GALLERY.x, z: -5 } : { x: 24, z: 70 };
    this.goTo(ctx, out);
    this.exitPath = true;
    this.goneTimer = 25;
  }

  update(dt: number, ctx: GameCtx) {
    if (this.status === 'evacuated') {
      if (this.exitPath) this.move(dt, ctx, 2.6);
      this.goneTimer -= dt;
      if (this.goneTimer <= 0 && this.body) this.body.root.visible = false;
      this.turn(dt);
      this.syncMesh(dt);
      return;
    }
    if (this.status !== 'ok') { this.speed = 0; this.syncMesh(dt); return; }

    const f = this.followTarget;
    if (f && f.status === 'ok') {
      const d = this.distTo(f);
      if (ctx.time >= this.nextRepath && d > 2.6) {
        this.nextRepath = ctx.time + 0.8;
        const a = Math.atan2(this.pos.x - f.pos.x, this.pos.z - f.pos.z);
        this.goTo(ctx, { x: f.pos.x + Math.sin(a) * 1.6, z: f.pos.z + Math.cos(a) * 1.6 });
      }
      const fast = d > 8 ? 4.2 : 2.8;
      this.move(dt, ctx, fast);
      this.crouch = false;
      if (this.safe) this.evacuate(ctx);
    } else {
      if (f) this.followTarget = null;
      this.stop();
      this.speed = 0;
      // cower when there is shooting around
      let danger = false;
      for (const a of ctx.actors) if (ctx.time - a.lastShotAt < 3 && a.distTo(this) < 60) { danger = true; break; }
      this.crouch = danger || ctx.time - this.underFireAt < 10 || Math.sin(ctx.time * 0.2 + this.id) > 0.2;
      const p = ctx.playerActor();
      if (p.distTo(this) < 12) this.lookAt(p.pos.x, p.pos.z);
    }
    this.turn(dt, 4);
    this.syncMesh(dt);
  }
}
