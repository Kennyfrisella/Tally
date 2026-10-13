import * as THREE from 'three';
import { fbm2 } from './textures';
import type { Textures } from './textures';
import { FACADE, PLAZA } from './layout';

/** Height of the Göschenen valley (metres). Flat floor around the plaza, steep walls, mountain mass to the south. */
export function terrainHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  // Valley widens and drops gently to the north
  const floorHalf = 64 + Math.max(0, z - 250) * 0.15;
  const floor = z > 260 ? -(z - 260) * 0.05 : 0;
  const d = ax - floorHalf;
  const ridge = 1 - Math.abs(fbm2(x * 0.004, z * 0.004, 5, 3) * 2 - 1);
  let wall = 0;
  if (d > 0) {
    wall = d * 0.95 + Math.pow(d, 1.18) * 0.12 + ridge * Math.min(1, d / 120) * 160;
    wall += (fbm2(x * 0.02, z * 0.02, 4, 7) - 0.5) * Math.min(1, d / 30) * 18;
  }
  // The massif above the tunnel
  let mass = 0;
  if (z < 2) {
    const t = -z + 2;
    mass = Math.min(t * 3.2, 30 + t * 1.6) + ridge * Math.min(1, t / 60) * 140 + (fbm2(x * 0.03, z * 0.03, 3, 9) - 0.5) * 10;
  }
  return Math.max(floor, wall, mass + floor * 0);
}

export function buildTerrain(tex: Textures, quality: { drawDistance: number }): THREE.Mesh {
  const size = 2400;
  const seg = 300;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 150);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = terrainHeight(x, z);
    if (Math.abs(x) < PLAZA.x1 + 3 && z > -1 && z < PLAZA.z1 + 10) y -= 0.08; // tucked under the plaza slab
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const grass = new THREE.Color(0x4f5a34), dryGrass = new THREE.Color(0x7a7448), rock = new THREE.Color(0x6d6b66);
  const darkRock = new THREE.Color(0x4a4845), snow = new THREE.Color(0xf2f4f8);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nrm.getY(i);
    const n = fbm2(x * 0.05, z * 0.05, 3, 13);
    c.copy(grass).lerp(dryGrass, n * 0.8);
    const rockAmt = THREE.MathUtils.smoothstep(slope, 0.18, 0.35);
    c.lerp(n > 0.5 ? rock : darkRock, rockAmt);
    const snowLine = 230 + (n - 0.5) * 120;
    const snowAmt = THREE.MathUtils.smoothstep(y, snowLine, snowLine + 60) * (1 - THREE.MathUtils.smoothstep(slope, 0.45, 0.65));
    c.lerp(snow, snowAmt);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Cut the hole where the portal block sits (the facade and plaza cover it)
  const idx = geo.index!;
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), cc = idx.getX(t + 2);
    // drop whole grid cells that lie inside the facade footprint (or under the plaza in front of it)
    const vs = [a, b, cc];
    const inside = vs.every((v) => Math.abs(pos.getX(v)) <= FACADE.x1 + 0.01 && pos.getZ(v) >= -FACADE.depth - 1.01 && pos.getZ(v) <= 14.01);
    if (inside) continue;
    keep.push(a, b, cc);
  }
  geo.setIndex(keep);

  const map = tex.rock.map.clone();
  map.repeat.set(size / 9, size / 9);
  map.needsUpdate = true;
  const normalMap = tex.rock.normalMap.clone();
  normalMap.repeat.copy(map.repeat);
  normalMap.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map, normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  // the facade, rock cap and tunnel shell cast the shadows that matter; skipping 180k terrain triangles in the
  // shadow pass is a big win on integrated GPUs
  mesh.castShadow = false;
  mesh.name = 'terrain';
  void quality;
  return mesh;
}

/** Instanced conifers on the lower valley slopes. */
export function buildForest(count: number): THREE.Group {
  const g = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3, 5);
  trunkGeo.translate(0, 1.5, 0);
  const crownGeo = new THREE.ConeGeometry(2.4, 9, 7);
  crownGeo.translate(0, 7, 0);
  const crown2 = new THREE.ConeGeometry(1.7, 5, 7);
  crown2.translate(0, 10.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }), count);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x1f3322, roughness: 0.95 });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
  const crowns2 = new THREE.InstancedMesh(crown2, crownMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let n = 0;
  let tries = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (n < count && tries < count * 30) {
    tries++;
    const x = (rnd() * 2 - 1) * 700;
    const z = -300 + rnd() * 1100;
    if (Math.abs(x) < 70 && z > -20) continue;
    const y = terrainHeight(x, z);
    if (y > 210 + rnd() * 60 || y < 1) continue;
    const slope = Math.abs(terrainHeight(x + 2, z) - y) + Math.abs(terrainHeight(x, z + 2) - y);
    if (slope > 3.2) continue;
    if (fbm2(x * 0.01, z * 0.01, 2, 99) < 0.42) continue; // clustered stands
    const sc = 0.7 + rnd() * 0.7;
    p.set(x, y - 0.3, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
    s.set(sc, sc * (0.85 + rnd() * 0.3), sc);
    m.compose(p, q, s);
    trunks.setMatrixAt(n, m);
    crowns.setMatrixAt(n, m);
    crowns2.setMatrixAt(n, m);
    n++;
  }
  for (const im of [trunks, crowns, crowns2]) {
    im.count = n;
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}
