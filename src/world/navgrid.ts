import {
  BLOCKS, CROSS_PASSAGES, GALLERY, PASSAGE, PLAZA, TUNNEL, VEHICLES, VEHICLE_DIMS, VENT_ROOM, Vec2,
} from './layout';

export const enum Cell { ROCK = 0, WALK = 1, OBST = 2, OPEN = 3, LOW = 4 }

const R = 0.4; // agent radius baked into the walkable rects

/**
 * 2D occupancy grid over the sector. All actors live on the y = 0 plane, so movement, line of sight,
 * bullets against walls and pathfinding all run on this grid instead of on render meshes.
 */
export class NavGrid {
  readonly cell = 0.5;
  readonly x0 = -70;
  readonly z0 = -640;
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;

  constructor() {
    this.w = Math.round(140 / this.cell);
    this.h = Math.round((240 + 640) / this.cell);
    const n = this.w * this.h;
    this.data = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.build();
  }

  private build() {
    // Everything north of the facade that is not walkable is open air (does not block sight or bullets).
    for (let j = 0; j < this.h; j++) {
      const z = this.z0 + (j + 0.5) * this.cell;
      if (z > 0.2) this.data.fill(Cell.OPEN, j * this.w, (j + 1) * this.w);
    }
    this.fillRect(PLAZA.x0 + R, 0.25, PLAZA.x1 - R, PLAZA.z1, Cell.WALK);
    this.fillRect(-TUNNEL.halfWidth + R, TUNNEL.walkEnd, TUNNEL.halfWidth - R, 0.6, Cell.WALK);
    this.fillRect(GALLERY.x - GALLERY.halfWidth + R, GALLERY.walkEnd, GALLERY.x + GALLERY.halfWidth - R, 0.6, Cell.WALK);
    for (const c of CROSS_PASSAGES) {
      this.fillRect(TUNNEL.halfWidth - R, c - PASSAGE.halfWidth + R, GALLERY.x - GALLERY.halfWidth + R, c + PASSAGE.halfWidth - R, Cell.WALK);
    }
    this.fillRect(VENT_ROOM.x0 + R, VENT_ROOM.z0 + R, VENT_ROOM.x1 - R, VENT_ROOM.z1 - R, Cell.WALK);
    this.fillRect(VENT_ROOM.x1 - R, VENT_ROOM.door0 + R, -TUNNEL.halfWidth + R, VENT_ROOM.door1 - R, Cell.WALK);
    // Facade between the two portals
    this.fillRect(TUNNEL.halfWidth, -9, GALLERY.x - GALLERY.halfWidth, 0.25, Cell.ROCK);

    for (const v of VEHICLES) {
      const d = VEHICLE_DIMS[v.kind];
      this.fillOBB(v.x, v.z, d.w / 2 + R * 0.8, d.l / 2 + R * 0.8, v.rot, d.tall ? Cell.OBST : Cell.LOW);
    }
    for (const [cx, cz, hw, hd, rot, tall] of BLOCKS) {
      this.fillOBB(cx, cz, hw + R * 0.8, hd + R * 0.8, rot, tall ? Cell.OBST : Cell.LOW);
    }
  }

