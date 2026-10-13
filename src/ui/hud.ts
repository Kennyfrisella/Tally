import * as THREE from 'three';
import type { Gruppe } from '../command/platoon';
import type { Objective } from '../rpg/scenario';
import type { Rifle } from '../actors/weapon';
import type { Player } from '../actors/player';
import type { Actor } from '../actors/actor';
import { Enemy } from '../actors/enemy';
import { Soldier } from '../actors/soldier';
import type { NavGrid } from '../world/navgrid';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export interface HudState {
  player: Player;
  rifle: Rifle;
  camera: THREE.PerspectiveCamera;
  groups: Gruppe[];
  selected: Set<number>;
  objectives: Objective[];
  actors: Actor[];
  time: number;
  prompt: string;
  progress: number;
  chargeTimer: number;
  spotMemory: number;
  minimapRange: number;
  inside: number;
}

export class Hud {
  root: HTMLDivElement;
  private compassStrip: HTMLDivElement;
  private compassWidth = 560;
  private heading: HTMLDivElement;
  private compassMarks: HTMLDivElement;
  private objEl: HTMLDivElement;
  private squadEls = new Map<number, HTMLDivElement>();
  private radioEl: HTMLDivElement;
  private ammoEl: HTMLDivElement;
  private metaEl: HTMLDivElement;
  private healthEl: HTMLDivElement;
  private cross: HTMLDivElement;
  private hitEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private progEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private vignette: HTMLDivElement;
  private lowhp: HTMLDivElement;
  private selInfo: HTMLDivElement;
  private markers: HTMLDivElement;
  private markerPool: HTMLDivElement[] = [];
  private minimap: HTMLCanvasElement;
  private mm: CanvasRenderingContext2D;
  private slow = 0;
  private toastT: number | undefined;
  private msgs: HTMLDivElement[] = [];

  constructor(private mapImage: HTMLCanvasElement, private nav: NavGrid) {
    this.root = h('div') as HTMLDivElement;
    this.root.id = 'hud';
    this.vignette = h('div', 'vignette') as HTMLDivElement;
    this.lowhp = h('div', 'lowhp') as HTMLDivElement;
    this.markers = h('div') as HTMLDivElement;
    this.root.append(this.vignette, this.lowhp, this.markers);

    const compass = h('div', 'compass') as HTMLDivElement;
    this.compassStrip = h('div', 'strip') as HTMLDivElement;
    const ppd = this.compassWidth / 180; // px per degree, ±90° visible
    const names: Record<number, string> = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -360; d <= 720; d += 15) {
      const n = ((d % 360) + 360) % 360;
      const x = d * ppd;
      if (n % 45 === 0) {
        const l = h('div', 'lbl' + (n % 90 === 0 ? ' card' : ''), names[n]);
        l.style.left = `${x}px`;
        this.compassStrip.appendChild(l);
      } else {
        const l = h('div', 'lbl', String(n));
        l.style.left = `${x}px`;
        l.style.fontSize = '12px';
        l.style.top = '2px';
        l.style.color = 'rgba(233,236,239,0.5)';
        this.compassStrip.appendChild(l);
      }
      const t = h('div', 'tick');
      t.style.left = `${x}px`;
      this.compassStrip.appendChild(t);
    }
    this.compassMarks = h('div', 'strip') as HTMLDivElement;
    compass.append(this.compassStrip, this.compassMarks);
    this.heading = h('div', 'compass-center') as HTMLDivElement;
    this.root.append(compass, this.heading);

    this.objEl = h('div', 'objectives') as HTMLDivElement;
    this.root.appendChild(this.objEl);

    const squads = h('div', 'squads');
    this.root.appendChild(squads);
    (this as unknown as { squadsEl: HTMLElement }).squadsEl = squads;

    this.radioEl = h('div', 'radio') as HTMLDivElement;
    this.root.appendChild(this.radioEl);

    const weapon = h('div', 'weapon');
    weapon.appendChild(h('div', 'name', 'Stgw 90'));
    this.ammoEl = h('div', 'ammo') as HTMLDivElement;
    this.metaEl = h('div', 'meta') as HTMLDivElement;
    weapon.append(this.ammoEl, this.metaEl);
    this.healthEl = h('div', 'health', '<i></i>') as HTMLDivElement;
    this.root.append(weapon, this.healthEl);

