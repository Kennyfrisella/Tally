import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Textures } from '../world/textures';

// Procedurally animated figure. All body parts are merged into ONE rigidly skinned mesh per figure with a texture
// atlas (camouflage on the left half, solid swatches on the right), so a soldier costs a single draw call.

export type Outfit = 'soldier' | 'enemy' | 'civilian';
export type Pose = 'normal' | 'dead' | 'wounded' | 'surrender' | 'arrested';

const BONES = ['body', 'hips', 'chest', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR', 'rifle'] as const;
type BoneName = (typeof BONES)[number];
const PARENT: Record<BoneName, BoneName | null> = {
  body: null, hips: 'body', chest: 'hips', head: 'chest', armL: 'chest', foreL: 'armL', armR: 'chest', foreR: 'armR',
  legL: 'hips', shinL: 'legL', legR: 'hips', shinR: 'legR', rifle: 'chest',
};
const BIND: Record<BoneName, [number, number, number]> = {
  body: [0, 0, 0], hips: [0, 0.95, 0], chest: [0, 0, 0], head: [0, 0.66, 0], armL: [-0.24, 0.5, 0], foreL: [0, -0.3, 0],
  armR: [0.24, 0.5, 0], foreR: [0, -0.3, 0], legL: [-0.1, 0, 0], shinL: [0, -0.45, 0], legR: [0.1, 0, 0], shinR: [0, -0.45, 0],
  rifle: [0.12, 0.42, -0.28],
};

const SWATCH = ['skin', 'helmet', 'vest', 'boot', 'rifle', 'mag', 'hair', 'jeans', 'black', 'wood', 'vestE'] as const;
type Swatch = (typeof SWATCH)[number] | 'cloth';
const SWATCH_COLORS: Record<(typeof SWATCH)[number], string> = {
  skin: '#c89878', helmet: '#434a35', vest: '#48503a', boot: '#1a1714', rifle: '#23251f', mag: '#8a8f86',
  hair: '#2e2218', jeans: '#2f3d58', black: '#151515', wood: '#5a3a22', vestE: '#222224',
};

interface Part { geo: THREE.BufferGeometry; bone: BoneName; swatch: Swatch; at?: [number, number, number]; scale?: [number, number, number] }

function parts(outfit: Outfit): Part[] {
  const P: Part[] = [];
  const uni: Swatch = 'cloth';
  const pants: Swatch = outfit === 'civilian' ? 'jeans' : 'cloth';
  P.push({ geo: new THREE.CapsuleGeometry(0.17, 0.3, 4, 10).scale(1.25, 1, 0.8), bone: 'chest', swatch: uni, at: [0, 0.27, 0] });
  if (outfit !== 'civilian') {
    const v: Swatch = outfit === 'soldier' ? 'vest' : 'vestE';
    P.push({ geo: new THREE.BoxGeometry(0.44, 0.38, 0.32), bone: 'chest', swatch: v, at: [0, 0.3, 0] });
    P.push({ geo: new THREE.BoxGeometry(0.34, 0.42, 0.18), bone: 'chest', swatch: v, at: [0, 0.32, 0.22] });
  }
  P.push({ geo: new THREE.SphereGeometry(0.105, 14, 10).scale(0.92, 1.08, 1), bone: 'head', swatch: outfit === 'enemy' ? 'black' : 'skin' });
  if (outfit === 'soldier') P.push({ geo: new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.95, 1.08), bone: 'head', swatch: 'helmet', at: [0, 0.02, 0.005] });
  if (outfit === 'civilian') P.push({ geo: new THREE.SphereGeometry(0.115, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), bone: 'head', swatch: 'hair', at: [0, 0.025, 0.012] });
  for (const s of ['L', 'R'] as const) {
    P.push({ geo: new THREE.CapsuleGeometry(0.06, 0.22, 3, 8).translate(0, -0.15, 0), bone: `arm${s}`, swatch: uni });
    P.push({ geo: new THREE.CapsuleGeometry(0.052, 0.22, 3, 8).translate(0, -0.14, 0), bone: `fore${s}`, swatch: uni });
    P.push({ geo: new THREE.SphereGeometry(0.045, 8, 6), bone: `fore${s}`, swatch: outfit === 'enemy' ? 'black' : 'skin', at: [0, -0.3, 0] });
    P.push({ geo: new THREE.CapsuleGeometry(0.085, 0.3, 3, 8).translate(0, -0.22, 0), bone: `leg${s}`, swatch: pants });
    P.push({ geo: new THREE.CapsuleGeometry(0.068, 0.32, 3, 8).translate(0, -0.22, 0), bone: `shin${s}`, swatch: pants });
    P.push({ geo: new THREE.BoxGeometry(0.11, 0.1, 0.27).translate(0, -0.45, -0.05), bone: `shin${s}`, swatch: 'boot' });
  }
  if (outfit !== 'civilian') {
    const stock: Swatch = outfit === 'soldier' ? 'rifle' : 'wood';
    P.push({ geo: new THREE.BoxGeometry(0.05, 0.11, 0.62), bone: 'rifle', swatch: 'rifle', at: [0, 0, -0.1] });
    P.push({ geo: new THREE.BoxGeometry(0.04, 0.1, 0.24), bone: 'rifle', swatch: stock, at: [0, -0.01, 0.3] });
    P.push({ geo: new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6).rotateX(Math.PI / 2), bone: 'rifle', swatch: 'rifle', at: [0, 0.02, -0.55] });
    P.push({ geo: new THREE.BoxGeometry(0.035, 0.2, 0.07).rotateX(0.25), bone: 'rifle', swatch: outfit === 'soldier' ? 'mag' : stock, at: [0, -0.12, -0.18] });
  }
  return P;
}

