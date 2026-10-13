import './ui/styles.css';
import * as THREE from 'three';
import { Game } from './game';
import { PRESETS, QualityLevel, detectQuality, saveQuality } from './engine/quality';
import { runBriefing } from './ui/briefing';
import { ATTR_INFO, Attrs, loadCareer, saveCareer } from './rpg/career';
import type { Debrief } from './rpg/scenario';

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;
let level: QualityLevel = detectQuality();
const career = loadCareer();

const QUALITY_LABEL: Record<QualityLevel, string> = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch' };

function screen(cls: string, html: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = `screen ${cls}`;
  d.innerHTML = html;
  ui.appendChild(d);
  return d;
}

const CONTROLS = `
  <div class="keys">
    <span><kbd>W A S D</kbd></span><span>Bewegen · <kbd>Shift</kbd> Rennen · <kbd>C</kbd> Knien</span>
    <span><kbd>Maus L</kbd></span><span>Feuer · <kbd>Maus R</kbd> Zielen · <kbd>R</kbd> Nachladen · <kbd>N</kbd> Einzel/Serie · <kbd>L</kbd> Lampe</span>
    <span><kbd>1</kbd>–<kbd>5</kbd></span><span>Gruppe wählen (<kbd>Shift</kbd> = hinzufügen) · <kbd>0</kbd> ganzer Zug</span>
    <span><kbd>Q</kbd> / <kbd>Maus M</kbd></span><span>Verschieben zum Punkt unter dem Fadenkreuz</span>
    <span><kbd>X</kbd></span><span>Halten / Sichern in Blickrichtung</span>
    <span><kbd>F</kbd></span><span>Folgen (Gruppe schliesst hinter Ihnen auf)</span>
    <span><kbd>V</kbd></span><span>Durchsuchen / Säubern um den Zielpunkt</span>
    <span><kbd>B</kbd></span><span>Evakuieren: Zivilpersonen beim Zielpunkt in Sicherheit bringen</span>
    <span><kbd>G</kbd></span><span>Feuer frei ↔ Feuer nur in Notwehr</span>
    <span><kbd>H</kbd></span><span>Anruf «Halt! Armee!» – bewegt Gegner zur Aufgabe</span>
    <span><kbd>E</kbd></span><span>Interagieren: Zivilpersonen führen, Verwundete versorgen, festnehmen, Sprengladung sichern</span>
    <span><kbd>T</kbd></span><span>Lagemeldung an den Kp Kdt (Bastion)</span>
    <span><kbd>M</kbd></span><span>Taktische Karte (Rechtsklick = Befehl)</span>
    <span><kbd>Esc</kbd></span><span>Pause</span>
  </div>`;

function showLoading(text: string) {
  const d = document.createElement('div');
  d.className = 'loading';
  d.innerHTML = `<div>${text}</div><div class="bar"><i></i></div>`;
  document.body.appendChild(d);
  return d;
}

