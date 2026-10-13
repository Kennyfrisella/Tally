import * as THREE from 'three';
import { Actor, GameCtx } from './actor';
import type { Input } from '../engine/input';
import { insideness } from '../world/layout';

/** The Leutnant: first-person controller. Lives on the nav grid like every other actor. */
export class Player extends Actor {
  pitch = 0;
  camera: THREE.PerspectiveCamera;
  sprinting = false;
  private eye = 1.62;
  private bob = 0;
  private stepAcc = 0;
  private lastDamage = -99;
  sensitivity = 0.0022;
  recoilPitch = 0;
  recoilYaw = 0;
  baseFov = 74;
  ads = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    super('blue', null);
    this.camera = camera;
    this.name = 'Lt';
  }

  takeDamage(ctx: GameCtx, amount: number, source: Actor | null) {
    this.lastDamage = ctx.time;
    super.takeDamage(ctx, amount, source);
  }

  control(dt: number, input: Input, ctx: GameCtx, enabled: boolean) {
    if (enabled) {
      const sens = this.sensitivity * (1 - this.ads * 0.45);
      this.yaw -= input.mouseDX * sens;
      this.pitch -= input.mouseDY * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    }
    // recoil recovers towards zero
    this.pitch += this.recoilPitch * dt * 12;
    this.yaw += this.recoilYaw * dt * 12;
    this.recoilPitch *= Math.max(0, 1 - dt * 12);
    this.recoilYaw *= Math.max(0, 1 - dt * 12);

    let fwd = 0, side = 0;
    if (enabled && this.status === 'ok') {
      if (input.isDown('KeyW')) fwd += 1;
      if (input.isDown('KeyS')) fwd -= 1;
      if (input.isDown('KeyD')) side += 1;
      if (input.isDown('KeyA')) side -= 1;
      if (input.wasPressed('KeyC')) this.crouch = !this.crouch;
    }
    this.sprinting = enabled && input.isDown('ShiftLeft') && fwd > 0 && this.ads < 0.3;
    if (this.sprinting) this.crouch = false;
    const speed = this.sprinting ? 6.0 : this.crouch ? 1.7 : this.ads > 0.5 ? 2.0 : 3.3;
    const len = Math.hypot(fwd, side);
    const moving = len > 0;
    if (moving) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const mx = (fx * fwd + rx * side) / len, mz = (fz * fwd + rz * side) / len;
      const nx = this.pos.x + mx * speed * dt, nz = this.pos.z + mz * speed * dt;
      const nav = ctx.nav;
      if (nav.walkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
      else if (nav.walkable(nx, this.pos.z)) this.pos.x = nx;
      else if (nav.walkable(this.pos.x, nz)) this.pos.z = nz;
      this.speed = speed;
      this.bob += dt * speed * 2.1;
      this.stepAcc += dt * speed;
      if (this.stepAcc > 1.6) { this.stepAcc = 0; ctx.audio.footstep(insideness(this.pos.x, this.pos.z)); }
    } else {
      this.speed = 0;
    }

    // health regeneration after a few seconds out of contact
    if (this.status === 'ok' && ctx.time - this.lastDamage > 6 && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 9);

    const targetEye = this.status !== 'ok' ? 0.4 : this.crouch ? 1.08 : 1.62;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
    const bobAmt = moving ? (this.sprinting ? 0.06 : 0.035) * (1 - this.ads * 0.8) : 0;
    this.camera.position.set(this.pos.x, this.eye + Math.abs(Math.sin(this.bob)) * bobAmt, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bob * 0.5) * bobAmt * 0.3, 'YXZ');
  }

  get damageFlash() { return this.lastDamage; }

  update(): void { /* driven by control() */ }
}
