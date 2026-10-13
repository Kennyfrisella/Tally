import * as THREE from 'three';
import type { Actor, GameCtx, GameEventType } from '../actors/actor';
import { Enemy } from '../actors/enemy';
import { Civilian } from '../actors/civilian';
import { Soldier } from '../actors/soldier';
import type { Gruppe } from '../command/platoon';
import { POINTS } from '../world/layout';
import type { Plan } from './plan';
import { reviewPlan } from './plan';

// Operation RIEGEL: objectives, scripted radio traffic from the company commander, SITREPs and the AAR score.

export interface Objective { id: string; title: string; done: boolean; failed: boolean; progress?: string; marker?: { x: number; z: number } }

export interface SitrepOption { text: string; accurate: boolean }

export interface Stats {
  kills: number; arrests: number; surrenders: number; civHit: number; civKilled: number; friendlyFire: number;
  roe: number; wounded: number; kia: number; treated: number; evacuated: number; orderConflicts: number;
  sitrepAsked: number; sitrepOnTime: number; sitrepAccurate: number; ordersIssued: number;
}

export interface Debrief {
  success: boolean;
  reason: string;
  total: number;
  grade: string;
  gradeText: string;
  categories: Array<{ name: string; score: number; weight: number; notes: string[] }>;
  stats: Stats;
  time: number;
  points: number;
}

export class Scenario {
  objectives: Objective[];
  stats: Stats = {
    kills: 0, arrests: 0, surrenders: 0, civHit: 0, civKilled: 0, friendlyFire: 0, roe: 0, wounded: 0, kia: 0, treated: 0,
    evacuated: 0, orderConflicts: 0, sitrepAsked: 0, sitrepOnTime: 0, sitrepAccurate: 0, ordersIssued: 0,
  };
  chargeTimer = -1; // seconds left once armed
  chargeExploded = false;
  chargeSecured = false;
  sitrepDue = -1; // time by which the report must be given
  private sitrepTimes = [170, 470];
  private checkpointHeld = 0;
  private scripted = new Set<string>();
  ended: Debrief | null = null;
  firstContact = false;

  constructor(private plan: Plan, private enemies: Enemy[], private civilians: Civilian[], private groups: Gruppe[]) {
    this.objectives = [
      { id: 'portal', title: 'Kontrollposten Portal sichern', done: false, failed: false, marker: POINTS.checkpoint },
      { id: 'evac', title: 'Zivilpersonen evakuieren', done: false, failed: false, marker: { x: 0, z: -220 } },
      { id: 'enemy', title: 'Saboteure neutralisieren', done: false, failed: false, marker: { x: 0, z: -320 } },
      { id: 'vent', title: 'Lüftungszentrale sichern', done: false, failed: false, marker: POINTS.ventRoom },
    ];
  }

  get bleedFactor() { return this.plan.measures.includes('medic') ? 2 : 1; }

  onEvent(ctx: GameCtx, type: GameEventType, data: Record<string, unknown> = {}) {
    const s = this.stats;
    switch (type) {
      case 'kill': s.kills++; break;
      case 'surrender':
        s.surrenders++;
        ctx.radio('Riegel', 'Person ergibt sich! Nicht schiessen!', 'warn');
        break;
      case 'arrest': s.arrests++; break;
      case 'wounded': s.wounded++; break;
      case 'kia': s.kia++; break;
      case 'treated': s.treated++; break;
      case 'evacuated': s.evacuated++; break;
      case 'civHit': s.civHit++; break;
      case 'friendlyFire': s.friendlyFire++; break;
      case 'roeViolation': s.roe++; break;
      case 'orderConflict': s.orderConflicts++; break;
      case 'cleared': {
        const x = data.x as number, z = data.z as number;
        const inRoom = Math.hypot(x - POINTS.ventRoom.x, z - POINTS.ventRoom.z) < 14;
        if (inRoom && !this.chargeSecured && !this.chargeExploded && this.enemies.every((e) => e.status !== 'ok' || e.distTo(POINTS.ventRoom) > 25)) {
          const g = data.gruppe as Gruppe;
          setTimeout(() => {
            if (this.chargeSecured || this.chargeExploded) return;
            ctx.radio(g.callsign, 'Sprengladung gefunden. Zündkabel nach Anweisung Kapo getrennt.', 'info');
            ctx.event('chargeSecured');
          }, 6000);
        }
        break;
      }
      case 'contact':
        if (!this.firstContact) {
          this.firstContact = true;
          setTimeout(() => ctx.radio('Bastion', 'Riegel, hier Bastion. Kontaktmeldung erhalten. Verhältnismässigkeit wahren – Festnahme vor Wirkung.', 'cmd'), 4000);
        }
        break;
      case 'chargeArmed':
        if (this.chargeTimer < 0 && !this.chargeSecured) {
          this.chargeTimer = 240;
          ctx.radio('Bastion', 'Riegel, Kapo meldet: Zündmechanismus in der Lüftungszentrale aktiviert! Sie haben 4 Minuten. Höchste Priorität!', 'warn');
          ctx.audio.say('Achtung. Sprengladung aktiviert. Vier Minuten.', 1.05, 0.9);
        }
        break;
      case 'chargeSecured':
        this.chargeSecured = true;
        this.chargeTimer = -1;
        ctx.radio('Riegel', 'Sprengladung gesichert. Lüftungszentrale in eigener Hand.', 'info');
        break;
    }
    void data;
  }