function swatchUV(s: Swatch): [number, number] {
  const i = SWATCH.indexOf(s as (typeof SWATCH)[number]);
  return [0.5 + ((i % 4) + 0.5) * 0.125, 1 - (Math.floor(i / 4) + 0.5) * 0.25];
}

/** Merged, skinned geometry in bind pose. Cached per outfit. */
const geoCache = new Map<Outfit, THREE.BufferGeometry>();
function skinnedGeometry(outfit: Outfit): THREE.BufferGeometry {
  const hit = geoCache.get(outfit);
  if (hit) return hit;
  // bind-pose world matrices of the bones
  const world: Partial<Record<BoneName, THREE.Matrix4>> = {};
  for (const b of BONES) {
    const local = new THREE.Matrix4().makeTranslation(...BIND[b]);
    const p = PARENT[b];
    world[b] = p ? world[p]!.clone().multiply(local) : local;
  }
  const geos: THREE.BufferGeometry[] = [];
  for (const part of parts(outfit)) {
    let g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    if (part.at) g.translate(...part.at);
    g.applyMatrix4(world[part.bone]!);
    const n = g.attributes.position.count;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      if (part.swatch === 'cloth') uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i));
      else { const [u, v] = swatchUV(part.swatch); uv.setXY(i, u, v); }
    }
    const bi = BONES.indexOf(part.bone);
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, k) => (k % 4 === 0 ? bi : 0)), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, k) => (k % 4 === 0 ? 1 : 0)), 4));
    g = new THREE.BufferGeometry().copy(g);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false)!;
  geoCache.set(outfit, merged);
  return merged;
}

let tex: Textures | null = null;
const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function initHumanoids(t: Textures) { tex = t; }

function atlasMaterial(outfit: Outfit, cloth: number): THREE.MeshStandardMaterial {
  const key = `${outfit}:${cloth}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  // left half: uniform cloth
  if (outfit === 'civilian') {
    g.fillStyle = `#${cloth.toString(16).padStart(6, '0')}`;
    g.fillRect(0, 0, 256, 256);
    g.globalAlpha = 0.12;
    for (let i = 0; i < 1500; i++) { g.fillStyle = Math.random() > 0.5 ? '#000' : '#fff'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    g.globalAlpha = 1;
  } else {
    const src = (outfit === 'soldier' ? tex!.camo : tex!.camoEnemy).image as HTMLCanvasElement;
    g.drawImage(src, 0, 0, 128, 128); g.drawImage(src, 128, 0, 128, 128);
    g.drawImage(src, 0, 128, 128, 128); g.drawImage(src, 128, 128, 128, 128);
  }
  SWATCH.forEach((s, i) => {
    g.fillStyle = SWATCH_COLORS[s];
    g.fillRect(256 + (i % 4) * 64, Math.floor(i / 4) * 64, 64, 64);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.88, metalness: 0.02 });
  matCache.set(key, m);
  return m;
}

export class Humanoid {
  root = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  private b = {} as Record<BoneName, THREE.Bone>;
  muzzle = new THREE.Object3D();
  private phase = Math.random() * 10;
  private crouchT = 0;
  private aimT = 0;
  private fallT = 0;
  private pose: Pose = 'normal';
  private recoil = 0;
  private hasRifle: boolean;

