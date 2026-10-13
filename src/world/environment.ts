import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Quality } from '../engine/quality';
import type { Lamp } from './tunnel';
import { insideness } from './layout';

// Sun, sky, image-based lighting, fog, and the small pool of dynamic lights that follows the player in the tunnel.

export class Environment {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sunDir = new THREE.Vector3();
  fog: THREE.FogExp2;
  pool: THREE.PointLight[] = [];
  flashlight: THREE.SpotLight;
  muzzle: THREE.PointLight;
  police: THREE.PointLight;
  inside = 0;
  exposure = 1;
  private outsideFog = new THREE.Color(0xaab4c0);
  private insideFog = new THREE.Color(0x15110c);
  private envTex: THREE.Texture | null = null;

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer, private q: Quality, private lamps: Lamp[], private policePos: THREE.Vector3[]) {
    // Late-afternoon October sun from the south-west, low over the ridge
    const elevation = 24, azimuth = 145; // +X is west, so this puts the sun in the south-west
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    const sky = new Sky();
    sky.scale.setScalar(20000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4.5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    scene.add(sky);

    // Image-based lighting from the sky
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    Object.assign(sky2.material.uniforms.turbidity, { value: 4.5 });
    sky2.material.uniforms.rayleigh.value = 1.4;
    sky2.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(sky2);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a3b33 }));
    ground.position.y = -5;
    envScene.add(ground);
    this.envTex = pmrem.fromScene(envScene, 0.02).texture;
    scene.environment = this.envTex;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xc4d4ec, 0x4a4436, 0.9);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe2c0, 3.2);
    this.sun.position.copy(this.sunDir).multiplyScalar(300);
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      const c = this.sun.shadow.camera;
      c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.near = 10; c.far = 900;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.fog = new THREE.FogExp2(this.outsideFog.getHex(), 0.0009);
    scene.fog = this.fog;

    for (let i = 0; i < q.tunnelLights; i++) {
      const L = new THREE.PointLight(0xffd8a8, 0, 22, 2);
      scene.add(L);
      this.pool.push(L);
    }

    this.flashlight = new THREE.SpotLight(0xfff4e0, 0, 60, THREE.MathUtils.degToRad(17), 0.55, 1.6);
    scene.add(this.flashlight);
    scene.add(this.flashlight.target);

    this.muzzle = new THREE.PointLight(0xffb060, 0, 9, 2);
    scene.add(this.muzzle);
    this.police = new THREE.PointLight(0x3060ff, 0, 18, 1.6);
    scene.add(this.police);
  }

  update(dt: number, t: number, cam: THREE.Camera, playerX: number, playerZ: number) {
    const target = insideness(playerX, playerZ);
    this.inside += (target - this.inside) * Math.min(1, dt * 1.2);
    const k = this.inside;

    // Sun shadow follows the player; deep inside we switch the sun off to stop any light leaking through.
    const deep = THREE.MathUtils.clamp((-playerZ - 40) / 40, 0, 1);
    this.sun.intensity = 3.2 * (1 - deep);
    this.sun.visible = deep < 1;
    this.sun.target.position.set(playerX, 0, Math.max(playerZ, -60));
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 400);
    if (this.q.shadows) {
      // texel snapping keeps shadows from shimmering as the camera moves
      const texel = 140 / this.q.shadowMapSize;
      this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
      this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
      this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 400);
    }

    this.hemi.intensity = THREE.MathUtils.lerp(0.9, 0.22, k);
    this.hemi.color.setRGB(THREE.MathUtils.lerp(0.77, 1.0, k), THREE.MathUtils.lerp(0.83, 0.82, k), THREE.MathUtils.lerp(0.93, 0.62, k));
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.55, 0.06, k);
    this.fog.color.copy(this.outsideFog).lerp(this.insideFog, k);
    this.fog.density = THREE.MathUtils.lerp(0.0009, 0.016, k);
    // eye adaptation: open up the exposure inside
    this.exposure = THREE.MathUtils.lerp(0.95, 1.75, k);

    // Dynamic light pool snapped to the nearest lit fixtures, faded by rank so nothing pops.
    const inTunnel = playerZ < 2 && playerX < 12;
    if (inTunnel) {
      const near: Lamp[] = [];
      for (const L of this.lamps) {
        if (!L.on) continue;
        if (Math.abs(L.z - playerZ) < 30) near.push(L);
      }
      near.sort((a, b) => Math.abs(a.z - playerZ) - Math.abs(b.z - playerZ));
      const window = 26;
      for (let i = 0; i < this.pool.length; i++) {
        const P = this.pool[i];
        const L = near[i];
        if (!L) { P.intensity = 0; continue; }
        const w = Math.max(0, 1 - Math.pow(Math.abs(L.z - playerZ) / window, 2));
        P.position.set(L.x * 0.8, L.y - 0.4, L.z);
        P.intensity = 10 * w * Math.min(1.6, L.power) * (L.flicker ? (Math.sin(t * 23 + L.index * 7.1) + Math.sin(t * 37.7 + L.index) > 0.6 ? 1 : 0.05) : 1);
      }
    } else {
      for (const P of this.pool) P.intensity = 0;
    }

    // police strobe when near the checkpoint
    if (this.policePos.length && playerZ > -10) {
      const i = Math.floor(t * 2) % this.policePos.length;
      this.police.position.copy(this.policePos[i]);
      this.police.intensity = Math.sin(t * 14 + i * 2) > 0 ? 18 : 0;
    } else this.police.intensity = 0;

    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 400);
    void cam;
  }

  flash(pos: THREE.Vector3, strength = 30) {
    this.muzzle.position.copy(pos);
    this.muzzle.intensity = strength;
  }
}
