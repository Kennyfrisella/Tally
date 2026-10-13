import type { NavGrid } from '../world/navgrid';
import { Cell } from '../world/navgrid';
import type { Gruppe, OrderKind } from './platoon';
import { ORDER_LABEL } from './platoon';
import type { Actor } from '../actors/actor';
import { Enemy } from '../actors/enemy';
import { Civilian } from '../actors/civilian';
import { CROSS_PASSAGES, GALLERY, Vec2 } from '../world/layout';
import type { Objective } from '../rpg/scenario';

/** Rasterizes the nav grid once (1 px per cell). Shared by the minimap and the tactical map. */
export function buildMapImage(nav: NavGrid): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = nav.w;
  c.height = nav.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(nav.w, nav.h);
  for (let j = 0; j < nav.h; j++) {
    for (let i = 0; i < nav.w; i++) {
      // image row 0 = north (max z)
      const k = j * nav.w + i;
      const o = ((nav.h - 1 - j) * nav.w + i) * 4;
      const t = nav.data[k];
      let r = 26, g = 30, b = 28, a = 255;
      if (t === Cell.WALK) { r = 120; g = 126; b = 128; }
      else if (t === Cell.OBST) { r = 70; g = 74; b = 78; }
      else if (t === Cell.LOW) { r = 92; g = 84; b = 70; }
      else if (t === Cell.OPEN) { r = 44; g = 56; b = 40; }
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface MapState {
  groups: Gruppe[];
  selected: Set<number>;
  actors: Actor[];
  player: Actor;
  objectives: Objective[];
  time: number;
  spotMemory: number;
}

/** Full-screen tactical map: pan/zoom, select Gruppen, right-click to order. */
export class TacMap {
  el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private center: Vec2 = { x: 0, z: -150 };
  private scale = 2.2; // px per metre
  mode: OrderKind = 'move';
  open = false;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  onOrder: (kind: OrderKind, at: Vec2) => void = () => {};
  onSelect: (id: number, add: boolean) => void = () => {};
  private state: MapState | null = null;

  constructor(private nav: NavGrid, private image: HTMLCanvasElement) {
    this.el = document.createElement('div');
    this.el.id = 'tacmap';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const bar = document.createElement('div');
    bar.className = 'tm-bar';
    (['move', 'hold', 'clear', 'evac'] as OrderKind[]).forEach((k) => {
      const b = document.createElement('button');
      b.textContent = ORDER_LABEL[k];
      b.dataset.k = k;
      b.onclick = () => { this.mode = k; this.syncBar(); };
      bar.appendChild(b);
    });
    this.el.appendChild(bar);
    const help = document.createElement('div');
    help.className = 'tm-help';
    help.innerHTML = 'Linksklick: Gruppe wählen (Shift = hinzufügen) · Rechtsklick: Befehl · Ziehen: verschieben · Mausrad: Zoom · <span class="kbd">M</span> schliessen';
    this.el.appendChild(help);
    document.body.appendChild(this.el);
    this.syncBar();

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.toWorld(e.clientX, e.clientY);
      this.scale = Math.max(0.6, Math.min(12, this.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const after = this.toWorld(e.clientX, e.clientY);
      this.center.x += before.x - after.x;
      this.center.z += before.z - after.z;
    }, { passive: false });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.drag = { x: e.clientX, y: e.clientY, cx: this.center.x, cz: this.center.z, moved: false };
      if (e.button === 2) {
        const w = this.toWorld(e.clientX, e.clientY);
        const p = this.nav.nearestWalkable(w.x, w.z, 6);
        if (p) this.onOrder(this.mode, p);
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      // screen x grows to the east (= -X world), screen y grows south (= -Z)
      this.center.x = this.drag.cx + dx / this.scale;
      this.center.z = this.drag.cz + dy / this.scale;
    });
    window.addEventListener('mouseup', (e) => {
      if (this.drag && !this.drag.moved && e.button === 0 && this.state) {
        const w = this.toWorld(e.clientX, e.clientY);
        let best: Gruppe | null = null, bd = 6;
        for (const g of this.state.groups) {
          for (const m of g.fit) {
            const d = Math.hypot(m.pos.x - w.x, m.pos.z - w.z);
            if (d < bd) { bd = d; best = g; }
          }
        }
        if (best) this.onSelect(best.id, e.shiftKey);
      }
      this.drag = null;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private syncBar() {
    this.el.querySelectorAll<HTMLButtonElement>('.tm-bar button').forEach((b) => b.classList.toggle('on', b.dataset.k === this.mode));
  }

  show(on: boolean, focus?: Vec2) {
    this.open = on;
    this.el.classList.toggle('on', on);
    if (on && focus) this.center = { x: focus.x, z: focus.z - 20 };
  }

  private toScreen(x: number, z: number): [number, number] {
    const w = this.canvas.width, h = this.canvas.height;
    return [w / 2 - (x - this.center.x) * this.scale, h / 2 - (z - this.center.z) * this.scale];
  }

  private toWorld(sx: number, sy: number): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    const px = (sx - r.left) * (this.canvas.width / r.width), py = (sy - r.top) * (this.canvas.height / r.height);
    return { x: this.center.x - (px - this.canvas.width / 2) / this.scale, z: this.center.z - (py - this.canvas.height / 2) / this.scale };
  }

  draw(st: MapState) {
    this.state = st;
    if (!this.open) return;
    const c = this.canvas;
    if (c.width !== window.innerWidth || c.height !== window.innerHeight) { c.width = window.innerWidth; c.height = window.innerHeight; }
    const g = this.ctx;
    g.fillStyle = '#0b0d0f';
    g.fillRect(0, 0, c.width, c.height);
    // map image: world x grows to the left on screen, so flip horizontally
    const nav = this.nav;
    const [sx0, sy0] = this.toScreen(nav.x0, nav.z0 + nav.h * nav.cell);
    g.save();
    g.imageSmoothingEnabled = false;
    g.translate(sx0, sy0);
    g.scale(-this.scale * nav.cell, this.scale * nav.cell);
    g.drawImage(this.image, 0, 0);
    g.restore();

    // grid every 50 m
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    for (let z = -650; z <= 250; z += 50) {
      const [, y] = this.toScreen(0, z);
      g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke();
    }
    g.font = '600 13px "Barlow Condensed", Arial';
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let z = 0; z >= -600; z -= 100) {
      const [x, y] = this.toScreen(-8, z);
      g.fillText(`${-z} m`, x + 4, y - 3);
    }
    // labels
    const label = (txt: string, x: number, z: number, color = 'rgba(255,255,255,0.75)') => {
      const [px, py] = this.toScreen(x, z);
      g.fillStyle = color; g.fillText(txt, px, py);
    };
    CROSS_PASSAGES.forEach((cz, i) => label(`QS ${i + 1}`, 17, cz - 2.5, '#5fd38a'));
    label('STRASSENTUNNEL', 4.5, -40);
    label('SICHERHEITSSTOLLEN', GALLERY.x + 3, -40);
    label('LÜFTUNGSZENTRALE', -8, -495, '#f2d200');
    label('KONTROLLPOSTEN', 10, 30);
    label('BEREITSCHAFTSRAUM', -6, 84);
    // phase lines
    g.setLineDash([8, 6]);
    g.strokeStyle = 'rgba(255,176,32,0.6)';
    [['PL ALPHA', -150], ['PL BRAVO', -300], ['PL CHARLIE', -470]].forEach(([n, z]) => {
      const [x0, y] = this.toScreen(40, z as number);
      const [x1] = this.toScreen(-20, z as number);
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.fillStyle = 'rgba(255,176,32,0.9)'; g.fillText(n as string, x1 + 6, y + 4);
    });
    g.setLineDash([]);

    // objectives
    for (const o of st.objectives) {
      if (o.done || o.failed || !o.marker) continue;
      const [x, y] = this.toScreen(o.marker.x, o.marker.z);
      g.strokeStyle = '#ffb020'; g.lineWidth = 2;
      g.strokeRect(x - 7, y - 7, 14, 14);
    }
    // actors
    for (const a of st.actors) {
      const [x, y] = this.toScreen(a.pos.x, a.pos.z);
      if (a instanceof Enemy) {
        if (a.status === 'ok' && st.time - a.spottedAt > st.spotMemory) continue;
        g.fillStyle = a.status === 'ok' ? '#ff4a3d' : '#888';
        g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.fill();
      } else if (a instanceof Civilian) {
        if (a.status === 'evacuated') continue;
        g.fillStyle = a.status === 'ok' ? '#fff' : '#555';
        g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
      }
    }
    for (const grp of st.groups) {
      const sel = st.selected.has(grp.id);
      for (const m of grp.members) {
        if (m.status === 'dead') continue;
        const [x, y] = this.toScreen(m.pos.x, m.pos.z);
        g.fillStyle = m.status === 'wounded' ? '#ff6b6b' : grp.color;
        g.beginPath(); g.arc(x, y, sel ? 4.5 : 3.5, 0, Math.PI * 2); g.fill();
        if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); }
        if (m.slot && m.status === 'ok' && m.path.length && sel) {
          const [tx, ty] = this.toScreen(m.slot.x, m.slot.z);
          g.strokeStyle = grp.color + '88'; g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.stroke();
        }
      }
      const L = grp.leader;
      if (L) {
        const [x, y] = this.toScreen(L.pos.x, L.pos.z);
        g.fillStyle = grp.color;
        g.font = '800 15px "Barlow Condensed", Arial';
        g.fillText(String(grp.id), x + 7, y - 6);
        g.font = '600 13px "Barlow Condensed", Arial';
      }
    }
    // player
    const p = st.player;
    const [px, py] = this.toScreen(p.pos.x, p.pos.z);
    g.save();
    g.translate(px, py);
    // world forward (-sin, -cos) maps to screen (sin, cos) because both axes are flipped
    g.rotate(Math.PI - p.yaw);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill();
    g.restore();
  }
}
