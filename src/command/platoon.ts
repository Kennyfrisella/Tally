import { Soldier, Role } from '../actors/soldier';
import { Enemy } from '../actors/enemy';
import { Civilian } from '../actors/civilian';
import type { GameCtx } from '../actors/actor';
import { CROSS_PASSAGES, GALLERY, Vec2, describeLocation } from '../world/layout';
import type { NavGrid } from '../world/navgrid';
import { makeNamer } from './names';

export type OrderKind = 'idle' | 'move' | 'hold' | 'follow' | 'clear' | 'evac';

export interface Order { kind: OrderKind; target: Vec2; facing: number }

export const ORDER_LABEL: Record<OrderKind, string> = {
  idle: 'Bereitschaft',
  move: 'Verschieben',
  hold: 'Halten / Sichern',
  follow: 'Folgen',
  clear: 'Durchsuchen',
  evac: 'Evakuieren',
};

export const GROUP_COLORS = ['#e8553f', '#f2c230', '#46c86a', '#4aa3f0', '#b57ce8'];
const SIZES = [8, 6, 7, 5, 6];

const ACK: Record<OrderKind, string[]> = {
  idle: ['verstanden.'],
  move: ['verstanden, verschiebe.', 'verstanden, sind unterwegs.', 'verstanden, verschieben jetzt.'],
  hold: ['verstanden, halten und sichern.', 'verstanden, beziehen Stellung.'],
  follow: ['verstanden, folgen Ihnen.', 'verstanden, schliessen auf.'],
  clear: ['verstanden, durchsuchen den Raum.', 'verstanden, säubern.'],
  evac: ['verstanden, evakuieren Zivilpersonen.', 'verstanden, übernehmen Evakuation.'],
};

/** Formation slots: a line across open ground, a staggered column along walls in the bores. */
export function computeSlots(nav: NavGrid, center: Vec2, facing: number, n: number, preferColumn = false): Vec2[] {
  const fx = -Math.sin(facing), fz = -Math.cos(facing);
  const rx = Math.cos(facing), rz = -Math.sin(facing);
  const c = nav.nearestWalkable(center.x, center.z, 10) ?? center;
  const out: Vec2[] = [];
  const free = (p: Vec2) => out.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 1.1);
  const ok = (p: Vec2) => nav.walkable(p.x, p.z) && nav.walkLine(c.x, c.z, p.x, p.z) && free(p);
  for (let i = 0; i < n; i++) {
    const cands: Vec2[] = [];
    if (!preferColumn) {
      const off = (i - (n - 1) / 2) * 2.3;
      const back = Math.abs(off) * 0.25; // shallow wedge
      cands.push({ x: c.x + rx * off - fx * back, z: c.z + rz * off - fz * back });
    }
    for (let k = 0; k < 24; k++) {
      const side = k % 2 === 0 ? 1 : -1;
      for (const lat of [1.6, 0.8, 0]) cands.push({ x: c.x - fx * k * 1.6 + rx * side * lat, z: c.z - fz * k * 1.6 + rz * side * lat });
    }
    const pick = cands.find(ok);
    out.push(pick ?? (nav.nearestWalkable(c.x - fx * i, c.z - fz * i, 6) ?? c));
  }
  return out;
}

export class Gruppe {
  members: Soldier[] = [];
  readonly name: string;
  readonly callsign: string;
  readonly color: string;
  roe: 'free' | 'hold' = 'hold';
  morale = 72;
  order: Order;
  private pending: { order: Order; at: number } | null = null;
  holdYaw = 0;
  underFireAt = -99;
  private lastContact = -99;
  private lastChallenge = -99;
  phase: 'approach' | 'sweep' | 'escort' | 'done' = 'done';
  private phaseT = 0;
  private escorting: Civilian[] = [];
  private evacSafe: Vec2 | null = null;
  private lastOrderAt = -99;
  private lastOrderKind: OrderKind = 'idle';
  private followRef: Vec2 = { x: 0, z: 0 };
  kills = 0;
  arrests = 0;
  losses = 0;
  assignment = '';

  constructor(readonly id: number, start: Vec2) {
    this.name = `${id} Gr`;
    this.callsign = `Riegel ${id}`;
    this.color = GROUP_COLORS[id - 1];
    this.order = { kind: 'idle', target: start, facing: 0 };
  }