  /** Scripted traffic and objective evaluation. */
  update(dt: number, ctx: GameCtx) {
    const t = ctx.time;
    const once = (id: string, at: number, fn: () => void) => { if (t >= at && !this.scripted.has(id)) { this.scripted.add(id); fn(); } };
    once('intro', 2, () => ctx.radio('Bastion', 'Riegel, hier Bastion. Befehl bestätigt. Sie haben Handlungsfreiheit im Sektor Nordportal. Kommen.', 'cmd'));
    once('kapo', 14, () => ctx.radio('Kapo Uri', 'Sechs Personen sind noch in ihren Fahrzeugen zwischen 180 und 270 Meter eingeschlossen.', 'info'));
    if (!this.plan.measures.includes('block')) once('traffic', 75, () => ctx.radio('Kapo Uri', 'Zivilverkehr staut sich bis Göschenen zurück! Wir haben zu wenig Leute für die Umleitung!', 'warn'));
    if (this.plan.measures.includes('recon')) once('drone', 20, () => ctx.radio('Kapo Uri', 'Drohne meldet: mindestens drei Wärmesignaturen beim Lastwagen auf Höhe Querschlag 2.', 'info'));

    // SITREP requests
    for (const st of this.sitrepTimes) {
      once(`sitrep${st}`, st, () => {
        this.sitrepDue = t + 45;
        this.stats.sitrepAsked++;
        ctx.radio('Bastion', 'Riegel, hier Bastion. Melden Sie Lage! [T] drücken', 'cmd');
        ctx.audio.say('Riegel, hier Bastion. Melden Sie Lage.', 1.0, 0.85);
      });
    }
    if (this.sitrepDue > 0 && t > this.sitrepDue) {
      this.sitrepDue = -1;
      ctx.radio('Bastion', 'Riegel, ich habe keine Meldung erhalten. Ich erwarte Meldungen unaufgefordert!', 'warn');
    }

    // Charge countdown
    if (this.chargeTimer > 0) {
      this.chargeTimer -= dt;
      if (this.chargeTimer <= 0) {
        this.chargeTimer = -1;
        this.chargeExploded = true;
        ctx.radio('Bastion', 'Explosion in der Lüftungszentrale gemeldet! Ventilation Nord ausgefallen.', 'warn');
        ctx.audio.shot(-10, -480, 'enemy');
        ctx.audio.shot(-10, -480, 'enemy');
        const c = new THREE.Vector3(-10, 1.5, -480);
        ctx.env.flash(c, 900);
        for (let i = 0; i < 12; i++) ctx.effects.impact(c, new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5), 'concrete');
        // anybody close gets hurt
        for (const a of ctx.actors) if (a.status === 'ok' && a.distTo({ x: -10, z: -480 }) < 12) a.takeDamage(ctx, 140, null);
      }
    }

