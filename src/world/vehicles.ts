import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VEHICLES, VEHICLE_DIMS, VehicleSpec } from './layout';
import { textTexture } from './textures';

// Low-poly but well-proportioned vehicles. Each vehicle merges its parts per material (3–4 draw calls).

const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1418, roughness: 0.08, metalness: 0.9 });
const rubberMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6, metalness: 0.3 });
const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.05, 0.03), toneMapped: false });
const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.9, 1.6), toneMapped: false });

function box(w: number, h: number, l: number, x: number, y: number, z: number, bevel = 0): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (bevel > 0) {
    const s = new THREE.Shape();
    const r = Math.min(bevel, h / 2 - 0.01, l / 2 - 0.01);
    s.moveTo(-l / 2 + r, 0); s.lineTo(l / 2 - r, 0); s.quadraticCurveTo(l / 2, 0, l / 2, r);
    s.lineTo(l / 2, h - r); s.quadraticCurveTo(l / 2, h, l / 2 - r, h); s.lineTo(-l / 2 + r, h);
    s.quadraticCurveTo(-l / 2, h, -l / 2, h - r); s.lineTo(-l / 2, r); s.quadraticCurveTo(-l / 2, 0, -l / 2 + r, 0);
    g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false, curveSegments: 3 });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);
    g.translate(x, y, z);
  } else {
    g = new THREE.BoxGeometry(w, h, l);
    g.translate(x, y + h / 2, z);
  }
  return g.index ? g.toNonIndexed() : g;
}

function wheel(r: number, w: number, x: number, z: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2);
  g.translate(x, r, z);
  return g.index ? g.toNonIndexed() : g;
}