  get leader(): Soldier | null { return this.members.find((m) => m.status === 'ok') ?? null; }
  get fit(): Soldier[] { return this.members.filter((m) => m.status === 'ok'); }
  get strength(): string { return `${this.fit.length}/${this.members.length}`; }
  get busyLabel(): string {
    if (this.pending) return 'Befehl erhalten…';
    if (this.order.kind === 'clear') return this.phase === 'sweep' ? 'Durchsucht…' : this.phase === 'done' ? 'Raum gesichert' : 'Annäherung';
    if (this.order.kind === 'evac') return this.phase === 'escort' ? `Eskortiert ${this.escorting.filter((c) => c.status === 'ok').length} Pers.` : this.phase === 'done' ? 'Evakuation abgeschl.' : 'Annäherung';
    if (this.order.kind === 'move') return this.fit.every((m) => m.arrived) ? 'In Stellung' : 'Verschiebt';
    return ORDER_LABEL[this.order.kind];
  }

  where(x: number, z: number) { return describeLocation(x, z); }

  /** Queue an order with a reaction delay that depends on morale and the Lt's leadership. */
  issue(ctx: GameCtx, order: Order, silent = false) {
    if (!this.leader) return;
    const fu = ctx.attrs.fuehrung;
    const delay = Math.max(0.2, 0.5 + (1 - this.morale / 100) * 1.4 - fu * 0.1);
    // "Befehl, Gegenbefehl, Unordnung"
    if (ctx.time - this.lastOrderAt < 5 && this.lastOrderKind !== order.kind && this.lastOrderKind !== 'idle' && !silent) {
      this.morale = Math.max(0, this.morale - 4);
      ctx.event('orderConflict', { gruppe: this });
    }
    this.lastOrderAt = ctx.time;
    this.lastOrderKind = order.kind;
    this.pending = { order, at: ctx.time + (silent ? 0 : delay) };
    if (!silent) {
      const ack = ACK[order.kind][Math.floor(Math.random() * ACK[order.kind].length)];
      setTimeout(() => ctx.radio(this.callsign, ack, 'info'), delay * 1000);
    }
  }

  private apply(ctx: GameCtx, order: Order) {
    this.order = order;
    this.holdYaw = order.facing;
    this.escorting.forEach((c) => c.followTarget === this.leader && c.follow(null));
    this.escorting = [];
    for (const m of this.members) { m.task = m.task === 'treat' ? 'treat' : 'slot'; m.sweepDone = false; }
    switch (order.kind) {
      case 'follow': {
        const p = ctx.playerActor();
        this.followRef = { x: p.pos.x, z: p.pos.z };
        this.assign(ctx, this.followPoint(ctx), p.yaw, true);
        break;
      }
      case 'hold': {
        // stay roughly where they are, but face the Lt's direction
        const l = this.leader!;
        this.assign(ctx, { x: l.pos.x, z: l.pos.z }, order.facing, false);
        break;
      }
      case 'clear':
      case 'evac':
        this.phase = 'approach';
        this.phaseT = 0;
        this.assign(ctx, order.target, order.facing, true);
        break;
      default:
        this.assign(ctx, order.target, order.facing, false);
    }
  }

  private followPoint(ctx: GameCtx): Vec2 {
    const p = ctx.playerActor();
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    return { x: p.pos.x - fx * 3, z: p.pos.z - fz * 3 };
  }

  private assign(ctx: GameCtx, center: Vec2, facing: number, column: boolean) {
    const fit = this.fit.filter((m) => m.task === 'slot');
    const inBore = center.z < -1;
    const slots = computeSlots(ctx.nav, center, facing, fit.length, column || inBore);
    // greedy nearest assignment keeps people from crossing over
    const free = [...slots];
    for (const m of fit) {
      let bi = 0, bd = Infinity;
      free.forEach((s, i) => { const d = Math.hypot(s.x - m.pos.x, s.z - m.pos.z); if (d < bd) { bd = d; bi = i; } });
      m.slot = free.splice(bi, 1)[0] ?? null;
    }
  }

  reportContact(ctx: GameCtx, e: Enemy) {
    if (ctx.time - this.lastContact < 25) return;
    this.lastContact = ctx.time;
    const d = Math.round(e.distTo(this.leader ?? e));
    ctx.radio(this.callsign, `Kontakt! Bewaffnete Person bei ${this.where(e.pos.x, e.pos.z)}, Distanz ${d} m.`, 'contact');
    ctx.event('contact', { gruppe: this, enemy: e });
  }

