// The Lt's planning decisions from the briefing (Führungsrhythmus): immediate measures, decision, orders.

export type MeasureId = 'block' | 'medic' | 'recon' | 'power';
export type RoleId = 'portal' | 'road' | 'gallery' | 'evac' | 'reserve';

export interface Plan {
  measures: MeasureId[];
  variant: 'A' | 'B';
  roles: Record<number, RoleId>;
  roe: 'hold' | 'free';
}

export const MEASURES: Record<MeasureId, { title: string; desc: string; effect: string }> = {
  block: { title: 'Zufahrt A2 sperren', desc: 'Kantonspolizei Uri sperrt die A2 ab Göschenen und die Kantonsstrasse.', effect: 'Kein Zivilverkehr staut sich am Portal.' },
  medic: { title: 'Sanität bereitstellen', desc: 'Rettungsdienst Uri und Truppensanität stehen am Portal bereit.', effect: 'Verwundete überleben doppelt so lange ohne Versorgung.' },
  recon: { title: 'Aufklärung mit Drohne', desc: 'Eine Wärmebilddrohne der Kantonspolizei fliegt durch das Portal ein.', effect: 'Gegnerische Positionen bei Querschlag 2 werden zu Beginn markiert.' },
  power: { title: 'Notstrom aufschalten', desc: 'Betriebszentrale schaltet die Notbeleuchtung auf Reservenetz.', effect: 'Flackernde Leuchten stabil, bessere Sicht im Tunnel.' },
};

export const ROLES: Record<RoleId, { title: string; task: string }> = {
  portal: { title: 'Sicherung Portal', task: 'sichert den Kontrollposten am Nordportal und kontrolliert den Zugang.' },
  road: { title: 'Vorstoss Strassentunnel', task: 'stösst im Strassentunnel bis Querschlag 1 vor und hält dort.' },
  gallery: { title: 'Vorstoss Sicherheitsstollen', task: 'stösst im Sicherheitsstollen vor und deckt die Querschläge.' },
  evac: { title: 'Evakuation', task: 'folgt dem Vorstoss und evakuiert Zivilpersonen in den Sicherheitsstollen.' },
  reserve: { title: 'Reserve', task: 'hält sich als Reserve beim Vorplatz bereit.' },
};

export const DEFAULT_PLAN: Plan = {
  measures: ['block', 'medic'],
  variant: 'A',
  roles: { 1: 'portal', 2: 'road', 3: 'road', 4: 'evac', 5: 'reserve' },
  roe: 'hold',
};

export interface PlanReview { score: number; notes: string[] }

/** Doctrine check of the plan; feeds the "Planung" grade in the debriefing. */
export function reviewPlan(p: Plan): PlanReview {
  const notes: string[] = [];
  let score = 0;
  const count = (r: RoleId) => Object.values(p.roles).filter((x) => x === r).length;
  if (count('portal') >= 1) score += 18; else notes.push('Kein Element sichert das Portal – Ihr Rücken war offen.');
  if (count('reserve') >= 1) score += 18; else notes.push('Keine Reserve ausgeschieden. Ohne Reserve keine Handlungsfreiheit.');
  if (count('evac') >= 1) score += 16; else notes.push('Evakuation nicht geplant – Schutz der Zivilbevölkerung hat Priorität.');
  if (count('road') >= 1 && count('gallery') >= 1) score += 12; else notes.push('Nur eine Achse geplant – Stollen bzw. Tunnel blieb ungedeckt.');
  if ((p.variant === 'A' && count('road') >= 2) || (p.variant === 'B' && count('gallery') >= 2)) score += 12;
  else notes.push(`Der Entschluss (Variante ${p.variant}) und die Kräftezuteilung passen nicht zusammen: Hauptanstrengung braucht Kräfte.`);
  if (p.roe === 'hold') score += 14; else notes.push('«Feuer frei» ist im subsidiären Einsatz unverhältnismässig. Feuer nur in Notwehr/Notwehrhilfe.');
  if (p.measures.includes('block')) score += 10; else notes.push('Zufahrt nicht gesperrt: Zivilverkehr staute sich am Portal.');
  if (score >= 90) notes.unshift('Planung entspricht der Doktrin. Klarer Entschluss, Reserve ausgeschieden.');
  return { score: Math.min(100, score), notes };
}
