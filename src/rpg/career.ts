// Persistent career of the Leutnant: attribute points earned from mission grades.

export interface Attrs { fuehrung: number; uebersicht: number; fuersorge: number; schiessen: number }

export interface Career {
  name: string;
  missions: number;
  bestGrade: string;
  points: number;
  attrs: Attrs;
  history: Array<{ date: string; grade: string; score: number }>;
}

export const ATTR_INFO: Record<keyof Attrs, { label: string; desc: string }> = {
  fuehrung: { label: 'Führung', desc: 'Gruppen reagieren schneller auf Befehle.' },
  uebersicht: { label: 'Übersicht', desc: 'Grössere Minikarte, gegnerische Positionen bleiben länger markiert.' },
  fuersorge: { label: 'Fürsorge', desc: 'Moral der Truppe erholt sich schneller in Ihrer Nähe.' },
  schiessen: { label: 'Schiessen', desc: 'Geringere Streuung mit dem Stgw 90.' },
};

const KEY = 'gotthard.career.v1';

export function loadCareer(): Career {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Career;
  } catch { /* ignore */ }
  return { name: 'Lt Muster', missions: 0, bestGrade: '–', points: 1, attrs: { fuehrung: 0, uebersicht: 0, fuersorge: 0, schiessen: 0 }, history: [] };
}

export function saveCareer(c: Career) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
}