  challenge(ctx: GameCtx, e: Enemy) {
    if (ctx.time - this.lastChallenge < 7) return;
    this.lastChallenge = ctx.time;
    ctx.radio(this.callsign, '«Halt! Armee! Waffe weg – Hände hoch!»', 'cmd');
    const L = this.leader;
    if (L && ctx.playerActor().distTo(L) < 40) ctx.audio.say('Halt! Armee! Waffe weg! Hände hoch!', 1.15, 0.9);
    for (const a of ctx.actors) if (a instanceof Enemy && a.status === 'ok' && a.distTo(e) < 10) a.challenge(ctx, 0.05);
  }

  update(dt: number, ctx: GameCtx) {
    if (this.pending && ctx.time >= this.pending.at) {
      const o = this.pending.order;
      this.pending = null;
      this.apply(ctx, o);
    }
    for (const m of this.members) if (m.status === 'ok' && m.underFireAt > this.underFireAt) this.underFireAt = m.underFireAt;
    const underFire = ctx.time - this.underFireAt < 2.5;

    // morale
    const p = ctx.playerActor();
    const lead = this.leader;
    const ltNear = lead && p.distTo(lead) < 18;
    if (underFire) this.morale -= dt * 0.9;
    else this.morale += dt * (0.35 + (ltNear ? 0.6 + ctx.attrs.fuersorge * 0.25 : 0)) * (this.morale < 75 ? 1 : 0.2);
    this.morale = Math.max(0, Math.min(100, this.morale));

    // casualty care: the medic (or the nearest comrade) treats the wounded when the shooting stops
    if (!underFire) {
      for (const w of this.members) {
        if (w.status !== 'wounded' || w.treated) continue;
        if (this.members.some((m) => m.task === 'treat' && m.taskTarget === w)) continue;
        const medics = this.fit.filter((m) => m.task === 'slot');
        const medic = medics.find((m) => m.role === 'San') ?? medics.sort((a, b) => a.distTo(w) - b.distTo(w))[0];
        if (medic && medic.distTo(w) < 60) { medic.task = 'treat'; medic.taskTarget = w; }
      }
    }

    // arrest surrendered persons nearby
    for (const a of ctx.actors) {
      if (!(a instanceof Enemy) || a.status !== 'surrendered') continue;
      if (this.members.some((m) => m.task === 'arrest' && m.taskTarget === a)) continue;
      const cand = this.fit.filter((m) => m.task === 'slot' && m.distTo(a) < 25 && ctx.nav.los(m.pos.x, m.pos.z, a.pos.x, a.pos.z));
      if (cand.length) {
        cand.sort((x, y) => x.distTo(a) - y.distTo(a));
        cand[0].task = 'arrest';
        cand[0].taskTarget = a;
      }
    }

    switch (this.order.kind) {
      case 'follow': {
        if (Math.hypot(p.pos.x - this.followRef.x, p.pos.z - this.followRef.z) > 3) {
          this.followRef = { x: p.pos.x, z: p.pos.z };
          this.holdYaw = p.yaw;
          this.assign(ctx, this.followPoint(ctx), p.yaw, true);
        }
        break;
      }
      case 'clear': this.updateClear(dt, ctx); break;
      case 'evac': this.updateEvac(dt, ctx); break;
    }
  }

  private arrivedShare(): number {
    const f = this.fit;
    if (!f.length) return 1;
    return f.filter((m) => m.arrived || m.distTo(m.slot ?? m.pos) < 3).length / f.length;
  }

  private updateClear(dt: number, ctx: GameCtx) {
    this.phaseT += dt;
    const T = this.order.target;
    if (this.phase === 'approach' && (this.arrivedShare() > 0.6 || this.phaseT > 40)) {
      this.phase = 'sweep';
      this.phaseT = 0;
      const fit = this.fit.filter((m) => m.task === 'slot');
      fit.forEach((m, i) => {
        const a = (i / Math.max(1, fit.length)) * Math.PI * 2 + Math.random() * 0.6;
        const r = 5 + Math.random() * 10;
        let pt = ctx.nav.nearestWalkable(T.x + Math.cos(a) * r, T.z + Math.sin(a) * r, 6);
        if (pt && !ctx.nav.los(T.x, T.z, pt.x, pt.z)) pt = ctx.nav.nearestWalkable(T.x + Math.cos(a) * r * 0.5, T.z + Math.sin(a) * r * 0.5, 4);
        m.sweepPoint = pt;
        m.task = pt ? 'sweep' : 'slot';
      });
    } else if (this.phase === 'sweep') {
      const sweeping = this.fit.filter((m) => m.task === 'sweep');
      const contact = this.fit.some((m) => m.target && m.target.status === 'ok') ||
        ctx.actors.some((a) => a instanceof Enemy && a.status === 'ok' && Math.hypot(a.pos.x - T.x, a.pos.z - T.z) < 22);
      if ((sweeping.length === 0 && !contact) || this.phaseT > 45) {
        this.phase = 'done';
        for (const m of this.fit) if (m.task === 'sweep') m.task = 'slot';
        this.assign(ctx, T, this.order.facing, false);
        ctx.radio(this.callsign, `${this.where(T.x, T.z)} durchsucht und gesichert.`, 'info');
        ctx.event('cleared', { gruppe: this, x: T.x, z: T.z });
      }
    }
  }

