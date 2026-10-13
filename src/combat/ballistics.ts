import * as THREE from 'three';
import type { Actor, GameCtx } from '../actors/actor';
import { Cell } from '../world/navgrid';
import { TUNNEL, GALLERY, insideTunnel } from '../world/layout';

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Probability-based fire for AI shooters, with visible tracer and audible report. */
export function aiFire(ctx: GameCtx, shooter: Actor, target: Actor, accuracy: number, damage: [number, number]) {
  const d = shooter.distTo(target);
  let p = accuracy * THREE.MathUtils.clamp(1.15 - d / 90, 0.12, 1);
  if (target.crouch) p *= 0.6;
  if (target.speed > 1.8) p *= 0.65;
  if (shooter.speed > 0.5) p *= 0.6;
  // a car (low obstacle) right in front of the target gives cover
  const dx = shooter.pos.x - target.pos.x, dz = shooter.pos.z - target.pos.z;
  const L = Math.hypot(dx, dz) || 1;
  for (let s = 0.6; s < 2.6; s += 0.4) {
    if (ctx.nav.get(target.pos.x + (dx / L) * s, target.pos.z + (dz / L) * s) === Cell.LOW) { p *= target.crouch ? 0.25 : 0.55; break; }
  }
  const hit = Math.random() < p;
  const muzzle = shooter.body ? shooter.body.muzzleWorld(tmpA) : shooter.chest(tmpA);
  const end = target.chest(tmpB);
  if (!hit) {
    end.x += (Math.random() - 0.5) * 1.6;
    end.y += (Math.random() - 0.3) * 1.2;
    end.z += (Math.random() - 0.5) * 1.6;
    // carry on past the target to a wall
    const dir = end.clone().sub(muzzle).normalize();
    end.addScaledVector(dir, 4 + Math.random() * 10);
    if (end.y < 0) end.y = 0.02;
    ctx.effects.impact(end, dir.negate(), 'concrete');
  } else {
    ctx.effects.impact(end, new THREE.Vector3(dx / L, 0.3, dz / L), 'blood');
  }
  if (Math.random() < 0.55) ctx.effects.tracer(muzzle, end, shooter.faction === 'red');
  ctx.effects.muzzleFlash(muzzle, 0.45);
  if (shooter.body) shooter.body.kick();
  shooter.lastShotAt = ctx.time;
  ctx.audio.shot(shooter.pos.x, shooter.pos.z, shooter.faction === 'red' ? 'enemy' : 'friendly');
  const pl = ctx.playerActor();
  if (pl.distTo(shooter) < 25) ctx.env.flash(muzzle, 14);
  // near misses still suppress
  if (hit) target.takeDamage(ctx, damage[0] + Math.random() * (damage[1] - damage[0]), shooter);
  else if (Math.random() < 0.5) target.underFireAt = ctx.time;
}

export interface RayHit { dist: number; point: THREE.Vector3; normal: THREE.Vector3; actor: Actor | null; head: boolean }

/** Hitscan for the player's rifle: actors (vertical capsules), walls (nav grid), floor and ceiling planes. */
export function rayCast(ctx: GameCtx, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, ignore: Actor | null): RayHit {
  let best = maxDist;
  let normal = new THREE.Vector3(0, 1, 0);
  // floor
  if (dir.y < -1e-4) {
    const t = -origin.y / dir.y;
    if (t < best) { best = t; normal = new THREE.Vector3(0, 1, 0); }
  }
  // ceiling when inside a bore
  if (dir.y > 1e-4 && insideTunnel(origin.x, origin.z)) {
    const ceil = origin.x > GALLERY.x - 3 ? GALLERY.apex : TUNNEL.apex;
    const t = (ceil - origin.y) / dir.y;
    if (t < best) { best = t; normal = new THREE.Vector3(0, -1, 0); }
  }
  // walls / tall obstacles on the grid, and low obstacles below 1.1 m
  const h = Math.hypot(dir.x, dir.z);
  if (h > 1e-4) {
    for (let d = 0.3; d < best; d += 0.15) {
      const x = origin.x + dir.x * d, z = origin.z + dir.z * d, y = origin.y + dir.y * d;
      const c = ctx.nav.get(x, z);
      if (c === Cell.ROCK || c === Cell.OBST || (c === Cell.LOW && y < 1.1)) {
        best = d;
        normal = new THREE.Vector3(-dir.x / h, 0, -dir.z / h);
        break;
      }
    }
  }
  let hitActor: Actor | null = null;
  let head = false;
  for (const a of ctx.actors) {
    if (a === ignore || a.status === 'dead' || a.status === 'evacuated' || !a.body) continue;
    const lying = a.status === 'wounded';
    const top = lying ? 0.35 : a.crouch && a.status === 'ok' ? 1.25 : 1.78;
    const t = rayCapsule(origin, dir, a.pos.x, a.pos.z, 0.12, top, lying ? 0.45 : 0.27);
    if (t !== null && t < best) {
      best = t;
      hitActor = a;
      head = origin.y + dir.y * t > top - 0.26;
      normal = dir.clone().negate();
    }
  }
  return { dist: best, point: origin.clone().addScaledVector(dir, best), normal, actor: hitActor, head };
}

/** Ray vs vertical capsule. Returns hit distance or null. */
function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, cx: number, cz: number, y0: number, y1: number, r: number): number | null {
  // closest approach between ray and the axis segment, then a sphere test at that height
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return null;
  const b = ox * d.x + oz * d.z;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return null;
  const y = o.y + d.y * t;
  if (y < y0 || y > y1 + r * 0.5) return null;
  return t;
}