  constructor(readonly outfit: Outfit, civColor = 0x7a2e2e) {
    for (const name of BONES) {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.set(...BIND[name]);
      this.b[name] = bone;
      const p = PARENT[name];
      if (p) this.b[p].add(bone);
    }
    this.mesh = new THREE.SkinnedMesh(skinnedGeometry(outfit), atlasMaterial(outfit, civColor));
    this.mesh.add(this.b.body);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.root.add(this.mesh);
    this.root.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(BONES.map((n) => this.b[n])));
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
    this.hasRifle = outfit !== 'civilian';
    this.muzzle.position.set(0, 0.02, -0.72);
    this.b.rifle.add(this.muzzle);
  }

  get rifle() { return this.hasRifle ? this.b.rifle : null; }

  setPose(p: Pose) {
    if (p === this.pose) return;
    this.pose = p;
    if (p === 'dead' || p === 'wounded') this.fallT = 0;
    // rifles are dropped (bone collapsed) when not carried
    this.b.rifle.scale.setScalar(p === 'normal' && this.hasRifle ? 1 : 0.0001);
  }

  kick() { this.recoil = 1; }

  /** +x rotation swings a limb forward (towards -Z, the facing direction). */
  animate(dt: number, speed: number, crouch: boolean, aiming: boolean) {
    const B = this.b;
    const k = Math.min(1, dt * 8);
    this.crouchT += ((crouch ? 1 : 0) - this.crouchT) * k;
    this.aimT += ((aiming ? 1 : 0) - this.aimT) * k;
    this.recoil = Math.max(0, this.recoil - dt * 10);

    if (this.pose === 'dead' || this.pose === 'wounded') {
      this.fallT = Math.min(1, this.fallT + dt * 2.2);
      const f = this.fallT * this.fallT;
      B.body.rotation.x = (this.pose === 'wounded' ? -1 : 1) * f * Math.PI / 2 * 0.98;
      B.body.position.y = f * 0.12;
      B.hips.position.y = 0.95 - f * 0.15;
      B.chest.rotation.x = 0;
      B.legL.rotation.x = f * 0.2; B.legR.rotation.x = -f * 0.15;
      B.shinL.rotation.x = -f * 0.3; B.shinR.rotation.x = -f * 0.1;
      const twitch = this.pose === 'wounded' ? Math.sin(performance.now() * 0.003) * 0.3 : 0;
      B.armL.rotation.set(f * 0.4 + twitch, 0, -f * 0.6);
      B.armR.rotation.set(-f * 0.3, 0, f * 0.9);
      B.foreL.rotation.x = 0.5 * f; B.foreR.rotation.x = 0.2 * f;
      return;
    }
    B.body.rotation.x = 0;
    B.body.position.y = 0;

    const moving = speed > 0.2;
    this.phase += dt * (moving ? 2.2 + speed * 1.6 : 0);
    const amp = moving ? Math.min(0.75, 0.25 + speed * 0.12) : 0;
    const sw = Math.sin(this.phase);
    const c = this.crouchT;

    B.hips.position.y = 0.95 - c * 0.38 + (moving ? Math.abs(Math.cos(this.phase)) * 0.04 : 0);
    B.chest.rotation.x = -c * 0.25 - (moving ? Math.min(0.2, speed * 0.04) : 0);
    B.legL.rotation.x = sw * amp + c * 1.1;
    B.legR.rotation.x = -sw * amp + c * 0.6;
    B.shinL.rotation.x = -Math.max(0, -sw) * amp * 1.3 - c * 1.9;
    B.shinR.rotation.x = -Math.max(0, sw) * amp * 1.3 - c * 1.3;

    if (this.pose === 'surrender' || this.pose === 'arrested') {
      const up = this.pose === 'surrender';
      B.armL.rotation.set(up ? 2.9 : -0.4, 0, up ? 0.25 : -0.3);
      B.armR.rotation.set(up ? 2.9 : -0.4, 0, up ? -0.25 : 0.3);
      B.foreL.rotation.x = up ? 0.3 : 1.3;
      B.foreR.rotation.x = up ? 0.3 : 1.3;
      B.chest.rotation.x = up ? 0.05 : 0.2;
      return;
    }

    if (this.hasRifle) {
      const a = this.aimT;
      // low ready -> shouldered
      B.armR.rotation.set(0.35 + a * 0.9 - this.recoil * 0.05, 0, 0.25 - a * 0.15);
      B.foreR.rotation.x = 1.1 - a * 0.2;
      B.armL.rotation.set(0.7 + a * 0.65, 0, -0.55 + a * 0.15);
      B.foreL.rotation.x = 0.7 + a * 0.25;
      B.rifle.position.set(0.1 - a * 0.02, 0.36 + a * 0.18, -0.32 - a * 0.06 + this.recoil * 0.05);
      B.rifle.rotation.set(-0.35 * (1 - a) + this.recoil * 0.12, 0.12 * (1 - a), 0.5 * (1 - a));
      B.head.rotation.x = a * 0.12;
    } else {
      B.armL.rotation.set(-sw * amp * 0.8, 0, -0.08);
      B.armR.rotation.set(sw * amp * 0.8, 0, 0.08);
      B.foreL.rotation.x = 0.25;
      B.foreR.rotation.x = 0.25;
    }
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }
}