  private updateEvac(dt: number, ctx: GameCtx) {
    this.phaseT += dt;
    const L = this.leader;
    if (!L) return;
    const T = this.order.target;
    if (this.phase === 'approach' && (L.distTo(T) < 6 || this.phaseT > 45)) {
      const civs = ctx.actors.filter((a): a is Civilian => a instanceof Civilian && a.status === 'ok' && !a.followTarget && a.distTo(L) < 40);
      if (!civs.length) {
        ctx.radio(this.callsign, `Keine Zivilpersonen bei ${this.where(T.x, T.z)} angetroffen.`, 'info');
        this.phase = 'done';
        return;
      }
      // nearest safe area: the gallery via the closest cross-passage, or back out of the portal
      const options: Vec2[] = [...CROSS_PASSAGES.map((c) => ({ x: GALLERY.x, z: c - 4 })), { x: 0, z: 22 }];
      let best = options[options.length - 1], bl = Infinity;
      for (const o of options) {
        const path = ctx.nav.findPath(L.pos.x, L.pos.z, o.x, o.z, 40000);
        if (!path) continue;
        const len = ctx.nav.pathLength(L.pos, path);
        if (len < bl) { bl = len; best = o; }
      }
      this.evacSafe = best;
      this.escorting = civs;
      civs.forEach((c) => c.follow(L));
      this.phase = 'escort';
      this.phaseT = 0;
      ctx.radio(this.callsign, `${civs.length} Zivilpersonen aufgenommen, führe sie zu ${this.where(best.x, best.z)}.`, 'info');
      this.assign(ctx, best, this.order.facing, true);
    } else if (this.phase === 'escort' && this.evacSafe) {
      // keep civilians attached to whoever leads now
      this.escorting.forEach((c) => { if (c.status === 'ok' && c.followTarget !== L) c.follow(L); });
      const left = this.escorting.filter((c) => c.status === 'ok');
      if (L.distTo(this.evacSafe) < 6) left.forEach((c) => c.distTo(L) < 15 && c.evacuate(ctx));
      if (left.length === 0 || this.phaseT > 150) {
        this.phase = 'done';
        const n = this.escorting.filter((c) => c.status === 'evacuated').length;
        ctx.radio(this.callsign, `${n} Zivilpersonen in Sicherheit. Halten bei ${this.where(this.evacSafe.x, this.evacSafe.z)}.`, 'info');
      }
    }
  }
}

export interface PlatoonBuild { groups: Gruppe[]; soldiers: Soldier[] }

/** Creates the 5 Gruppen (32 soldiers) lined up at the assembly area. */
export function buildPlatoon(nav: NavGrid, assembly: Vec2, seed = 7): PlatoonBuild {
  const namer = makeNamer(seed);
  const groups: Gruppe[] = [];
  const soldiers: Soldier[] = [];
  SIZES.forEach((n, gi) => {
    const g = new Gruppe(gi + 1, assembly);
    const rowZ = assembly.z + gi * 3.2 - 6;
    for (let i = 0; i < n; i++) {
      const role: Role = i === 0 ? 'Gfhr' : i === 1 ? 'Stv' : i === 2 ? 'San' : i === 3 && n >= 6 ? 'Mg' : 'Sdt';
      const rank = role === 'Gfhr' ? (gi % 2 === 0 ? 'Wm' : 'Kpl') : role === 'Stv' ? 'Obgfr' : ['Sdt', 'Gfr', 'Sdt'][i % 3];
      const nm = namer();
      const p = nav.nearestWalkable(assembly.x + 4 + i * 1.6, rowZ, 6) ?? { x: assembly.x, z: rowZ };
      const s = new Soldier(g, rank, role, nm.first, nm.last, p.x, p.z);
      s.yaw = 0;
      g.members.push(s);
      soldiers.push(s);
    }
    groups.push(g);
  });
  return { groups, soldiers };
}