async function boot() {
  const loading = showLoading('Sektor Nordportal wird aufgebaut');
  await new Promise((r) => setTimeout(r, 60));
  let game: Game;
  try {
    game = new Game(app, PRESETS[level], career.attrs);
  } catch (e) {
    loading.innerHTML = `<div>WebGL konnte nicht gestartet werden.</div><div style="font-size:14px;letter-spacing:0">${String(e)}</div>`;
    throw e;
  }
  loading.remove();
  if (import.meta.env.DEV) Object.assign(window, { __game: game, __THREE: THREE });
  const loop = () => { game.frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  mainMenu(game);
}

function mainMenu(game: Game) {
  ui.innerHTML = '';
  const s = screen('dim', `
    <div class="menu">
      <div class="brand"><span class="flag"></span>Schweizer Armee · Wiederholungskurs</div>
      <div class="title">Gotthard</div>
      <div class="subtitle">Operation Riegel · Führung im Einsatz</div>
      <div class="menu-btns">
        <button class="mbtn" data-a="start">Einsatz beginnen<small>Lagebeurteilung, Entschluss, Befehl – dann führen Sie Ihren Zug.</small></button>
        <button class="mbtn" data-a="career">Laufbahn<small>${career.name} · ${career.missions} Einsätze · ${career.points} Punkte verfügbar</small></button>
        <button class="mbtn" data-a="controls">Steuerung</button>
        <button class="mbtn" data-a="gfx">Grafik: ${QUALITY_LABEL[level]}<small>Niedrig für Laptops mit integrierter Grafik</small></button>
        <button class="mbtn" data-a="voice">Sprachausgabe: ${game.audio.voice ? 'Ein' : 'Aus'}</button>
      </div>
    </div>
    <div class="foot">Fiktives Ausbildungsszenario. Kein offizielles Produkt der Schweizer Armee. Orte vereinfacht dargestellt.</div>`);
  s.querySelector<HTMLElement>('[data-a="start"]')!.onclick = () => { game.audio.init(); s.remove(); startMission(game); };
  s.querySelector<HTMLElement>('[data-a="career"]')!.onclick = () => { s.remove(); careerScreen(game); };
  s.querySelector<HTMLElement>('[data-a="controls"]')!.onclick = () => {
    s.remove();
    const c = screen('solid', `<div class="wrap"><div class="step">Steuerung</div><div class="h1">Tastenbelegung</div>${CONTROLS}<div class="row" style="margin-top:24px"><button class="btn primary">Zurück</button></div></div>`);
    c.querySelector('button')!.addEventListener('click', () => { c.remove(); mainMenu(game); });
  };
  s.querySelector<HTMLElement>('[data-a="gfx"]')!.onclick = () => {
    const order: QualityLevel[] = ['low', 'medium', 'high'];
    level = order[(order.indexOf(level) + 1) % 3];
    saveQuality(level);
    location.reload();
  };
  s.querySelector<HTMLElement>('[data-a="voice"]')!.onclick = () => { game.audio.voice = !game.audio.voice; mainMenu(game); };
}

function careerScreen(game: Game) {
  const render = () => {
    ui.innerHTML = '';
    const keys = Object.keys(ATTR_INFO) as Array<keyof Attrs>;
    const s = screen('solid', `
      <div class="wrap">
        <div class="step">Laufbahn</div>
        <div class="h1">${career.name}</div>
        <p class="lead">Einsätze: <b>${career.missions}</b> · Beste Qualifikation: <b>${career.bestGrade}</b> · Verfügbare Punkte: <b>${career.points}</b></p>
        <div class="panel">
          ${keys.map((k) => `
            <div class="attr">
              <div><b>${ATTR_INFO[k].label}</b></div>
              <div><div class="pips">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < career.attrs[k] ? 'on' : ''}"></i>`).join('')}</div><div style="color:#aab;font-size:15px;margin-top:4px">${ATTR_INFO[k].desc}</div></div>
              <button class="btn" data-k="${k}" ${career.points > 0 && career.attrs[k] < 5 ? '' : 'disabled'}>+1</button>
            </div>`).join('')}
        </div>
        ${career.history.length ? `<p class="lead" style="margin-top:20px">Letzte Einsätze: ${career.history.slice(-5).reverse().map((h) => `${h.date} – ${h.grade} (${h.score})`).join(' · ')}</p>` : ''}
        <div class="row" style="margin-top:22px"><button class="btn primary" data-a="back">Zurück</button></div>
      </div>`);
    s.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.onclick = () => {
      const k = b.dataset.k as keyof Attrs;
      if (career.points <= 0 || career.attrs[k] >= 5) return;
      career.points--; career.attrs[k]++;
      saveCareer(career);
      render();
    });
    s.querySelector<HTMLElement>('[data-a="back"]')!.onclick = () => mainMenu(game);
  };
  render();
}