  fillRect(xa: number, za: number, xb: number, zb: number, t: Cell) {
    const i0 = Math.max(0, Math.floor((xa - this.x0) / this.cell));
    const i1 = Math.min(this.w - 1, Math.ceil((xb - this.x0) / this.cell) - 1);
    const j0 = Math.max(0, Math.floor((za - this.z0) / this.cell));
    const j1 = Math.min(this.h - 1, Math.ceil((zb - this.z0) / this.cell) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.data[j * this.w + i] = t;
  }

  fillOBB(cx: number, cz: number, hw: number, hd: number, rot: number, t: Cell) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const ext = Math.hypot(hw, hd);
    const i0 = Math.max(0, Math.floor((cx - ext - this.x0) / this.cell));
    const i1 = Math.min(this.w - 1, Math.ceil((cx + ext - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((cz - ext - this.z0) / this.cell));
    const j1 = Math.min(this.h - 1, Math.ceil((cz + ext - this.z0) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.w + i;
        if (this.data[k] !== Cell.WALK) continue;
        const dx = this.x0 + (i + 0.5) * this.cell - cx;
        const dz = this.z0 + (j + 0.5) * this.cell - cz;
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) this.data[k] = t;
      }
    }
  }

  index(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  get(x: number, z: number): Cell {
    const k = this.index(x, z);
    return k < 0 ? (z > 0 ? Cell.OPEN : Cell.ROCK) : (this.data[k] as Cell);
  }

  walkable(x: number, z: number): boolean {
    return this.get(x, z) === Cell.WALK;
  }

  blocksSight(x: number, z: number): boolean {
    const c = this.get(x, z);
    return c === Cell.ROCK || c === Cell.OBST;
  }

  /** Line of sight on the ground plane. Low obstacles (cars) do not block. */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / 0.35);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.blocksSight(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /** True if an agent can walk straight from a to b. */
  walkLine(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const steps = Math.ceil(Math.hypot(dx, dz) / 0.25);
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      if (!this.walkable(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /** Distance along a horizontal ray to the first sight-blocking cell (walls, tall obstacles). */
  rayDist(ox: number, oz: number, dx: number, dz: number, max: number): number {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return max;
    dx /= len; dz /= len;
    for (let d = 0.2; d < max; d += 0.2) {
      if (this.blocksSight(ox + dx * d, oz + dz * d)) return d;
    }
    return max;
  }

  nearestWalkable(x: number, z: number, maxR = 12): Vec2 | null {
    if (this.walkable(x, z)) return { x, z };
    for (let r = this.cell; r <= maxR; r += this.cell) {
      const n = Math.ceil((2 * Math.PI * r) / this.cell);
      let best: Vec2 | null = null;
      let bestD = Infinity;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (this.walkable(px, pz)) {
          const d = Math.hypot(px - x, pz - z);
          if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** A* over the grid with octile moves, followed by line-of-walk smoothing. */
  findPath(ax: number, az: number, bx: number, bz: number, maxExpand = 90000): Vec2[] | null {
    const start = this.nearestWalkable(ax, az, 3);
    const goal = this.nearestWalkable(bx, bz, 8);
    if (!start || !goal) return null;
    if (this.walkLine(start.x, start.z, goal.x, goal.z)) return [goal];

    const s = this.index(start.x, start.z);
    const t = this.index(goal.x, goal.z);
    if (s < 0 || t < 0) return null;
    const gen = ++this.gen;
    const w = this.w;
    const tx = t % w, tj = (t / w) | 0;
    const heap = new MinHeap();
    const hfn = (k: number) => {
      const dx = Math.abs((k % w) - tx), dz = Math.abs(((k / w) | 0) - tj);
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)) * 1.001;
    };
    this.g[s] = 0; this.stamp[s] = gen; this.parent[s] = -1;
    heap.push(s, hfn(s));
    let expanded = 0;
    let found = false;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1];
    const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
    while (heap.size > 0) {
      const cur = heap.pop();
      if (cur === t) { found = true; break; }
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (++expanded > maxExpand) break;
      const ci = cur % w, cj = (cur / w) | 0;
      for (let d = 0; d < 8; d++) {
        const ni = ci + DX[d], nj = cj + DZ[d];
        if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
        const nk = nj * w + ni;
        if (this.data[nk] !== Cell.WALK) continue;
        if (d >= 4 && (this.data[cj * w + ni] !== Cell.WALK || this.data[nj * w + ci] !== Cell.WALK)) continue;
        const ng = this.g[cur] + (d >= 4 ? Math.SQRT2 : 1);
        if (this.stamp[nk] !== gen || ng < this.g[nk]) {
          this.stamp[nk] = gen;
          this.g[nk] = ng;
          this.parent[nk] = cur;
          heap.push(nk, ng + hfn(nk));
        }
      }
    }
    if (!found) return null;
    const raw: Vec2[] = [];
    for (let k = t; k !== -1; k = this.parent[k]) {
      raw.push({ x: this.x0 + ((k % w) + 0.5) * this.cell, z: this.z0 + (((k / w) | 0) + 0.5) * this.cell });
    }
    raw.reverse();
    raw[raw.length - 1] = goal;
    // String-pulling
    const out: Vec2[] = [];
    let anchor = start;
    let i = 0;
    while (i < raw.length) {
      let k = i;
      let step = 1;
      while (k + step < raw.length && this.walkLine(anchor.x, anchor.z, raw[k + step].x, raw[k + step].z)) {
        k += step;
        step = Math.min(step * 2, 64);
      }
      while (k + 1 < raw.length && this.walkLine(anchor.x, anchor.z, raw[k + 1].x, raw[k + 1].z)) k++;
      out.push(raw[k]);
      anchor = raw[k];
      i = k + 1;
    }
    return out;
  }

  pathLength(from: Vec2, path: Vec2[]): number {
    let L = 0, p = from;
    for (const q of path) { L += Math.hypot(q.x - p.x, q.z - p.z); p = q; }
    return L;
  }
}

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    const k = this.k, p = this.p;
    k.push(key); p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [k[par], k[i]] = [k[i], k[par]];
      [p[par], p[i]] = [p[i], p[par]];
      i = par;
    }
  }
  pop(): number {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop()!, lp = p.pop()!;
    if (k.length > 0) {
      k[0] = lk; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}