    this.cross = h('div', 'crosshair', '<i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i>') as HTMLDivElement;
    this.hitEl = h('div', 'hitmark') as HTMLDivElement;
    this.promptEl = h('div', 'prompt') as HTMLDivElement;
    this.progEl = h('div', 'progress', '<i></i>') as HTMLDivElement;
    this.toastEl = h('div', 'toast') as HTMLDivElement;
    this.selInfo = h('div', 'selinfo') as HTMLDivElement;
    this.root.append(this.cross, this.hitEl, this.promptEl, this.progEl, this.toastEl, this.selInfo);

    const legend = h('div', 'legend');
    const keys: Array<[string, string]> = [['1-5', 'Gruppe'], ['0', 'Alle'], ['Q', 'Verschieben'], ['X', 'Halten'], ['F', 'Folgen'], ['V', 'Durchsuchen'], ['B', 'Evakuieren'], ['G', 'Feuer frei/halt'], ['H', 'Halt-Ruf'], ['E', 'Interagieren'], ['T', 'Meldung'], ['M', 'Karte']];
    legend.innerHTML = keys.map(([k, v]) => `<span><span class="kbd">${k}</span>${v}</span>`).join('');
    this.root.appendChild(legend);

    this.minimap = document.createElement('canvas');
    this.minimap.className = 'minimap';
    this.minimap.width = this.minimap.height = 190;
    this.mm = this.minimap.getContext('2d')!;
    this.root.appendChild(this.minimap);
    document.body.appendChild(this.root);
  }

  setVisible(v: boolean) { this.root.classList.toggle('hidden', !v); }

  initSquads(groups: Gruppe[]) {
    const el = (this as unknown as { squadsEl: HTMLElement }).squadsEl;
    el.innerHTML = '';
    for (const g of groups) {
      const d = h('div', 'sq') as HTMLDivElement;
      d.style.setProperty('--c', g.color);
      el.appendChild(d);
      this.squadEls.set(g.id, d);
    }
  }

  flashSquad(id: number) {
    const e = this.squadEls.get(id);
    if (!e) return;
    e.classList.remove('contact');
    void e.offsetWidth;
    e.classList.add('contact');
  }

  radio(from: string, text: string, kind: string) {
    const m = h('div', `rmsg ${kind}`, `<span class="from">${from}:</span>${text}`) as HTMLDivElement;
    this.radioEl.appendChild(m);
    this.msgs.push(m);
    while (this.msgs.length > 6) this.msgs.shift()!.remove();
    this.msgs.forEach((x, i) => x.classList.toggle('old', i < this.msgs.length - 3));
    setTimeout(() => m.classList.add('old'), 12000);
  }

  hit(kill: boolean) {
    this.hitEl.classList.remove('on', 'kill');
    void this.hitEl.offsetWidth;
    this.hitEl.classList.add('on');
    if (kill) this.hitEl.classList.add('kill');
  }

  damage() {
    this.vignette.style.transition = 'none';
    this.vignette.style.opacity = '1';
    requestAnimationFrame(() => { this.vignette.style.transition = 'opacity .8s'; this.vignette.style.opacity = '0'; });
  }

  toast(title: string, sub = '', ms = 3200) {
    this.toastEl.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  private bearing(dx: number, dz: number): number {
    // degrees clockwise from north; +Z is north, -X is east
    return (THREE.MathUtils.radToDeg(Math.atan2(-dx, dz)) + 360) % 360;
  }

  update(s: HudState, dt: number) {
    const p = s.player;
    const yawDeg = (THREE.MathUtils.radToDeg(Math.atan2(Math.sin(p.yaw), -Math.cos(p.yaw))) + 360) % 360;
    const ppd = this.compassWidth / 180;
    this.compassStrip.style.transform = `translateX(${this.compassWidth / 2 - yawDeg * ppd}px)`;
    this.heading.textContent = String(Math.round(yawDeg)).padStart(3, '0');

    // crosshair spread
    const spread = 8 + s.rifle.bloom * 26 + Math.min(1, p.speed / 4) * 14;
    const show = s.player.ads < 0.6 && !p.sprinting;
    this.cross.classList.toggle('hidden', !show);
    const ch = this.cross.children as HTMLCollectionOf<HTMLElement>;
    ch[0].style.top = `${-spread - 9}px`;
    ch[1].style.top = `${spread}px`;
    ch[2].style.left = `${-spread - 9}px`;
    ch[3].style.left = `${spread}px`;

    this.promptEl.textContent = s.prompt;
    this.progEl.style.display = s.progress > 0 ? 'block' : 'none';
    (this.progEl.firstChild as HTMLElement).style.width = `${s.progress * 100}%`;

    this.updateMarkers(s);
    this.drawMinimap(s);

    this.slow += dt;
    if (this.slow < 0.1) return;
    this.slow = 0;

    // compass markers: objectives and group leaders
    const marks: string[] = [];
    const addMark = (x: number, z: number, html: string, color: string) => {
      const b = this.bearing(x - p.pos.x, z - p.pos.z);
      let d = b - yawDeg;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      if (Math.abs(d) > 90) return;
      marks.push(`<div class="cmark" style="left:${this.compassWidth / 2 + d * ppd}px;color:${color}">${html}</div>`);
    };
    for (const o of s.objectives) if (!o.done && !o.failed && o.marker) addMark(o.marker.x, o.marker.z, '◇', '#ffb020');
    for (const g of s.groups) { const L = g.leader; if (L) addMark(L.pos.x, L.pos.z, String(g.id), g.color); }
    this.compassMarks.style.transform = this.compassStrip.style.transform.replace(/translateX\(([-\d.]+)px\)/, 'translateX(0px)');
    this.compassMarks.innerHTML = marks.join('');

    const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60);
    this.objEl.innerHTML = `<div class="head"><span>Op RIEGEL</span><span>${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}</span></div>` +
      s.objectives.map((o) => {
        const urgent = o.id === 'vent' && s.chargeTimer > 0;
        return `<div class="obj ${o.done ? 'done' : ''} ${o.failed ? 'failed' : ''} ${urgent ? 'urgent' : ''}"><span class="box"></span>${o.title}<span class="prog">${o.progress ?? ''}</span></div>`;
      }).join('');

    for (const g of s.groups) {
      const e = this.squadEls.get(g.id)!;
      e.classList.toggle('sel', s.selected.has(g.id));
      e.innerHTML = `<div class="top"><span class="num">${g.id}</span><span class="cs">${g.callsign}</span><span class="str">${g.strength}</span></div>` +
        `<div class="ord"><span>${g.busyLabel}</span><span class="roe ${g.roe}">${g.roe === 'free' ? 'FEUER FREI' : 'NOTWEHR'}</span></div>` +
        `<div class="bar"><i style="width:${g.morale}%"></i></div>`;
    }
    const sel = [...s.selected].sort();
    this.selInfo.textContent = sel.length ? (sel.length === 5 ? 'GANZER ZUG' : sel.map((i) => `${i} Gr`).join(' + ')) : '';

    const r = s.rifle;
    this.ammoEl.innerHTML = `${r.reloading > 0 ? '--' : r.mag}<small> / ${r.reserve}</small>`;
    this.ammoEl.classList.toggle('low', r.mag <= 5);
    this.metaEl.textContent = `${r.mode} · ${p.crouch ? 'Kniend' : 'Stehend'}${r.flashlightOn ? ' · Lampe' : ''}${r.reloading > 0 ? ' · Nachladen' : ''}`;
    (this.healthEl.firstChild as HTMLElement).style.width = `${Math.max(0, p.hp)}%`;
    this.healthEl.classList.toggle('low', p.hp < 40);
    this.lowhp.style.opacity = String(Math.max(0, (45 - p.hp) / 45));
  }

  private updateMarkers(s: HudState) {
    const cam = s.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const v = new THREE.Vector3();
    let n = 0;
    const put = (x: number, y: number, z: number, cls: string, html: string, color?: string) => {
      v.set(x, y, z).project(cam);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return;
      let el = this.markerPool[n];
      if (!el) { el = h('div') as HTMLDivElement; this.markers.appendChild(el); this.markerPool.push(el); }
      el.className = `wmark ${cls}`;
      el.style.display = 'block';
      el.style.left = `${(v.x * 0.5 + 0.5) * W}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * H}px`;
      el.style.color = color ?? '';
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
      n++;
    };
    const p = s.player;
    for (const g of s.groups) {
      const L = g.leader;
      if (!L) continue;
      const d = p.distTo(L);
      const sel = s.selected.has(g.id);
      if (d < 6 && !sel) continue;
      put(L.pos.x, 2.25, L.pos.z, '', `<div class="d" style="background:${g.color}"></div>${g.id}${sel || d < 40 ? `<div class="lbl">${Math.round(d)} m</div>` : ''}`, g.color);
    }
    for (const a of s.actors) {
      if (a instanceof Enemy && a.status === 'ok' && s.time - a.spottedAt < s.spotMemory && p.distTo(a) > 4) {
        put(a.pos.x, 2.1, a.pos.z, 'enemy', '<div class="d"></div>');
      } else if (a instanceof Enemy && a.status === 'surrendered') {
        put(a.pos.x, 2.1, a.pos.z, 'obj', '<div class="lbl">ERGIBT SICH</div>');
      } else if (a instanceof Soldier && a.status === 'wounded' && !a.treated) {
        put(a.pos.x, 0.9, a.pos.z, 'med', '✚');
      }
    }
    for (const o of s.objectives) {
      if (o.done || o.failed || !o.marker) continue;
      if (o.id !== 'vent' && o.id !== 'portal') continue;
      const d = Math.hypot(o.marker.x - p.pos.x, o.marker.z - p.pos.z);
      if (d < 5) continue;
      put(o.marker.x, 1.6, o.marker.z, 'obj', `<div class="d"></div><div class="lbl">${o.id === 'vent' ? 'LÜFTUNG' : 'KP'} ${Math.round(d)} m</div>`);
    }
    for (let i = n; i < this.markerPool.length; i++) this.markerPool[i].style.display = 'none';
  }

  private drawMinimap(s: HudState) {
    const g = this.mm;
    const S = this.minimap.width;
    const p = s.player;
    const range = s.minimapRange; // metres to the edge
    const scale = (S / 2) / range;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(10,12,14,0.8)';
    g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    // rotate so the player's heading points up
    g.rotate(p.yaw + Math.PI);
    const nav = this.nav;
    // map image: flip x (world +X is screen left), image rows are north-first
    g.save();
    g.scale(-scale * nav.cell, scale * nav.cell);
    const ix = (p.pos.x - nav.x0) / nav.cell;
    const iy = (nav.h * nav.cell - (p.pos.z - nav.z0)) / nav.cell;
    g.globalAlpha = 0.85;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.mapImage, -ix, -iy);
    g.restore();
    const dot = (x: number, z: number, r: number, c: string) => {
      g.fillStyle = c;
      g.beginPath(); g.arc(-(x - p.pos.x) * scale, -(z - p.pos.z) * scale, r, 0, Math.PI * 2); g.fill();
    };
    for (const a of s.actors) {
      if (a.status === 'dead' || a.status === 'evacuated') continue;
      if (Math.abs(a.pos.x - p.pos.x) > range * 1.5 || Math.abs(a.pos.z - p.pos.z) > range * 1.5) continue;
      if (a instanceof Soldier) dot(a.pos.x, a.pos.z, 2.6, a.status === 'wounded' ? '#ff6b6b' : a.gruppe.color);
      else if (a instanceof Enemy) { if (s.time - a.spottedAt < s.spotMemory || a.status !== 'ok') dot(a.pos.x, a.pos.z, 3, a.status === 'ok' ? '#ff3b30' : '#999'); }
      else if (a.faction === 'civ') dot(a.pos.x, a.pos.z, 2.4, '#ffffff');
    }
    g.restore();
    // player arrow (always up)
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(S / 2, S / 2 - 7); g.lineTo(S / 2 + 5, S / 2 + 6); g.lineTo(S / 2, S / 2 + 3); g.lineTo(S / 2 - 5, S / 2 + 6); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.stroke();
  }
}
