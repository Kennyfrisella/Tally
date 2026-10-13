import * as THREE from 'three';
import { CROSS_PASSAGES, GALLERY, PASSAGE, TUNNEL, VENT_ROOM, FACADE } from './layout';
import { textTexture } from './textures';
import type { Textures } from './textures';

// The road tunnel, the safety gallery, cross-passages and the ventilation room.
// Lighting inside is baked per vertex (a cheap stand-in for lightmaps) and injected as indirect irradiance,
// so hundreds of lamps cost nothing at runtime.

export interface Lamp { x: number; y: number; z: number; on: boolean; flicker: boolean; power: number; index: number }

export interface TunnelBuild {
  group: THREE.Group;
  lamps: Lamp[];
  galleryLamps: Lamp[];
  update(t: number): void;
  /** Emergency power: damaged lamps stop flickering. */
  stabilize(): void;
  chargeLed: THREE.Mesh;
  chargePos: THREE.Vector3;
}

type P = { x: number; y: number };

const BAKE_SCALE = Math.PI;

let seed = 777;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Adds a per-vertex `bake` attribute to the material's indirect diffuse. */
export function bakedMaterial(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBake;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n#if defined( RE_IndirectDiffuse )\nirradiance += vBake;\n#endif');
  };
  m.customProgramCacheKey = () => 'baked';
  return m;
}

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  bake: number[] = [];
  constructor(private bakeFn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => [number, number, number]) {}

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c = 1) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c, c, c * 0.98);
    const b = this.bakeFn(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx, ny, nz);
    this.bake.push(b[0], b[1], b[2]);
  }

  /** Quad from 4 corners (counter-clockwise seen from the front), flat normal. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, uvScale = 3, col = 1) {
    const uvOf = (p: THREE.Vector3): [number, number] => {
      if (Math.abs(n.y) > 0.7) return [p.x / uvScale, p.z / uvScale];
      if (Math.abs(n.x) > 0.7) return [p.z / uvScale, p.y / uvScale];
      return [p.x / uvScale, p.y / uvScale];
    };
    for (const p of [a, b, c, a, c, d]) {
      const [u, v] = uvOf(p);
      this.vert(p.x, p.y, p.z, n.x, n.y, n.z, u, v, col);
    }
  }

  /** Axis-aligned box seen from inside (faces point inward). Faces listed in `skip` are omitted. */
  innerBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, skip: string[] = [], col = 1) {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    if (!skip.includes('floor')) this.quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y0, z0), V(x0, y0, z0), V(0, 1, 0), 3, col);
    if (!skip.includes('ceil')) this.quad(V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1), V(0, -1, 0), 3, col * 0.8);
    if (!skip.includes('x0')) this.quad(V(x0, y0, z0), V(x0, y1, z0), V(x0, y1, z1), V(x0, y0, z1), V(1, 0, 0), 3, col);
    if (!skip.includes('x1')) this.quad(V(x1, y0, z1), V(x1, y1, z1), V(x1, y1, z0), V(x1, y0, z0), V(-1, 0, 0), 3, col);
    if (!skip.includes('z0')) this.quad(V(x1, y0, z0), V(x1, y1, z0), V(x0, y1, z0), V(x0, y0, z0), V(0, 0, 1), 3, col);
    if (!skip.includes('z1')) this.quad(V(x0, y0, z1), V(x0, y1, z1), V(x1, y1, z1), V(x1, y0, z1), V(0, 0, -1), 3, col);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('bake', new THREE.Float32BufferAttribute(this.bake, 3));
    g.computeBoundingSphere();
    return g;
  }
}

interface Opening { side: 1 | -1; z0: number; z1: number; yTop: number }

