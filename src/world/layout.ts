// Single source of truth for the sector geometry. Meshes, the navigation grid and the scenario all read from here.
// Axes: -Z south (into the mountain, towards Airolo), +Z north (Göschenen), +X west, +Y up.
// The north portal of the road tunnel is at z = 0.

export const TUNNEL = {
  halfWidth: 5,
  wallHeight: 4.0, // vertical wall, then a short haunch to the flat intermediate ceiling (ventilation ducts above)
  apex: 4.8,
  roadHalf: 3.9,
  zEnd: -700, // geometry end (dark beyond the barricade)
  walkEnd: -600,
};

export const GALLERY = {
  x: 30,
  halfWidth: 1.8,
  wallHeight: 2.6,
  apex: 3.4,
  zEnd: -620,
  walkEnd: -600,
};

export const PASSAGE = { halfWidth: 1.5, height: 2.4 };
export const CROSS_PASSAGES = [-150, -300, -450];

export const VENT_ROOM = { x0: -14, x1: TUNNEL.halfWidth * -1, z0: -490, z1: -470, door0: -483, door1: -477, height: 4, doorHeight: 3.5 };

export const PLAZA = { x0: -60, x1: 60, z0: 0, z1: 230 };
export const FACADE = { x0: -48, x1: 48, depth: 9, height: 24 }; // x aligned with the 8 m terrain grid

export type VehicleKind = 'car' | 'van' | 'truck' | 'police' | 'duro' | 'puch';
export interface VehicleSpec { kind: VehicleKind; x: number; z: number; rot: number; color?: number }

// Rotation 0 = vehicle nose pointing -Z (southbound, into the tunnel).
export const VEHICLES: VehicleSpec[] = [
  // Outside: police block, army vehicles at the assembly area
  { kind: 'police', x: -6, z: 34, rot: 0.9 },
  { kind: 'police', x: 7, z: 38, rot: -0.7 },
  { kind: 'duro', x: -26, z: 92, rot: 0.1 },
  { kind: 'duro', x: -18, z: 96, rot: 0.15 },
  { kind: 'puch', x: -10, z: 88, rot: -0.2 },
  { kind: 'car', x: 20, z: 140, rot: Math.PI, color: 0x8a8f96 },
  { kind: 'truck', x: 16, z: 170, rot: Math.PI },
  // Inside: traffic stopped after the incident (southbound lane x<0, northbound x>0)
  { kind: 'car', x: -2.0, z: -96, rot: 0.05, color: 0x2a4a7a },
  { kind: 'van', x: 2.1, z: -128, rot: Math.PI - 0.08 },
  { kind: 'car', x: -1.9, z: -182, rot: -0.12, color: 0xb0b4b8 },
  { kind: 'car', x: 1.8, z: -205, rot: Math.PI + 0.2, color: 0x7a1d1d },
  { kind: 'car', x: -2.2, z: -238, rot: 0.3, color: 0x1d1d1f },
  { kind: 'car', x: 2.0, z: -262, rot: Math.PI, color: 0xd8d4c8 },
  { kind: 'truck', x: -1.2, z: -318, rot: 0.42 },
  { kind: 'car', x: 2.1, z: -352, rot: Math.PI - 0.1, color: 0x3d5a3a },
  { kind: 'van', x: -2.0, z: -420, rot: 0.15 },
  { kind: 'car', x: 2.0, z: -505, rot: Math.PI + 0.35, color: 0x6a6f75 },
];

export const VEHICLE_DIMS: Record<VehicleKind, { w: number; l: number; h: number; tall: boolean }> = {
  car: { w: 1.85, l: 4.5, h: 1.45, tall: false },
  police: { w: 1.9, l: 4.8, h: 1.5, tall: false },
  van: { w: 2.0, l: 5.4, h: 2.4, tall: true },
  truck: { w: 2.5, l: 13.5, h: 3.8, tall: true },
  duro: { w: 2.2, l: 6.6, h: 2.9, tall: true },
  puch: { w: 1.8, l: 4.4, h: 2.0, tall: false },
};

