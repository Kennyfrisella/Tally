import * as THREE from 'three';
import type { Player } from './player';

// Sturmgewehr 90 (SIG 550) first-person viewmodel and its handling state.

export class Rifle {
  model = new THREE.Group();
  muzzle = new THREE.Object3D();
  flash: THREE.Sprite;
  mag = 20;
  readonly magSize = 20;
  reserve = 120;
  mode: 'Einzel' | 'Serie' = 'Einzel';
  reloading = 0;
  private cooldown = 0;
  private kick = 0;
  private sway = new THREE.Vector2();
  private flashT = 0;
  bloom = 0;
  flashlightOn = false;

  constructor() {
    const olive = new THREE.MeshStandardMaterial({ color: 0x23271c, roughness: 0.7, metalness: 0.05 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0f1010, roughness: 0.55, metalness: 0.35 });
    const magMat = new THREE.MeshStandardMaterial({ color: 0xb8bdb0, roughness: 0.25, metalness: 0.0, transparent: true, opacity: 0.55 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.3, metalness: 0.9 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.rotation.x = rx;
      this.model.add(o);
      return o;
    };
    // receiver, handguard, barrel, flash hider
    add(new THREE.BoxGeometry(0.052, 0.085, 0.36), black, 0, 0, 0);
    add(new THREE.BoxGeometry(0.06, 0.07, 0.24), olive, 0, -0.005, -0.29);
    add(new THREE.CylinderGeometry(0.009, 0.009, 0.24, 10).rotateX(Math.PI / 2), black, 0, 0.012, -0.5);
    add(new THREE.CylinderGeometry(0.013, 0.013, 0.06, 8).rotateX(Math.PI / 2), black, 0, 0.012, -0.64);
    // bipod folded under the handguard
    add(new THREE.BoxGeometry(0.012, 0.012, 0.2), black, 0.018, -0.045, -0.36);
    add(new THREE.BoxGeometry(0.012, 0.012, 0.2), black, -0.018, -0.045, -0.36);
    // pistol grip and translucent magazine with visible rounds
    add(new THREE.BoxGeometry(0.04, 0.11, 0.05), olive, 0, -0.085, 0.07, 0.3);
    add(new THREE.BoxGeometry(0.035, 0.16, 0.075), magMat, 0, -0.11, -0.06, 0.18);
    add(new THREE.BoxGeometry(0.012, 0.13, 0.06), brass, 0, -0.1, -0.06, 0.18);
    // skeleton folding stock
    add(new THREE.BoxGeometry(0.03, 0.02, 0.24), olive, 0, 0.02, 0.29);
    add(new THREE.BoxGeometry(0.03, 0.02, 0.22), olive, 0, -0.045, 0.28, -0.15);
    add(new THREE.BoxGeometry(0.035, 0.11, 0.025), olive, 0, -0.01, 0.41);
    // diopter rear sight + front sight
    add(new THREE.TorusGeometry(0.011, 0.0045, 6, 16), black, 0, 0.06, 0.1);
    add(new THREE.BoxGeometry(0.02, 0.02, 0.02), black, 0, 0.04, 0.1);
    add(new THREE.BoxGeometry(0.004, 0.022, 0.006), black, 0, 0.049, -0.47);
    add(new THREE.BoxGeometry(0.02, 0.012, 0.03), black, 0, 0.034, -0.47);
    // tactical light
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.08, 10).rotateX(Math.PI / 2), black, 0.04, -0.01, -0.33);
    // hands/gloves
    const glove = new THREE.MeshStandardMaterial({ color: 0x3a3428, roughness: 0.9 });
    add(new THREE.SphereGeometry(0.04, 10, 8).scale(1, 1.2, 1.4), glove, 0.0, -0.06, 0.05);
    add(new THREE.SphereGeometry(0.042, 10, 8).scale(1.2, 1, 1.6), glove, -0.01, -0.045, -0.3);
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x3f4a2c, roughness: 0.95 });
    add(new THREE.CylinderGeometry(0.045, 0.05, 0.35, 10).rotateX(Math.PI / 2 - 0.25), sleeve, -0.07, -0.12, -0.12).rotation.z = 0.5;
    add(new THREE.CylinderGeometry(0.05, 0.055, 0.3, 10).rotateX(Math.PI / 2), sleeve, 0.04, -0.09, 0.22);

    this.model.scale.setScalar(0.8);
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.castShadow = false; o.renderOrder = 10; }
    });
    this.muzzle.position.set(0, 0.012, -0.68);
    this.model.add(this.muzzle);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.3, 'rgba(255,170,60,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(3, 2.5, 1.8) }));
    this.flash.scale.setScalar(0.18);
    this.flash.visible = false;
    this.muzzle.add(this.flash);
  }

  /** Returns true when a round leaves the barrel this frame. */
  tick(dt: number, trigger: boolean, triggerPressed: boolean): boolean {
    this.cooldown -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 3);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = this.magSize - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take;
        this.reserve -= take;
      }
      return false;
    }
    const want = this.mode === 'Serie' ? trigger : triggerPressed;
    if (!want || this.cooldown > 0 || this.mag <= 0) return false;
    this.mag--;
    this.cooldown = this.mode === 'Serie' ? 0.086 : 0.11;
    this.kick = 1;
    this.bloom = Math.min(1, this.bloom + 0.22);
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flashT = 0.04;
    return true;
  }

  reload(): boolean {
    if (this.reloading > 0 || this.mag === this.magSize || this.reserve <= 0) return false;
    this.reloading = this.mag === 0 ? 2.6 : 2.1;
    return true;
  }

  /** Positions the viewmodel relative to the camera: hip, aimed, sprint, reload. */
  pose(dt: number, p: Player, mouseDX: number, mouseDY: number) {
    this.kick = Math.max(0, this.kick - dt * 14);
    this.sway.x += (-mouseDX * 0.0004 - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (mouseDY * 0.0004 - this.sway.y) * Math.min(1, dt * 8);
    const a = p.ads;
    const sprint = p.sprinting ? 1 : 0;
    const t = performance.now() / 1000;
    const bob = p.speed > 0.1 ? Math.sin(t * p.speed * 2.1) : 0;
    const hip = new THREE.Vector3(0.15, -0.155, -0.36);
    const ads = new THREE.Vector3(0, -0.048, -0.17);
    const pos = hip.lerp(ads, a);
    pos.x += this.sway.x + bob * 0.006 * (1 - a) + sprint * 0.05;
    pos.y += this.sway.y - Math.abs(bob) * 0.008 * (1 - a) - sprint * 0.04;
    pos.z += this.kick * 0.045;
    const rl = this.reloading > 0 ? Math.sin(Math.min(1, (this.reloading / 2.2)) * Math.PI) : 0;
    pos.y -= rl * 0.08;
    this.model.position.copy(pos);
    this.model.rotation.set(this.kick * 0.06 + rl * 0.5 - sprint * 0.35, 0.05 * (1 - a) + sprint * 0.6, rl * 0.6 + sprint * 0.3);
  }
}