/** Sweeps a 2D profile along -Z. Profile normals point inward; edges on the side walls can be cut for openings. */
function sweep(b: Builder, profile: P[], cx: number, zStart: number, zEnd: number, seg: number, openings: Opening[], wallX: number,
  colorFn: (y: number, z: number) => number) {
  const cuts = new Set<number>();
  for (let z = zStart; z > zEnd; z -= seg) cuts.add(+z.toFixed(3));
  cuts.add(zEnd);
  for (const o of openings) { cuts.add(o.z0); cuts.add(o.z1); }
  const zs = [...cuts].filter((z) => z <= zStart && z >= zEnd).sort((a, b) => b - a);
  // arc length for u
  const arc: number[] = [0];
  for (let k = 1; k < profile.length; k++) arc.push(arc[k - 1] + Math.hypot(profile[k].x - profile[k - 1].x, profile[k].y - profile[k - 1].y));
  // inward normals per edge
  const edgeN = profile.slice(0, -1).map((p, k) => {
    const q = profile[k + 1];
    const tx = q.x - p.x, ty = q.y - p.y;
    const l = Math.hypot(tx, ty);
    // profile runs clockwise when seen from +Z (right floor -> up -> left floor), so the inward normal is (-ty, tx)
    return { x: -ty / l, y: tx / l };
  });
  for (let s = 0; s < zs.length - 1; s++) {
    const za = zs[s], zb = zs[s + 1];
    const zm = (za + zb) / 2;
    for (let k = 0; k < profile.length - 1; k++) {
      const p = profile[k], q = profile[k + 1];
      const onWall = Math.abs(Math.abs(p.x) - wallX) < 1e-3 && Math.abs(Math.abs(q.x) - wallX) < 1e-3;
      if (onWall) {
        const side = Math.sign(p.x) as 1 | -1;
        if (openings.some((o) => o.side === side && zm < o.z0 && zm > o.z1 && Math.max(p.y, q.y) <= o.yTop + 1e-3)) continue;
      }
      const n = edgeN[k];
      const verts: Array<[P, number, number]> = [[p, za, arc[k]], [q, za, arc[k + 1]], [q, zb, arc[k + 1]], [p, za, arc[k]], [q, zb, arc[k + 1]], [p, zb, arc[k]]];
      for (const [pp, z, u] of verts) {
        b.vert(cx + pp.x, pp.y, z, n.x, n.y, 0, u / 3, z / 3, colorFn(pp.y, z));
      }
    }
  }
}

export function roadProfile(): P[] {
  const W = TUNNEL.halfWidth, H = TUNNEL.wallHeight, A = TUNNEL.apex;
  return [
    { x: W, y: 0 }, { x: W, y: PASSAGE.height }, { x: W, y: VENT_ROOM.doorHeight }, { x: W, y: H },
    { x: W - 0.2, y: H + 0.5 }, { x: W - 0.6, y: A }, { x: -W + 0.6, y: A }, { x: -W + 0.2, y: H + 0.5 },
    { x: -W, y: H }, { x: -W, y: VENT_ROOM.doorHeight }, { x: -W, y: PASSAGE.height }, { x: -W, y: 0 },
  ];
}

export function galleryProfile(): P[] {
  const W = GALLERY.halfWidth, H = GALLERY.wallHeight, A = GALLERY.apex;
  const pts: P[] = [{ x: W, y: 0 }, { x: W, y: PASSAGE.height }, { x: W, y: H }];
  for (let i = 1; i < 6; i++) {
    const t = (i / 6) * Math.PI;
    pts.push({ x: Math.cos(t) * W, y: H + Math.sin(t) * (A - H) });
  }
  pts.push({ x: -W, y: H }, { x: -W, y: PASSAGE.height }, { x: -W, y: 0 });
  return pts;
}