/** Static blocking boxes outside of vehicles: [cx, cz, halfW, halfD, rot, tall]. */
export const BLOCKS: Array<[number, number, number, number, number, boolean]> = [
  // Betriebszentrale (operations building)
  [-42, 48, 9, 14, 0, true],
  // Jersey barriers at the checkpoint
  [-1.5, 24, 2.5, 0.35, 0, false],
  [4.5, 24, 2.5, 0.35, 0, false],
  // Barricade at the sector limit inside the tunnel
  [-2.6, -596, 2.4, 0.4, 0, false],
  [2.6, -597, 2.4, 0.4, 0.05, false],
  // Ventilation control cabinets
  [-12.8, -480, 0.6, 3.5, 0, true],
  // Portal traffic light posts
  [-4.8, 4, 0.2, 0.2, 0, true],
  [4.8, 4, 0.2, 0.2, 0, true],
];

export interface Vec2 { x: number; z: number }

export const POINTS = {
  playerStart: { x: 2, z: 70 },
  assembly: { x: -14, z: 78 },
  checkpoint: { x: 1.5, z: 28 },
  portal: { x: 0, z: 6 },
  galleryPortal: { x: 30, z: 6 },
  ventRoom: { x: -9.5, z: -480 },
  safeGallery: CROSS_PASSAGES.map((z) => ({ x: GALLERY.x, z })),
};

export interface EnemySpec { x: number; z: number; face: number; cell: string; fallback?: Vec2 }
export const ENEMIES: EnemySpec[] = [
  // Cell A: behind the jack-knifed truck at Querschlag 2
  { x: -3.4, z: -326, face: 0, cell: 'A', fallback: { x: 3.5, z: -372 } },
  { x: 3.6, z: -312, face: 0, cell: 'A', fallback: { x: -3.5, z: -380 } },
  { x: 0.5, z: -334, face: 0, cell: 'A' },
  // Cell B: in the safety gallery
  { x: 30.4, z: -322, face: 0, cell: 'B', fallback: { x: 30, z: -380 } },
  { x: 29.4, z: -338, face: 0, cell: 'B' },
  // Cell C: at the ventilation room (the sabotage charge)
  { x: -3.6, z: -471, face: 0, cell: 'C' },
  { x: -10, z: -486, face: 0.6, cell: 'C' },
  { x: 3.4, z: -490, face: 0, cell: 'C' },
];

export const CIVILIANS: Vec2[] = [
  { x: -3.9, z: -180 },
  { x: -0.2, z: -184 },
  { x: 3.6, z: -207 },
  { x: -4.0, z: -236 },
  { x: 0.2, z: -264 },
  { x: 3.9, z: -258 },
];

export function insideTunnel(x: number, z: number): boolean {
  return z < -0.5 && x < 40;
}

/** 0 outside .. 1 well inside (used for exposure, fog and light blending). */
export function insideness(x: number, z: number): number {
  if (!insideTunnel(x, z)) return 0;
  return Math.min(1, -z / 35);
}

/** Human-readable location for radio traffic. */
export function describeLocation(x: number, z: number): string {
  if (z > 0.5) {
    if (z < 35 && Math.abs(x) < 20) return 'Kontrollposten Portal';
    if (x < -25) return 'Betriebszentrale';
    return 'Vorplatz Nordportal';
  }
  if (x < -5.5 && z < VENT_ROOM.z1 + 1 && z > VENT_ROOM.z0 - 1) return 'Lüftungszentrale';
  const m = Math.round(-z / 10) * 10;
  for (let i = 0; i < CROSS_PASSAGES.length; i++) {
    const c = CROSS_PASSAGES[i];
    if (Math.abs(z - c) < 15 && x > 3) return `Querschlag ${i + 1}`;
  }
  if (x > GALLERY.x - GALLERY.halfWidth - 0.5) return `Sicherheitsstollen ${m} m`;
  return `Strassentunnel ${m} m`;
}