function cabinTaper(w: number, h: number, l: number, y: number, z: number, taperF: number, taperB: number): THREE.BufferGeometry {
  // trapezoid prism (windscreen rake) along the length axis (z), nose at -z
  const s = new THREE.Shape();
  s.moveTo(-l / 2, 0); s.lineTo(l / 2, 0); s.lineTo(l / 2 - taperB, h); s.lineTo(-l / 2 + taperF, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  g.translate(0, y, z);
  return g.index ? g.toNonIndexed() : g;
}

interface Parts { paint: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[]; rubber: THREE.BufferGeometry[]; trim: THREE.BufferGeometry[]; tail: THREE.BufferGeometry[]; head: THREE.BufferGeometry[] }

function emptyParts(): Parts { return { paint: [], glass: [], rubber: [], trim: [], tail: [], head: [] }; }

function car(p: Parts, w: number, l: number, h: number, wheelR = 0.33) {
  p.paint.push(box(w, 0.62, l, 0, 0.28, 0, 0.25));
  p.glass.push(cabinTaper(w * 0.9, h - 0.9, l * 0.5, 0.88, l * 0.04, 0.55, 0.45));
  p.paint.push(box(w * 0.86, 0.06, l * 0.42, 0, h - 0.04, l * 0.04));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.rubber.push(wheel(wheelR, 0.24, sx * (w / 2 - 0.12), sz * l * 0.33));
  p.trim.push(box(w * 1.01, 0.18, 0.12, 0, 0.3, -l / 2));
  p.trim.push(box(w * 1.01, 0.18, 0.12, 0, 0.3, l / 2));
  for (const sx of [-1, 1]) {
    p.tail.push(box(0.35, 0.12, 0.04, sx * (w / 2 - 0.3), 0.72, l / 2 + 0.02));
    p.head.push(box(0.3, 0.1, 0.04, sx * (w / 2 - 0.3), 0.66, -l / 2 - 0.02));
  }
}

function build(spec: VehicleSpec): THREE.Group {
  const d = VEHICLE_DIMS[spec.kind];
  const p = emptyParts();
  let paintColor = spec.color ?? 0xdedede;
  let roughness = 0.35, metalness = 0.6;
  const extras: THREE.Object3D[] = [];
  switch (spec.kind) {
    case 'car':
      car(p, d.w, d.l, d.h);
      break;
    case 'police': {
      car(p, d.w, d.l, d.h);
      paintColor = 0xf2f2f0;
      // fluorescent side band + light bar
      p.trim.push(box(d.w * 1.005, 0.16, d.l * 0.92, 0, 0.55, 0));
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.28), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.6, 4), toneMapped: false }));
      bar.position.set(0, d.h + 0.08, 0.1);
      bar.name = 'lightbar';
      extras.push(bar);
      const pol = textTexture(['POLIZEI'], { w: 512, h: 96, fg: '#1a3fa0' });
      for (const sx of [-1, 1]) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.34), new THREE.MeshStandardMaterial({ map: pol, transparent: true }));
        t.position.set(sx * (d.w / 2 + 0.01), 0.72, 0.2);
        t.rotation.y = sx * Math.PI / 2;
        extras.push(t);
      }
      break;
    }
    case 'van':
      paintColor = spec.color ?? 0xe9e7e2;
      p.paint.push(box(d.w, d.h - 0.35, d.l * 0.78, 0, 0.35, d.l * 0.11, 0.15));
      p.paint.push(box(d.w, 1.0, d.l * 0.24, 0, 0.35, -d.l * 0.38, 0.3));
      p.glass.push(cabinTaper(d.w * 0.98, 0.75, d.l * 0.22, 1.35, -d.l * 0.32, 0.5, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.rubber.push(wheel(0.36, 0.26, sx * (d.w / 2 - 0.14), sz * d.l * 0.34));
      for (const sx of [-1, 1]) p.tail.push(box(0.2, 0.3, 0.04, sx * (d.w / 2 - 0.15), 0.8, d.l / 2 + 0.02));
      break;
    case 'truck': {
      paintColor = 0xb8322a;
      roughness = 0.5;
      const cabL = 2.4;
      p.paint.push(box(d.w, 2.6, cabL, 0, 0.55, -d.l / 2 + cabL / 2, 0.2));
      p.glass.push(box(d.w * 0.92, 0.9, 0.05, 0, 1.95, -d.l / 2 - 0.01));
      p.trim.push(box(d.w * 0.7, 0.25, d.l - cabL - 0.2, 0, 0.7, cabL / 2));
      // trailer box
      const trailer = box(d.w, d.h - 1.15, d.l - cabL - 0.4, 0, 1.1, cabL / 2 + 0.2);
      const trailerMat = new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.6, metalness: 0.2 });
      extras.push(new THREE.Mesh(trailer, trailerMat));
      for (const sx of [-1, 1]) {
        for (const z of [-d.l / 2 + 1.4, d.l / 2 - 3.4, d.l / 2 - 2.2, d.l / 2 - 1.0]) p.rubber.push(wheel(0.5, 0.4, sx * (d.w / 2 - 0.2), z));
        p.tail.push(box(0.3, 0.15, 0.04, sx * (d.w / 2 - 0.25), 0.9, d.l / 2 + 0.02));
      }
      const logo = textTexture(['GALLIKER · TRANSPORT'], { w: 1024, h: 128, fg: '#b8322a' });
      for (const sx of [-1, 1]) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.9), new THREE.MeshStandardMaterial({ map: logo, transparent: true }));
        t.position.set(sx * (d.w / 2 + 0.01), 2.6, 1.6);
        t.rotation.y = sx * Math.PI / 2;
        extras.push(t);
      }
      break;
    }
    case 'duro': {
      // Swiss Army Bucher DURO 6x6 with tarp
      paintColor = 0x4b5235;
      roughness = 0.8; metalness = 0.15;
      p.paint.push(box(d.w, 1.6, 2.0, 0, 0.75, -d.l / 2 + 1.0, 0.15));
      p.glass.push(box(d.w * 0.9, 0.6, 0.05, 0, 1.6, -d.l / 2 - 0.01));
      p.trim.push(box(d.w * 0.9, 0.3, d.l - 0.3, 0, 0.6, 0.1));
      p.paint.push(box(d.w, 0.5, d.l - 2.3, 0, 0.9, 1.1));
      for (const sx of [-1, 1]) for (const z of [-d.l / 2 + 1.1, d.l / 2 - 2.2, d.l / 2 - 0.9]) p.rubber.push(wheel(0.55, 0.42, sx * (d.w / 2 - 0.15), z));
      const tarp = new THREE.Mesh(box(d.w * 0.98, 1.5, d.l - 2.4, 0, 1.4, 1.15, 0.35), new THREE.MeshStandardMaterial({ color: 0x5a5e42, roughness: 1 }));
      extras.push(tarp);
      break;
    }
    case 'puch': {
      // Puch G
      paintColor = 0x4b5235;
      roughness = 0.75; metalness = 0.2;
      p.paint.push(box(d.w, 1.0, d.l, 0, 0.4, 0));
      p.paint.push(box(d.w * 0.96, 0.75, d.l * 0.55, 0, 1.4, d.l * 0.12));
      p.glass.push(box(d.w * 0.86, 0.55, 0.04, 0, 1.5, -d.l * 0.155));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.rubber.push(wheel(0.38, 0.28, sx * (d.w / 2 - 0.1), sz * d.l * 0.32));
      p.rubber.push(wheel(0.36, 0.25, 0, d.l / 2 + 0.12).rotateY(Math.PI / 2));
      break;
    }
  }
  const g = new THREE.Group();
  const paintMat = new THREE.MeshStandardMaterial({ color: paintColor, roughness, metalness });
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos.map((x) => { x.deleteAttribute('uv'); return x; }), false);
    if (!merged) return;
    merged.computeVertexNormals();
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  add(p.paint, paintMat);
  add(p.glass, glassMat);
  add(p.rubber, rubberMat);
  add(p.trim, spec.kind === 'police' ? new THREE.MeshStandardMaterial({ color: 0xd8e000, roughness: 0.5 }) : trimMat);
  add(p.tail, tailMat);
  add(p.head, headMat);
  for (const e of extras) { e.castShadow = true; g.add(e); }
  g.position.set(spec.x, 0, spec.z);
  g.rotation.y = spec.rot; // same convention as NavGrid.fillOBB
  return g;
}

export interface VehicleBuild { group: THREE.Group; update(t: number): void; policeLights: THREE.Vector3[] }

export function buildVehicles(): VehicleBuild {
  const group = new THREE.Group();
  group.name = 'vehicles';
  const bars: THREE.Mesh[] = [];
  const policeLights: THREE.Vector3[] = [];
  for (const v of VEHICLES) {
    const g = build(v);
    group.add(g);
    const bar = g.getObjectByName('lightbar') as THREE.Mesh | undefined;
    if (bar) { bars.push(bar); policeLights.push(new THREE.Vector3(v.x, 1.8, v.z)); }
  }
  const update = (t: number) => {
    bars.forEach((b, i) => {
      const on = Math.sin(t * 14 + i * 2) > 0;
      (b.material as THREE.MeshBasicMaterial).color.setRGB(on ? 0.3 : 0.02, on ? 0.6 : 0.03, on ? 5 : 0.2);
    });
  };
  return { group, update, policeLights };
}