    // Objectives
    const [oPortal, oEvac, oEnemy, oVent] = this.objectives;
    if (!oPortal.done) {
      const near = ctx.actors.filter((a) => a instanceof Soldier && a.active && a.distTo(POINTS.checkpoint) < 20).length;
      if (near >= 3) this.checkpointHeld += dt;
      oPortal.progress = `${Math.min(100, Math.round((this.checkpointHeld / 12) * 100))}%`;
      if (this.checkpointHeld > 12) {
        oPortal.done = true;
        ctx.radio(this.groupAt(POINTS.checkpoint)?.callsign ?? 'Riegel', 'Kontrollposten Portal bezogen. Zugang unter Kontrolle.', 'info');
      }
    }
    const civAlive = this.civilians.filter((c) => c.status !== 'dead');
    const evac = this.civilians.filter((c) => c.status === 'evacuated').length;
    oEvac.progress = `${evac}/${this.civilians.length}`;
    oEvac.done = civAlive.length > 0 && civAlive.every((c) => c.status === 'evacuated');
    oEvac.failed = civAlive.length === 0;
    const neutral = this.enemies.filter((e) => e.status !== 'ok').length;
    oEnemy.progress = `${neutral}/${this.enemies.length}`;
    oEnemy.done = neutral === this.enemies.length;
    const nextEnemy = this.enemies.find((e) => e.status === 'ok' && t - e.spottedAt < 30);
    oEnemy.marker = nextEnemy ? { x: nextEnemy.pos.x, z: nextEnemy.pos.z } : { x: 0, z: -320 };
    oVent.done = this.chargeSecured;
    oVent.failed = this.chargeExploded;
    if (this.chargeTimer > 0) oVent.progress = `${Math.floor(this.chargeTimer / 60)}:${String(Math.floor(this.chargeTimer % 60)).padStart(2, '0')}`;
    else oVent.progress = undefined;
    const nextCiv = civAlive.find((c) => c.status === 'ok');
    oEvac.marker = nextCiv ? { x: nextCiv.pos.x, z: nextCiv.pos.z } : undefined;
  }

  private groupAt(p: { x: number; z: number }): Gruppe | undefined {
    return this.groups.find((g) => g.leader && g.leader.distTo(p) < 25);
  }

  /** Builds three report options; exactly one matches the actual situation. */
  sitrepOptions(): SitrepOption[] {
    const neutral = this.enemies.filter((e) => e.status !== 'ok').length;
    const evac = this.stats.evacuated;
    const losses = this.stats.kia + this.stats.wounded;
    const accurate = `Bastion, hier Riegel: ${neutral} von ${this.enemies.length} Saboteuren neutralisiert, ${evac} Zivilpersonen evakuiert, eigene Ausfälle: ${losses}. Lüftungszentrale ${this.chargeSecured ? 'gesichert' : 'noch nicht in eigener Hand'}. Weiterhin im Einsatz.`;
    const optimistic = `Bastion, hier Riegel: Lage unter Kontrolle, ${Math.min(this.enemies.length, neutral + 3)} Saboteure neutralisiert, alle Zivilpersonen in Sicherheit, keine Ausfälle.`;
    const vague = 'Bastion, hier Riegel: Wir sind dran. Melde später. Schluss.';
    const opts: SitrepOption[] = [
      { text: accurate, accurate: true },
      { text: optimistic, accurate: false },
      { text: vague, accurate: false },
    ];
    return opts.sort(() => Math.random() - 0.5);
  }

  answerSitrep(ctx: GameCtx, opt: SitrepOption) {
    if (this.sitrepDue > 0) this.stats.sitrepOnTime++;
    this.sitrepDue = -1;
    if (opt.accurate) {
      this.stats.sitrepAccurate++;
      ctx.radio('Bastion', 'Verstanden, Riegel. Gute Meldung. Weitermachen.', 'cmd');
    } else {
      ctx.radio('Bastion', 'Riegel, Ihre Meldung deckt sich nicht mit dem Lagebild der Kapo. Präzise melden!', 'warn');
    }
  }

  checkEnd(ctx: GameCtx, player: Actor): Debrief | null {
    if (this.ended) return this.ended;
    if (player.status !== 'ok') return this.finish(ctx, false, 'Der Zugführer ist ausgefallen. Die Führung des Zuges brach zusammen.');
    if (this.stats.kia >= 10) return this.finish(ctx, false, 'Bastion bricht den Einsatz wegen zu hoher Verluste ab.');
    if (this.stats.civKilled >= 3) return this.finish(ctx, false, 'Mehrere Zivilpersonen getötet. Der Einsatz wird abgebrochen.');
    const [, oEvac, oEnemy, oVent] = this.objectives;
    const ventDone = oVent.done || oVent.failed;
    if ((oEvac.done || oEvac.failed) && oEnemy.done && ventDone) {
      const ok = !oVent.failed && oEvac.done;
      return this.finish(ctx, ok, ok ? 'Auftrag erfüllt. Der Sektor Nordportal ist gesichert.' : 'Sektor gesichert, aber der Auftrag wurde nur teilweise erfüllt.');
    }
    return null;
  }

  finish(ctx: GameCtx, success: boolean, reason: string): Debrief {
    const s = this.stats;
    const [oPortal, oEvac, oEnemy, oVent] = this.objectives;
    const cats: Debrief['categories'] = [];

    // Auftrag
    {
      const notes: string[] = [];
      const neutral = this.enemies.filter((e) => e.status !== 'ok').length;
      let sc = 0;
      if (oPortal.done) sc += 15; else notes.push('Portal nie ausreichend gesichert.');
      sc += 30 * (s.evacuated / this.civilians.length);
      sc += 30 * (neutral / this.enemies.length);
      if (oVent.done) sc += 25; else notes.push(oVent.failed ? 'Sprengladung detoniert – Lüftung Nord zerstört.' : 'Lüftungszentrale nicht gesichert.');
      if (oEvac.done) notes.push('Alle überlebenden Zivilpersonen evakuiert.');
      if (oEnemy.done) notes.push(`Alle Saboteure neutralisiert (${s.arrests} festgenommen, ${s.kills} getötet).`);
      cats.push({ name: 'Auftragserfüllung', score: Math.round(sc), weight: 0.35, notes });
    }
    // Planung
    {
      const r = reviewPlan(this.plan);
      cats.push({ name: 'Planung & Befehlsgebung', score: r.score, weight: 0.15, notes: r.notes });
    }
    // Truppe
    {
      const notes: string[] = [];
      const avgMorale = this.groups.reduce((a, g) => a + g.morale, 0) / this.groups.length;
      let sc = 100 - s.kia * 14 - s.wounded * 4 + s.treated * 4;
      sc = sc * 0.8 + avgMorale * 0.2;
      if (s.kia) notes.push(`${s.kia} Angehörige gefallen.`);
      if (s.wounded) notes.push(`${s.wounded} verwundet, ${s.treated} versorgt.`);
      if (s.wounded > s.treated) notes.push('Nicht alle Verwundeten wurden versorgt – Fürsorge ist Führungsaufgabe.');
      notes.push(`Durchschnittliche Moral am Schluss: ${Math.round(avgMorale)}%.`);
      cats.push({ name: 'Truppe & Fürsorge', score: Math.round(Math.max(0, Math.min(100, sc))), weight: 0.2, notes });
    }
    // ROE
    {
      const notes: string[] = [];
      let sc = 70 + Math.min(30, s.arrests * 8) - s.civHit * 35 - s.roe * 25 - s.friendlyFire * 10 - Math.max(0, s.kills - s.arrests) * 3;
      if (s.civHit) notes.push(`${s.civHit} Treffer auf Zivilpersonen.`);
      if (s.roe) notes.push(`${s.roe} Verstösse gegen die Einsatzregeln (z.B. Feuer auf Personen, die sich ergeben haben).`);
      if (s.friendlyFire) notes.push(`${s.friendlyFire} Treffer auf eigene Truppe.`);
      if (s.arrests) notes.push(`${s.arrests} Festnahmen – verhältnismässiges Vorgehen.`);
      if (!s.civHit && !s.roe) notes.push('Einsatzregeln eingehalten.');
      cats.push({ name: 'Einsatzregeln & Verhältnismässigkeit', score: Math.round(Math.max(0, Math.min(100, sc))), weight: 0.2, notes });
    }
    // Kommunikation
    {
      const notes: string[] = [];
      let sc = 40;
      if (s.sitrepAsked) sc = 100 * (0.5 * s.sitrepOnTime + 0.5 * s.sitrepAccurate) / s.sitrepAsked;
      sc -= s.orderConflicts * 6;
      if (s.sitrepAsked && s.sitrepOnTime < s.sitrepAsked) notes.push('Lagemeldungen an den Kp Kdt verspätet oder ausgeblieben.');
      if (s.sitrepAccurate < s.sitrepOnTime) notes.push('Meldungen waren ungenau. Melden Sie, was ist – nicht, was sein sollte.');
      if (s.orderConflicts) notes.push(`${s.orderConflicts}× Befehl–Gegenbefehl. «Befehl, Gegenbefehl, Unordnung.»`);
      notes.push(`${s.ordersIssued} Befehle erteilt.`);
      cats.push({ name: 'Kommunikation & Meldewesen', score: Math.round(Math.max(0, Math.min(100, sc))), weight: 0.1, notes });
    }
    let total = cats.reduce((a, c) => a + c.score * c.weight, 0);
    if (!success) total = Math.min(total, 54);
    total = Math.round(total);
    const [grade, gradeText] = total >= 85 ? ['A', 'Ausgezeichnet'] : total >= 70 ? ['B', 'Gut'] : total >= 55 ? ['C', 'Genügend'] : total >= 40 ? ['D', 'Ungenügend'] : ['E', 'Nicht bestanden'];
    this.ended = { success, reason, total, grade, gradeText, categories: cats, stats: { ...s }, time: ctx.time, points: Math.max(0, Math.floor(total / 25)) };
    return this.ended;
  }
}