export function buildTunnel(tex: Textures, quality: { level: string }): TunnelBuild {
  seed = 777;
  const group = new THREE.Group();
  group.name = 'tunnel';

  // ---- Lamps -----------------------------------------------------------------------------------------------
  const lamps: Lamp[] = [];
  for (let z = -10; z > TUNNEL.zEnd + 5; z -= 10) {
    for (const side of [-1, 1]) {
      let on = true, flicker = false;
      const r = rnd();
      if (z < -255) { on = r > 0.45; flicker = on && r < 0.55; }
      if (z < -400) { on = r > 0.7; flicker = on && r < 0.8; }
      if (z < TUNNEL.walkEnd - 10) on = false;
      // entrance adaptation zone is brighter
      const power = z > -60 ? 2.6 : z > -140 ? 1.6 : 1;
      lamps.push({ x: side * (TUNNEL.halfWidth - 0.45), y: TUNNEL.apex - 0.28, z, on, flicker, power, index: lamps.length });
    }
  }
  const galleryLamps: Lamp[] = [];
  for (let z = -6; z > GALLERY.zEnd + 4; z -= 14) {
    const on = !(z < -300 && z > -360 && rnd() < 0.5);
    galleryLamps.push({ x: GALLERY.x, y: GALLERY.apex - 0.08, z, on, flicker: false, power: 0.7, index: galleryLamps.length });
  }
  const passageLights = CROSS_PASSAGES.map((z) => ({ x: (TUNNEL.halfWidth + GALLERY.x - GALLERY.halfWidth) / 2, y: PASSAGE.height - 0.1, z }));

  const warm = [1.0, 0.86, 0.66];
  const cool = [0.85, 0.92, 1.0];
  const bakeFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number): [number, number, number] => {
    let r = 0.012, g = 0.012, bl = 0.014;
    const add = (lx: number, ly: number, lz: number, I: number, col: number[], downward: number) => {
      const dx = lx - x, dy = ly - y, dz = lz - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 1600) return;
      const d = Math.sqrt(d2);
      const cos = Math.max(0, (nx * dx + ny * dy + nz * dz) / d);
      const lobe = 1 - downward + downward * Math.max(0, -dy / d);
      const e = (I * (0.25 + 0.75 * cos) * lobe) / (d2 + 2);
      r += e * col[0]; g += e * col[1]; bl += e * col[2];
    };
    const inGallery = x > GALLERY.x - GALLERY.halfWidth - 0.5;
    if (!inGallery) {
      const k0 = Math.floor((-z - 10) / 10) - 4;
      for (let k = Math.max(0, k0); k < k0 + 9; k++) {
        for (let s = 0; s < 2; s++) {
          const L = lamps[k * 2 + s];
          if (L && L.on) add(L.x, L.y, L.z, 14 * L.power, warm, 0.6);
        }
      }
      // daylight spill at the portal
      if (z > -45 && x < TUNNEL.halfWidth + 0.5) {
        const day = 2.2 * Math.exp(z / 11) * (0.45 + 0.55 * Math.max(0, nz + ny * 0.5 + 0.3));
        r += day * 0.9; g += day * 0.95; bl += day;
      }
    } else {
      for (const L of galleryLamps) if (L.on && Math.abs(L.z - z) < 30) add(L.x, L.y, L.z, 5 * L.power, cool, 0.4);
      if (z > -30) { const day = 1.4 * Math.exp(z / 8); r += day; g += day; bl += day; }
    }
    for (const P of passageLights) if (Math.abs(P.z - z) < 12 && x > 3) add(P.x, P.y, P.z, 4, [0.75, 1.0, 0.82], 0.3);
    if (x < -4 && z < VENT_ROOM.z1 + 2 && z > VENT_ROOM.z0 - 2) add(-9.5, VENT_ROOM.height - 0.2, -480, 6, [0.9, 0.35, 0.3], 0.3);
    return [r * BAKE_SCALE, g * BAKE_SCALE, bl * BAKE_SCALE];
  };

  // ---- Road tunnel shell -----------------------------------------------------------------------------------
  const shellB = new Builder(bakeFn);
  const openings: Opening[] = [
    ...CROSS_PASSAGES.map((c) => ({ side: 1 as const, z0: c + PASSAGE.halfWidth, z1: c - PASSAGE.halfWidth, yTop: PASSAGE.height })),
    { side: -1, z0: VENT_ROOM.door1, z1: VENT_ROOM.door0, yTop: VENT_ROOM.doorHeight },
  ];
  sweep(shellB, roadProfile(), 0, -FACADE.depth, TUNNEL.zEnd, 2, openings, TUNNEL.halfWidth, (y, z) => {
    // painted lower wall, sooty ceiling, a bit of grime variation along the bore
    const grime = 0.85 + 0.15 * Math.sin(z * 0.37) * Math.sin(z * 0.11);
    return y < 3.2 ? 0.98 * grime : y < TUNNEL.wallHeight + 0.1 ? 0.7 * grime : 0.42 * grime;
  });
  // end wall
  shellB.quad(new THREE.Vector3(-5, 0, TUNNEL.zEnd), new THREE.Vector3(5, 0, TUNNEL.zEnd), new THREE.Vector3(5, TUNNEL.apex, TUNNEL.zEnd), new THREE.Vector3(-5, TUNNEL.apex, TUNNEL.zEnd), new THREE.Vector3(0, 0, 1));

  // cross passages (door frames on the road tunnel side) and the ventilation room
  for (const c of CROSS_PASSAGES) {
    shellB.innerBox(TUNNEL.halfWidth, GALLERY.x - GALLERY.halfWidth, 0, PASSAGE.height, c - PASSAGE.halfWidth, c + PASSAGE.halfWidth, ['x0', 'x1'], 0.9);
  }
  shellB.innerBox(VENT_ROOM.x0, VENT_ROOM.x1, 0, VENT_ROOM.height, VENT_ROOM.z0, VENT_ROOM.z1, ['x1'], 0.85);
  const concrete = (repeat = 1) => {
    const map = tex.concrete.map.clone(); map.repeat.set(repeat, repeat); map.needsUpdate = true;
    const nm = tex.concrete.normalMap.clone(); nm.repeat.set(repeat, repeat); nm.needsUpdate = true;
    return { map, normalMap: nm };
  };
  const shellMat = bakedMaterial({ ...concrete(1), vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.7, 0.7) });
  const shell = new THREE.Mesh(shellB.geometry(), shellMat);
  shell.receiveShadow = true;
  shell.castShadow = true;
  group.add(shell);

  // ---- Road surface + walkways -----------------------------------------------------------------------------
  {
    const roadB = new Builder(bakeFn);
    const walkB = new Builder(bakeFn);
    const R = TUNNEL.roadHalf, W = TUNNEL.halfWidth, curb = 0.15;
    for (let z = -FACADE.depth + 0.0001; z > TUNNEL.zEnd; z -= 2) {
      const za = Math.min(z, -FACADE.depth), zb = Math.max(z - 2, TUNNEL.zEnd);
      for (let x = -R; x < R - 1e-6; x += R / 2) {
        roadB.quad(new THREE.Vector3(x, 0, za), new THREE.Vector3(x + R / 2, 0, za), new THREE.Vector3(x + R / 2, 0, zb), new THREE.Vector3(x, 0, zb), new THREE.Vector3(0, 1, 0), 4);
      }
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? -W : R, x1 = s < 0 ? -R : W;
        walkB.quad(new THREE.Vector3(x0, curb, za), new THREE.Vector3(x1, curb, za), new THREE.Vector3(x1, curb, zb), new THREE.Vector3(x0, curb, zb), new THREE.Vector3(0, 1, 0), 2, 0.8);
        const cx = s < 0 ? -R : R;
        walkB.quad(new THREE.Vector3(cx, 0, za), new THREE.Vector3(cx, 0, zb), new THREE.Vector3(cx, curb, zb), new THREE.Vector3(cx, curb, za), new THREE.Vector3(-s, 0, 0), 1, 0.7);
      }
    }
    const a = tex.asphalt;
    const map = a.map.clone(); map.needsUpdate = true;
    const road = new THREE.Mesh(roadB.geometry(), bakedMaterial({ map, normalMap: a.normalMap, roughness: 0.82, metalness: 0, vertexColors: true }));
    road.receiveShadow = true;
    group.add(road);
    const walk = new THREE.Mesh(walkB.geometry(), bakedMaterial({ ...concrete(1), roughness: 0.95, vertexColors: true }));
    walk.receiveShadow = true;
    group.add(walk);
  }

  // ---- Safety gallery --------------------------------------------------------------------------------------
  {
    const gb = new Builder(bakeFn);
    const gOpen: Opening[] = CROSS_PASSAGES.map((c) => ({ side: -1 as const, z0: c + PASSAGE.halfWidth, z1: c - PASSAGE.halfWidth, yTop: PASSAGE.height }));
    sweep(gb, galleryProfile(), GALLERY.x, -FACADE.depth, GALLERY.zEnd, 2, gOpen, GALLERY.halfWidth, (y) => (y < 1.2 ? 0.75 : 0.9));
    for (let z = -FACADE.depth; z > GALLERY.zEnd; z -= 2) {
      const zb = Math.max(z - 2, GALLERY.zEnd);
      gb.quad(new THREE.Vector3(GALLERY.x - GALLERY.halfWidth, 0, z), new THREE.Vector3(GALLERY.x + GALLERY.halfWidth, 0, z), new THREE.Vector3(GALLERY.x + GALLERY.halfWidth, 0, zb), new THREE.Vector3(GALLERY.x - GALLERY.halfWidth, 0, zb), new THREE.Vector3(0, 1, 0), 3, 0.75);
    }
    gb.quad(new THREE.Vector3(GALLERY.x - 2, 0, GALLERY.zEnd), new THREE.Vector3(GALLERY.x + 2, 0, GALLERY.zEnd), new THREE.Vector3(GALLERY.x + 2, GALLERY.apex, GALLERY.zEnd), new THREE.Vector3(GALLERY.x - 2, GALLERY.apex, GALLERY.zEnd), new THREE.Vector3(0, 0, 1));
    const gm = new THREE.Mesh(gb.geometry(), bakedMaterial({ ...concrete(1), vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    gm.receiveShadow = true;
    gm.castShadow = true;
    group.add(gm);
  }

  // ---- Lamp fixtures (instanced, unlit, bloom picks them up) --------------------------------------------------
  const lampGeo = new THREE.BoxGeometry(0.35, 0.08, 1.6);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length + galleryLamps.length);
  const m4 = new THREE.Matrix4();
  const onCol = new THREE.Color(2.4, 2.0, 1.45);
  const portalCol = new THREE.Color(3.2, 3.0, 2.6);
  const offCol = new THREE.Color(0.06, 0.06, 0.06);
  const galCol = new THREE.Color(1.6, 1.8, 2.0);
  lamps.forEach((L, i) => {
    m4.makeTranslation(L.x, L.y, L.z);
    lampMesh.setMatrixAt(i, m4);
    lampMesh.setColorAt(i, L.on ? (L.power > 1.5 ? portalCol : onCol) : offCol);
  });
  galleryLamps.forEach((L, i) => {
    m4.compose(new THREE.Vector3(L.x, L.y, L.z), new THREE.Quaternion(), new THREE.Vector3(0.6, 1, 0.5));
    lampMesh.setMatrixAt(lamps.length + i, m4);
    lampMesh.setColorAt(lamps.length + i, L.on ? galCol : offCol);
  });
  lampMesh.instanceMatrix.needsUpdate = true;
  lampMesh.instanceColor!.needsUpdate = true;
  group.add(lampMesh);

  // ---- Road markings ----------------------------------------------------------------------------------------
  {
    const markMat = new THREE.MeshStandardMaterial({ color: 0xe8e6dc, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const dashGeo = new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2);
    const n = Math.floor((TUNNEL.walkEnd + FACADE.depth) / -9);
    const dashes = new THREE.InstancedMesh(dashGeo, markMat, n);
    for (let i = 0; i < n; i++) { m4.makeTranslation(0, 0.012, -FACADE.depth - 3 - i * 9); dashes.setMatrixAt(i, m4); }
    dashes.receiveShadow = true;
    group.add(dashes);
    const len = -TUNNEL.walkEnd - FACADE.depth;
    for (const s of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.15, len).rotateX(-Math.PI / 2), markMat);
      edge.position.set(s * (TUNNEL.roadHalf - 0.25), 0.012, -FACADE.depth - len / 2);
      group.add(edge);
    }
  }

  // ---- Wall furniture: cable trays, SOS niches, exit signs, emergency guide lights ---------------------------
  {
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.6 });
    for (const s of [-1, 1]) {
      const len = -TUNNEL.zEnd - FACADE.depth;
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, len), trayMat);
      tray.position.set(s * (TUNNEL.halfWidth - 0.14), 3.55, -FACADE.depth - len / 2);
      group.add(tray);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: s < 0 ? 0x8a2a20 : 0x6b6e70, roughness: 0.5, metalness: 0.4 }));
      pipe.position.set(s * (TUNNEL.halfWidth - 0.12), 3.25, -FACADE.depth - len / 2);
      group.add(pipe);
    }
    // guide lights (Leiteinrichtung) at 1 m height every 25 m on both walls
    const guide = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 60);
    let gi = 0;
    for (let z = -20; z > TUNNEL.walkEnd && gi < 60; z -= 25) {
      for (const s of [-1, 1]) {
        if (gi >= 60) break;
        m4.makeTranslation(s * (TUNNEL.halfWidth - 0.03), 1.0, z);
        guide.setMatrixAt(gi, m4);
        guide.setColorAt(gi, s > 0 ? new THREE.Color(0.2, 2.2, 0.6) : new THREE.Color(2.4, 1.2, 0.2));
        gi++;
      }
    }
    guide.count = gi;
    guide.instanceColor!.needsUpdate = true;
    group.add(guide);

    // exit signs above every cross passage + distance signs in between
    for (let i = 0; i < CROSS_PASSAGES.length; i++) {
      const c = CROSS_PASSAGES[i];
      const signTex = textTexture([`➜ NOTAUSGANG ${i + 1}`, 'USCITA DI SICUREZZA'], { w: 512, h: 160, bg: '#0a7a3a', fg: '#ffffff', border: '#ffffff' });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.56), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false, color: 0xbbbbbb }));
      sign.position.set(TUNNEL.halfWidth - 0.04, PASSAGE.height + 0.45, c);
      sign.rotation.y = -Math.PI / 2;
      group.add(sign);
      // door frame
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e7a3e, roughness: 0.5, metalness: 0.3 });
      for (const dz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, PASSAGE.height, 0.14), frameMat);
        post.position.set(TUNNEL.halfWidth - 0.02, PASSAGE.height / 2, c + dz * PASSAGE.halfWidth);
        group.add(post);
      }
      // open steel door folded against the passage wall
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.06), frameMat);
      door.position.set(TUNNEL.halfWidth + 0.75, 1.1, c - PASSAGE.halfWidth + 0.06);
      group.add(door);
      // hydrant cabinet next to the passage
      const hyd = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.8), new THREE.MeshStandardMaterial({ color: 0xb01e1e, roughness: 0.5 }));
      hyd.position.set(TUNNEL.halfWidth - 0.1, 1.2, c + 3.2);
      group.add(hyd);
      // emergency green light in passage
      const gl = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 1.0), toneMapped: false }));
      gl.position.set((TUNNEL.halfWidth + GALLERY.x - GALLERY.halfWidth) / 2, PASSAGE.height - 0.04, c);
      group.add(gl);
      // matching sign on the gallery side
      const gsTex = textTexture([`QUERSCHLAG ${i + 1}`, `Km ${(16.9 - (-c) / 1000).toFixed(2)}`], { w: 512, h: 160, bg: '#e8e8e0', fg: '#1a1a1a' });
      const gs = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.4), new THREE.MeshStandardMaterial({ map: gsTex, roughness: 0.6 }));
      gs.position.set(GALLERY.x + GALLERY.halfWidth - 0.03, 2.0, c);
      gs.rotation.y = -Math.PI / 2;
      group.add(gs);
    }
    // SOS niches on the west wall
    for (let z = -75; z > TUNNEL.walkEnd; z -= 150) {
      const sosTex = textTexture(['SOS', '☎  🧯'], { w: 256, h: 256, bg: '#e85a0c', fg: '#ffffff' });
      const sos = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: sosTex, toneMapped: false, color: 0x999999 }));
      sos.position.set(-TUNNEL.halfWidth + 0.03, 2.4, z);
      sos.rotation.y = Math.PI / 2;
      group.add(sos);
    }
    // ventilation exhaust dampers in the ceiling
    const damper = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.05, 1.4), new THREE.MeshStandardMaterial({ color: 0x202224, roughness: 0.8, metalness: 0.5 }), 8);
    for (let i = 0; i < 8; i++) { m4.makeTranslation(0, TUNNEL.apex - 0.02, -40 - i * 96); damper.setMatrixAt(i, m4); }
    group.add(damper);
    // speed / lane signal gantries
    for (const z of [-30, -200, -380]) {
      const sTex = textTexture(['80'], { w: 256, h: 256, bg: '#111', fg: '#ffffff' });
      const ctx = (sTex.image as HTMLCanvasElement).getContext('2d')!;
      ctx.strokeStyle = '#e02020'; ctx.lineWidth = 22; ctx.beginPath(); ctx.arc(128, 128, 100, 0, Math.PI * 2); ctx.stroke();
      sTex.needsUpdate = true;
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: sTex, toneMapped: false, color: 0x888888 }));
      s.position.set(-2.2, TUNNEL.apex - 0.6, z);
      group.add(s);
      const xTex = textTexture(['✕'], { w: 256, h: 256, bg: '#111', fg: '#ff2a1a' });
      const xs = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: xTex, toneMapped: false }));
      xs.position.set(2.2, TUNNEL.apex - 0.6, z);
      group.add(xs);
    }
  }

  // ---- Ventilation room interior and the sabotage charge -------------------------------------------------------
  const chargeLed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.1), toneMapped: false }));
  {
    const cabMat = new THREE.MeshStandardMaterial({ color: 0xc9c7bf, roughness: 0.45, metalness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, 1.6), cabMat);
      cab.position.set(-12.9, 1.05, -483 + i * 1.8);
      cab.castShadow = true;
      group.add(cab);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ color: i === 2 ? 0x331111 : 0x113322 }));
      panel.position.set(-12.44, 1.5, -483 + i * 1.8);
      panel.rotation.y = Math.PI / 2;
      group.add(panel);
    }
    const fanHousing = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.4, 20).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6e7275, roughness: 0.5, metalness: 0.7 }));
    fanHousing.position.set(-9.5, 2.2, -488.2);
    group.add(fanHousing);
    // the charge: a backpack-sized package with wiring
    const charge = new THREE.Group();
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a2a22, roughness: 0.9 }));
    charge.add(pack);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.32), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.6 }));
    charge.add(tape);
    chargeLed.position.set(0.15, 0.2, 0.16);
    charge.add(chargeLed);
    charge.position.set(-12.2, 0.2, -478.5);
    group.add(charge);
    const roomSign = textTexture(['LÜFTUNGSZENTRALE N', 'Zutritt verboten'], { w: 512, h: 160, bg: '#f2d200', fg: '#111' });
    const rs = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshStandardMaterial({ map: roomSign, roughness: 0.5, emissive: 0x222200 }));
    rs.position.set(-TUNNEL.halfWidth + 0.03, VENT_ROOM.doorHeight + 0.35, (VENT_ROOM.door0 + VENT_ROOM.door1) / 2);
    rs.rotation.y = Math.PI / 2;
    group.add(rs);
  }

  // ---- Barricade at the sector limit -------------------------------------------------------------------------
  {
    const jersey = new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.9 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xd62020, roughness: 0.7 });
    for (const [x, z, r] of [[-2.6, -596, 0], [2.6, -597, 0.05]] as const) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.85, 0.6), jersey);
      b.position.set(x, 0.42, z); b.rotation.y = r; b.castShadow = true;
      group.add(b);
      const s = new THREE.Mesh(new THREE.BoxGeometry(4.82, 0.12, 0.62), stripe);
      s.position.set(x, 0.7, z); s.rotation.y = r;
      group.add(s);
    }
    const limitTex = textTexture(['SEKTORGRENZE', 'Kantonspolizei TI'], { w: 512, h: 160, bg: '#1d3a8a', fg: '#fff' });
    const lim = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshBasicMaterial({ map: limitTex, color: 0x999999 }));
    lim.position.set(0, 1.6, -598);
    group.add(lim);
  }

  // flicker for damaged lamps
  let flickers = lamps.filter((l) => l.flicker);
  let last = 0;
  const tmpC = new THREE.Color();
  const update = (t: number) => {
    if (t - last < 0.06) return;
    last = t;
    for (const L of flickers) {
      const v = Math.sin(t * 23 + L.index * 7.1) + Math.sin(t * 37.7 + L.index);
      tmpC.copy(v > 0.6 ? onCol : offCol);
      lampMesh.setColorAt(L.index, tmpC);
    }
    if (flickers.length) lampMesh.instanceColor!.needsUpdate = true;
    (chargeLed.material as THREE.MeshBasicMaterial).color.setRGB(Math.sin(t * 6) > 0 ? 4 : 0.2, 0.1, 0.05);
  };

  const stabilize = () => {
    for (const L of flickers) { L.flicker = false; lampMesh.setColorAt(L.index, onCol); }
    flickers = [];
    lampMesh.instanceColor!.needsUpdate = true;
  };
  void quality;
  return { group, lamps, galleryLamps, update, stabilize, chargeLed, chargePos: new THREE.Vector3(-12.2, 0.2, -478.5) };
}
