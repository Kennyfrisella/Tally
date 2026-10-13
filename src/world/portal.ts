import * as THREE from 'three';
import { FACADE, GALLERY, PLAZA, TUNNEL } from './layout';
import { galleryProfile, roadProfile } from './tunnel';
import { swissFlagTexture, textTexture } from './textures';
import type { Textures } from './textures';

export interface PortalBuild {
  group: THREE.Group;
  update(t: number): void;
}

function profileToPath(pts: { x: number; y: number }[], ox: number, scale = 1): THREE.Path {
  const p = new THREE.Path();
  // holes must wind opposite to the outer shape; the profile already runs clockwise
  pts.forEach((q, i) => {
    const x = ox + q.x * scale, y = q.y * (scale > 1 ? (q.y > 0.01 ? 1 + (scale - 1) * 1.4 : 1) : 1);
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
  });
  p.closePath();
  return p;
}

export function buildPortal(tex: Textures): PortalBuild {
  const group = new THREE.Group();
  group.name = 'portal';

  const conc = (rep: number, color = 0xffffff) => {
    const map = tex.concrete.map.clone(); map.repeat.set(rep, rep); map.needsUpdate = true;
    const normalMap = tex.concrete.normalMap.clone(); normalMap.repeat.set(rep, rep); normalMap.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map, normalMap, color, roughness: 0.9 });
  };

  // ---- Facade block with the two openings -------------------------------------------------------------------
  {
    const shape = new THREE.Shape();
    shape.moveTo(FACADE.x0, 0);
    shape.lineTo(FACADE.x1, 0);
    shape.lineTo(FACADE.x1, FACADE.height);
    shape.lineTo(FACADE.x0, FACADE.height);
    shape.closePath();
    shape.holes.push(profileToPath(roadProfile(), 0));
    shape.holes.push(profileToPath(galleryProfile(), GALLERY.x));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: FACADE.depth, bevelEnabled: false });
    geo.translate(0, 0, -FACADE.depth);
    const mesh = new THREE.Mesh(geo, conc(0.22, 0xb9b5aa));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Protruding portal collar around the road tunnel
    const collar = new THREE.Shape();
    const outer = roadProfile().map((p) => ({ x: p.x * 1.22, y: p.y < 0.01 ? 0 : p.y * 1.3 + 0.2 }));
    outer.forEach((p, i) => (i === 0 ? collar.moveTo(p.x, p.y) : collar.lineTo(p.x, p.y)));
    collar.closePath();
    collar.holes.push(profileToPath(roadProfile(), 0));
    const cg = new THREE.ExtrudeGeometry(collar, { depth: 1.2, bevelEnabled: false });
    const cm = new THREE.Mesh(cg, conc(0.3, 0xd2cec4));
    cm.castShadow = true;
    cm.receiveShadow = true;
    group.add(cm);

    // Rock cap above and behind the facade so the mountain closes over the portal
    const cap = new THREE.Mesh(new THREE.BoxGeometry(FACADE.x1 - FACADE.x0 + 6, 26, 14), new THREE.MeshStandardMaterial({ map: tex.rock.map, normalMap: tex.rock.normalMap, color: 0x76736c, roughness: 1 }));
    cap.position.set(0, 31, -FACADE.depth - 4);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    const lettering = textTexture(['GOTTHARD'], { w: 1024, h: 160, fg: '#e9e6dc', font: 'bold 120px "Arial Narrow", Arial, sans-serif' });
    const letters = new THREE.Mesh(new THREE.PlaneGeometry(13, 2), new THREE.MeshStandardMaterial({ map: lettering, transparent: true, roughness: 0.6, metalness: 0.3 }));
    letters.position.set(0, TUNNEL.apex * 1.3 + 2.2, 1.25);
    group.add(letters);
    const galSign = textTexture(['SICHERHEITSSTOLLEN', 'GALLERIA DI SICUREZZA'], { w: 512, h: 128, bg: '#0a7a3a', fg: '#fff' });
    const gs = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: galSign, color: 0xcccccc }));
    gs.position.set(GALLERY.x, GALLERY.apex + 0.8, 0.03);
    group.add(gs);
  }

  // ---- Ground: plaza slab, approach road, portal floors ------------------------------------------------------
  {
    const a = tex.asphalt;
    const mk = (rep: number, color: number, rough: number) => {
      const map = a.map.clone(); map.repeat.set(rep, rep); map.needsUpdate = true;
      const nm = a.normalMap.clone(); nm.repeat.set(rep, rep); nm.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map, normalMap: nm, color, roughness: rough });
    };
    const W = PLAZA.x1 - PLAZA.x0 + 8, D = PLAZA.z1 + 14;
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), mk(W / 6, 0xa8a49a, 0.95));
    plaza.position.set(0, 0, D / 2);
    plaza.receiveShadow = true;
    group.add(plaza);
    const roadLen = PLAZA.z1 + 14 + FACADE.depth;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(TUNNEL.halfWidth * 2, roadLen).rotateX(-Math.PI / 2), mk(roadLen / 5, 0xffffff, 0.8));
    road.position.set(0, 0.01, -FACADE.depth + roadLen / 2);
    road.receiveShadow = true;
    group.add(road);
    const galFloor = new THREE.Mesh(new THREE.PlaneGeometry(GALLERY.halfWidth * 2, FACADE.depth + 0.2).rotateX(-Math.PI / 2), conc(1.5, 0x9a978f));
    galFloor.position.set(GALLERY.x, 0.005, -FACADE.depth / 2);
    group.add(galFloor);
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e6dc, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let z = 2; z < PLAZA.z1; z += 9) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2), lineMat);
      d.position.set(0, 0.02, z + 1.5);
      group.add(d);
    }
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.PlaneGeometry(0.15, roadLen).rotateX(-Math.PI / 2), lineMat);
      e.position.set(s * (TUNNEL.roadHalf - 0.25), 0.02, -FACADE.depth + roadLen / 2);
      group.add(e);
    }
    // stop line and "STOP" in front of the closed tunnel
    const stop = new THREE.Mesh(new THREE.PlaneGeometry(TUNNEL.roadHalf * 2, 0.5).rotateX(-Math.PI / 2), lineMat);
    stop.position.set(0, 0.02, 9);
    group.add(stop);
  }

  // ---- Gantry, traffic lights, operations building, flag ----------------------------------------------------
  const steel = new THREE.MeshStandardMaterial({ color: 0x7c8085, roughness: 0.45, metalness: 0.8 });
  {
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 0.35), steel);
      post.position.set(s * 8.5, 3.5, 14);
      post.castShadow = true;
      group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.5, 0.5), steel);
    beam.position.set(0, 6.8, 14);
    beam.castShadow = true;
    group.add(beam);
    const tunnelSign = textTexture(['⛰  Gotthard', '16,9 km'], { w: 512, h: 256, bg: '#1b4fa0', fg: '#fff', border: '#fff' });
    const ts = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ map: tunnelSign, roughness: 0.4 }));
    ts.position.set(-3.2, 7.9, 14.3);
    ts.castShadow = true;
    group.add(ts);
    const closed = textTexture(['TUNNEL', 'GESPERRT'], { w: 512, h: 256, bg: '#111', fg: '#ffb020' });
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshBasicMaterial({ map: closed, toneMapped: false, color: 0xaaaaaa }));
    cs.position.set(3.2, 7.7, 14.3);
    group.add(cs);

    const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.2, 0.1), toneMapped: false });
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8), steel);
      pole.position.set(s * 4.8, 1.7, 4);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      head.position.set(s * 4.8, 3.6, 4);
      group.add(head);
      const red = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), redMat);
      red.position.set(s * 4.8, 3.85, 4.16);
      group.add(red);
    }

    // Betriebszentrale (operations building)
    const winTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const x = c.getContext('2d')!;
      x.fillStyle = '#c9c4b8'; x.fillRect(0, 0, 256, 128);
      for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) {
        x.fillStyle = (k + r) % 3 === 0 ? '#2b3a44' : '#1c262d';
        x.fillRect(10 + k * 41, 18 + r * 60, 30, 34);
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
      return t;
    })();
    const bld = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 28), new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.7 }));
    bld.position.set(-42, 4, 48);
    bld.castShadow = true;
    bld.receiveShadow = true;
    group.add(bld);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(19, 0.5, 29), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.8 }));
    roof.position.set(-42, 8.25, 48);
    roof.castShadow = true;
    group.add(roof);
    const nameTex = textTexture(['ASTRA · Betriebszentrale Gotthard'], { w: 1024, h: 96, bg: '#ffffff', fg: '#222' });
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(10, 0.95), new THREE.MeshStandardMaterial({ map: nameTex, roughness: 0.5 }));
    nm.position.set(-32.95, 6.8, 48);
    nm.rotation.y = Math.PI / 2;
    group.add(nm);

    // Jersey barriers at the checkpoint + sandbags
    const jersey = new THREE.MeshStandardMaterial({ color: 0xbdb9ae, roughness: 0.9 });
    for (const x of [-1.5, 4.5]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(5, 0.85, 0.6), jersey);
      b.position.set(x, 0.42, 24);
      b.castShadow = true; b.receiveShadow = true;
      group.add(b);
    }
    const bagGeo = new THREE.CapsuleGeometry(0.22, 0.45, 3, 8).rotateZ(Math.PI / 2);
    const bags = new THREE.InstancedMesh(bagGeo, new THREE.MeshStandardMaterial({ color: 0x8a7c5a, roughness: 1 }), 30);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let row = 0; row < 3; row++) for (let k = 0; k < 10; k++) {
      const a = -0.6 + k * 0.13;
      const r = 3.2;
      m.makeRotationY(-a + Math.PI / 2);
      m.setPosition(-9 + Math.cos(a) * r, 0.22 + row * 0.36, 26 + Math.sin(a) * r);
      bags.setMatrixAt(i++, m);
    }
    bags.castShadow = true;
    group.add(bags);

    // Lamp posts along the plaza
    for (let z = 40; z < 220; z += 36) {
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 9, 8), steel);
        p.position.set(s * 11, 4.5, z);
        p.castShadow = true;
        group.add(p);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.3), steel);
        arm.position.set(s * 10, 8.9, z);
        group.add(arm);
      }
    }
  }

  // Swiss flag with a cheap CPU wave
  const flagGeo = new THREE.PlaneGeometry(2.4, 2.4, 12, 6);
  const flagBase = (flagGeo.attributes.position.array as Float32Array).slice();
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ map: swissFlagTexture(), side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(13.3, 10, 30);
  flag.castShadow = true;
  group.add(flag);
  const fpole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 11.5, 8), steel);
  fpole.position.set(12, 5.75, 30);
  group.add(fpole);

  const update = (t: number) => {
    const pos = flagGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = flagBase[i * 3];
      const k = (x + 1.2) / 2.4;
      pos.setZ(i, Math.sin(x * 2.2 - t * 5) * 0.18 * k + Math.sin(flagBase[i * 3 + 1] * 1.5 + t * 3) * 0.05 * k);
    }
    pos.needsUpdate = true;
    flagGeo.computeVertexNormals();
  };

  return { group, update };
}
