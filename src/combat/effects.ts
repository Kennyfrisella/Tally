import * as THREE from 'three';

// Pooled visual effects: tracers, muzzle flashes, impact sparks/dust, blood puffs and order pings.

interface Tracer { line: THREE.Line; life: number }
interface Particle { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; color: THREE.Color; size: number }
interface Flash { sprite: THREE.Sprite; life: number }
interface Ping { mesh: THREE.Mesh; life: number }

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private particles: Particle[] = [];
  private pings: Ping[] = [];
  private points: THREE.Points;
  private pGeo: THREE.BufferGeometry;
  private readonly maxParticles = 600;

  constructor(scene: THREE.Scene) {
    const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(4, 2.6, 1.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 48; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(g, tracerMat.clone());
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    const flashTex = radialTexture('rgba(255,250,220,1)', 'rgba(255,160,50,0.8)');
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, color: new THREE.Color(3, 2.4, 1.6) }));
      s.visible = false;
      scene.add(s);
      this.flashes.push({ sprite: s, life: 0 });
    }
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.maxParticles * 3), 3));
    this.pGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.maxParticles * 3), 3));
    this.points = new THREE.Points(this.pGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, depthWrite: false, map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.6)'), toneMapped: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    const ringGeo = new THREE.RingGeometry(0.7, 0.9, 32).rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false }));
      m.visible = false;
      scene.add(m);
      this.pings.push({ mesh: m, life: 0 });
    }
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, enemy = false) {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    const pos = t.line.geometry.attributes.position as THREE.BufferAttribute;
    // draw only a streak segment, like a real tracer, not the whole line
    const dir = b.clone().sub(a);
    const len = dir.length();
    const start = a.clone().addScaledVector(dir, Math.min(0.25, 2 / Math.max(len, 0.01)));
    pos.setXYZ(0, start.x, start.y, start.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    t.line.geometry.computeBoundingSphere();
    (t.line.material as THREE.LineBasicMaterial).color.setRGB(enemy ? 4 : 4, enemy ? 1.4 : 2.8, enemy ? 0.6 : 1.4);
    t.line.visible = true;
    t.life = 0.06;
  }

  muzzleFlash(p: THREE.Vector3, scale = 0.5) {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.sprite.position.copy(p);
    f.sprite.scale.setScalar(scale * (0.7 + Math.random() * 0.6));
    f.sprite.material.rotation = Math.random() * Math.PI;
    f.sprite.visible = true;
    f.life = 0.05;
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, kind: 'concrete' | 'metal' | 'blood' = 'concrete') {
    const count = kind === 'blood' ? 10 : 14;
    for (let i = 0; i < count; i++) {
      const v = n.clone().multiplyScalar(1.5 + Math.random() * 2.5).add(new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 2, (Math.random() - 0.5) * 2.5));
      let color: THREE.Color;
      if (kind === 'blood') color = new THREE.Color(0.35, 0.02, 0.02);
      else if (i < 4) color = new THREE.Color(3, 2, 0.8); // sparks
      else color = new THREE.Color(0.55, 0.52, 0.48); // dust
      this.spawn(p, v.multiplyScalar(kind === 'blood' ? 0.6 : 1), 0.25 + Math.random() * 0.4, color);
    }
  }

  private spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, color: THREE.Color) {
    if (this.particles.length >= this.maxParticles) this.particles.shift();
    this.particles.push({ p: p.clone(), v, life, max: life, color, size: 1 });
  }

  ping(x: number, z: number, color: THREE.ColorRepresentation) {
    const pg = this.pings.find((p) => p.life <= 0) ?? this.pings[0];
    pg.mesh.position.set(x, 0.05, z);
    (pg.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    pg.mesh.visible = true;
    pg.life = 1.2;
  }

  update(dt: number) {
    for (const t of this.tracers) {
      if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false; }
    }
    for (const f of this.flashes) {
      if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.sprite.visible = false; }
    }
    for (const p of this.pings) {
      if (p.life > 0) {
        p.life -= dt;
        const k = 1 - p.life / 1.2;
        p.mesh.scale.setScalar(0.6 + k * 2.2);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
    const pos = this.pGeo.attributes.position as THREE.BufferAttribute;
    const col = this.pGeo.attributes.color as THREE.BufferAttribute;
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) { this.particles.splice(i, 1); continue; }
      q.v.y -= 9.8 * dt;
      q.p.addScaledVector(q.v, dt);
      if (q.p.y < 0.01) { q.p.y = 0.01; q.v.multiplyScalar(0.3); }
    }
    for (const q of this.particles) {
      const a = q.life / q.max;
      pos.setXYZ(n, q.p.x, q.p.y, q.p.z);
      col.setXYZ(n, q.color.r * a, q.color.g * a, q.color.b * a);
      n++;
    }
    this.pGeo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