async function startMission(game: Game) {
  ui.innerHTML = '';
  const plan = await runBriefing(ui, game.groups);
  game.start(plan);
  const go = screen('dim', `
    <div class="menu">
      <div class="step">Steuerung</div>
      <div class="h1">Zug Riegel bereit</div>
      <p class="lead">Ihre Gruppen verschieben gemäss Befehl. Wählen Sie Gruppen mit <span class="kbd">1</span>–<span class="kbd">5</span> und erteilen Sie Befehle auf den Punkt unter dem Fadenkreuz.</p>
      ${CONTROLS}
      <div class="row" style="margin-top:22px"><button class="btn primary">Klicken zum Beginnen</button></div>
    </div>`);
  go.querySelector('button')!.addEventListener('click', () => { go.remove(); game.lock(); });

  game.onPause = (p) => {
    if (!p) { ui.querySelector('.pause')?.remove(); return; }
    const ps = screen('solid pause', `
      <div class="menu">
        <div class="step">Pause</div><div class="h1">Operation Riegel</div>
        <div class="menu-btns">
          <button class="mbtn" data-a="resume">Weiter</button>
          <button class="mbtn" data-a="keys">Steuerung</button>
          <button class="mbtn" data-a="abort">Einsatz abbrechen</button>
        </div>
        <div class="keys-box" style="display:none;margin-top:20px">${CONTROLS}</div>
      </div>`);
    ps.querySelector<HTMLElement>('[data-a="resume"]')!.onclick = () => game.lock();
    ps.querySelector<HTMLElement>('[data-a="keys"]')!.onclick = () => { (ps.querySelector('.keys-box') as HTMLElement).style.display = 'block'; };
    ps.querySelector<HTMLElement>('[data-a="abort"]')!.onclick = () => { ps.remove(); game.setPaused(false); game.abort(); };
  };

  game.onEnd = (d) => debrief(game, d);

  // SITREP dialog on T (works while pointer-locked)
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyT' || game.mode !== 'play' || game.dialogOpen || game.paused || !game.input.locked) return;
    const opts = game.openSitrep();
    if (!opts) return;
    game.dialogOpen = true;
    game.input.unlock();
    const d = document.createElement('div');
    d.className = 'dialog panel';
    d.innerHTML = `<div class="step">Funk · Zugsnetz → Bastion</div><div class="h1" style="font-size:30px">Lagemeldung</div>
      <p style="color:#aab;margin:0 0 6px">Wählen Sie die Meldung, die Sie absetzen. Melden Sie, was ist.</p>
      ${opts.map((o, i) => `<button class="btn opt" data-i="${i}">${o.text}</button>`).join('')}`;
    document.body.appendChild(d);
    d.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => b.onclick = () => {
      game.answerSitrep(opts[Number(b.dataset.i)]);
      d.remove();
      game.dialogOpen = false;
      game.lock();
    });
  });
}

function debrief(game: Game, d: Debrief) {
  ui.innerHTML = '';
  career.missions++;
  career.points += d.points;
  const order = ['A', 'B', 'C', 'D', 'E'];
  if (career.bestGrade === '–' || order.indexOf(d.grade) < order.indexOf(career.bestGrade)) career.bestGrade = d.grade;
  career.history.push({ date: new Date().toLocaleDateString('de-CH'), grade: d.grade, score: d.total });
  saveCareer(career);
  const mm = Math.floor(d.time / 60), ss = Math.floor(d.time % 60);
  const s = screen('solid', `
    <div class="wrap">
      <div class="step">Einsatzbesprechung (AAR)</div>
      <div class="row" style="align-items:flex-end;gap:30px">
        <div class="grade ${d.grade}">${d.grade}</div>
        <div>
          <div class="h1" style="margin:0">${d.gradeText} · ${d.total}/100</div>
          <p class="lead" style="margin:6px 0">${d.reason}</p>
          <p style="color:#aab;margin:0">Einsatzdauer ${mm}:${String(ss).padStart(2, '0')} · ${d.stats.arrests} Festnahmen · ${d.stats.kills} getötet · ${d.stats.evacuated} evakuiert · ${d.stats.kia} gefallen · ${d.stats.wounded} verwundet</p>
        </div>
      </div>
      <div class="panel" style="margin-top:20px">
        ${d.categories.map((c) => `
          <div class="cat">
            <div class="ch"><span>${c.name} <span style="color:#889;font-weight:400;font-size:15px">(${Math.round(c.weight * 100)}%)</span></span><span>${c.score}</span></div>
            <div class="cb"><i style="width:${c.score}%"></i></div>
            <ul>${c.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
          </div>`).join('')}
      </div>
      <p class="lead">Laufbahn: <b>+${d.points}</b> Attributpunkte erhalten.</p>
      <div class="row"><button class="btn primary" data-a="again">Neuer Einsatz</button><button class="btn" data-a="career">Laufbahn</button></div>
    </div>`);
  s.querySelector<HTMLElement>('[data-a="again"]')!.onclick = () => location.reload();
  s.querySelector<HTMLElement>('[data-a="career"]')!.onclick = () => { careerScreen(game); };
}

boot();
