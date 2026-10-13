import type { Gruppe } from '../command/platoon';
import { DEFAULT_PLAN, MEASURES, MeasureId, Plan, ROLES, RoleId } from '../rpg/plan';

// The planning phase follows the Swiss Army "Führungsrhythmus":
// Problemerfassung → Sofortmassnahmen → Beurteilung der Lage / Entschluss → Befehlsgebung (5-Punkte-Befehl).

const SCHEMA = `
<svg class="schema" viewBox="0 0 900 230" xmlns="http://www.w3.org/2000/svg" font-family="Barlow Condensed, Arial" font-size="13">
  <rect x="0" y="0" width="900" height="230" fill="#0d1012"/>
  <!-- mountain -->
  <rect x="150" y="20" width="740" height="200" fill="#1a1d1b"/>
  <text x="790" y="40" fill="#6b706a">GOTTHARDMASSIV</text>
  <!-- plaza -->
  <rect x="20" y="60" width="130" height="120" fill="#2b3128"/>
  <text x="28" y="76" fill="#9aa39a">VORPLATZ</text>
  <text x="28" y="172" fill="#9aa39a">Bereitschaftsraum</text>
  <!-- road tunnel -->
  <rect x="150" y="128" width="720" height="20" fill="#5d6366"/>
  <text x="170" y="164" fill="#c9ced1">STRASSENTUNNEL (A2) → Airolo</text>
  <!-- gallery -->
  <rect x="150" y="70" width="720" height="10" fill="#4b5155"/>
  <text x="170" y="64" fill="#c9ced1">SICHERHEITSSTOLLEN</text>
  <!-- cross passages -->
  <rect x="330" y="80" width="8" height="48" fill="#3b8a5a"/><text x="318" y="100" fill="#5fd38a" transform="rotate(-90 318 100)">QS 1</text>
  <rect x="510" y="80" width="8" height="48" fill="#3b8a5a"/><text x="498" y="100" fill="#5fd38a" transform="rotate(-90 498 100)">QS 2</text>
  <rect x="690" y="80" width="8" height="48" fill="#3b8a5a"/><text x="678" y="100" fill="#5fd38a" transform="rotate(-90 678 100)">QS 3</text>
  <!-- vent room -->
  <rect x="720" y="148" width="26" height="30" fill="#5c5420"/><text x="752" y="176" fill="#f2d200">LÜFTUNGSZENTRALE</text>
  <!-- civilians -->
  <g fill="#fff"><circle cx="370" cy="134" r="3"/><circle cx="378" cy="141" r="3"/><circle cx="395" cy="136" r="3"/><circle cx="410" cy="142" r="3"/><circle cx="430" cy="135" r="3"/><circle cx="425" cy="143" r="3"/></g>
  <text x="365" y="122" fill="#fff">6 Zivilpersonen</text>
  <!-- suspected enemy -->
  <g fill="#ff4a3d"><path d="M520 138 l6 -6 l6 6 l-6 6z"/><path d="M528 75 l5 -5 l5 5 l-5 5z"/><path d="M706 138 l6 -6 l6 6 l-6 6z"/></g>
  <text x="540" y="122" fill="#ff7a6d">? Saboteure (Stärke unbekannt)</text>
  <!-- phase lines -->
  <g stroke="#ffb020" stroke-dasharray="5 4"><line x1="334" y1="22" x2="334" y2="218"/><line x1="514" y1="22" x2="514" y2="218"/><line x1="705" y1="22" x2="705" y2="218"/></g>
  <g fill="#ffb020"><text x="338" y="214">PL ALPHA</text><text x="518" y="214">PL BRAVO</text><text x="709" y="214">PL CHARLIE</text></g>
  <text x="20" y="215" fill="#6b706a">0 m</text><text x="840" y="215" fill="#6b706a">600 m</text>
</svg>`;

export function runBriefing(root: HTMLElement, groups: Gruppe[]): Promise<Plan> {
  const plan: Plan = JSON.parse(JSON.stringify(DEFAULT_PLAN));
  return new Promise((resolve) => {
    const scr = document.createElement('div');
    scr.className = 'screen dim';
    root.appendChild(scr);
    let step = 0;

    const render = () => {
      let body = '';
      const nav = (backOk: boolean, nextLabel: string, nextOk = true) => `
        <div class="row" style="margin-top:22px">
          ${backOk ? '<button class="btn" data-a="back">Zurück</button>' : ''}
          <button class="btn primary" data-a="next" ${nextOk ? '' : 'disabled'}>${nextLabel}</button>
        </div>`;
      if (step === 0) {
        body = `
          <div class="step">1 · Problemerfassung / Orientierung</div>
          <div class="h1">Operation RIEGEL</div>
          <p class="lead"><b>Lage:</b> 16:20 Uhr. Eine bewaffnete Gruppe hat den Gotthard-Strassentunnel bei Göschenen besetzt, die Beleuchtung teilweise sabotiert und in der Lüftungszentrale Nord eine Sprengladung deponiert. Der Verkehr steht; sechs Zivilpersonen sind zwischen 180 und 270 m in ihren Fahrzeugen eingeschlossen.</p>
          <p class="lead"><b>Auftrag Kp Kdt (Bastion):</b> Der Zug <b>Riegel</b> unterstützt die Kantonspolizei Uri subsidiär. Er sichert das Nordportal, evakuiert die Zivilpersonen, neutralisiert die Saboteure und sichert die Lüftungszentrale.</p>
          ${SCHEMA}
          <p class="lead" style="font-size:16px;color:#aab">Mittel: 5 Gruppen mit 32 AdA (Wm/Kpl als Gruppenführer, je ein Sanitäter), Stgw 90, Funk SE-235. Zeit bis Einsatzbeginn: 10 Minuten.</p>
          ${nav(false, 'Weiter: Sofortmassnahmen')}`;
      } else if (step === 1) {
        body = `
          <div class="step">2 · Sofortmassnahmen</div>
          <div class="h1">Was veranlassen Sie sofort?</div>
          <p class="lead">Wählen Sie <b>zwei</b> Sofortmassnahmen. Sie haben nicht für alles Zeit und Leute.</p>
          <div class="grid2">
            ${(Object.keys(MEASURES) as MeasureId[]).map((id) => `
              <div class="card ${plan.measures.includes(id) ? 'sel' : ''}" data-m="${id}">
                <h3>${MEASURES[id].title}</h3><p>${MEASURES[id].desc}</p><div class="fx">→ ${MEASURES[id].effect}</div>
              </div>`).join('')}
          </div>
          ${nav(true, 'Weiter: Entschluss', plan.measures.length === 2)}`;
      } else if (step === 2) {
        body = `
          <div class="step">3 · Beurteilung der Lage / Entschluss</div>
          <div class="h1">Wo liegt Ihre Hauptanstrengung?</div>
          <div class="grid2">
            <div class="card ${plan.variant === 'A' ? 'sel' : ''}" data-v="A">
              <h3>Variante A · Strassentunnel</h3>
              <p>Hauptanstrengung im Strassentunnel. Schnell bei den Zivilpersonen, Deckung hinter Fahrzeugen. Gegner erwartet den Angriff hier.</p>
              <div class="fx">Mind. 2 Gruppen «Vorstoss Strassentunnel»</div>
            </div>
            <div class="card ${plan.variant === 'B' ? 'sel' : ''}" data-v="B">
              <h3>Variante B · Sicherheitsstollen</h3>
              <p>Hauptanstrengung im Sicherheitsstollen. Überraschung über die Querschläge, aber enger Raum und längerer Weg.</p>
              <div class="fx">Mind. 2 Gruppen «Vorstoss Sicherheitsstollen»</div>
            </div>
          </div>
          <p class="lead"><b>Einsatzregeln (Feuereröffnung):</b></p>
          <div class="grid2">
            <div class="card ${plan.roe === 'hold' ? 'sel' : ''}" data-r="hold"><h3>Notwehr / Notwehrhilfe</h3><p>Feuer nur, wenn eigene Kräfte oder Dritte unmittelbar bedroht sind. Vor Waffeneinsatz: Anruf «Halt! Armee!».</p></div>
            <div class="card ${plan.roe === 'free' ? 'sel' : ''}" data-r="free"><h3>Feuer frei</h3><p>Feuer auf jede erkannte bewaffnete Person ohne Anruf.</p></div>
          </div>
          ${nav(true, 'Weiter: Befehlsgebung')}`;
      } else if (step === 3) {
        body = `
          <div class="step">4 · Befehlsgebung</div>
          <div class="h1">Aufträge an die Gruppen</div>
          <table class="order-table"><tr><th>Gruppe</th><th>Gruppenführer</th><th>Bestand</th><th>Auftrag</th></tr>
            ${groups.map((g) => `<tr>
              <td><span class="gdot" style="background:${g.color}"></span><b>${g.name}</b> (${g.callsign})</td>
              <td>${g.members[0].name}</td><td>${g.members.length}</td>
              <td><select data-g="${g.id}">${(Object.keys(ROLES) as RoleId[]).map((r) => `<option value="${r}" ${plan.roles[g.id] === r ? 'selected' : ''}>${ROLES[r].title}</option>`).join('')}</select></td>
            </tr>`).join('')}
          </table>
          <div class="befehl">${orderText(plan, groups)}</div>
          ${nav(true, 'Befehl erteilen – Einsatz beginnen')}`;
      }
      scr.innerHTML = `<div class="wrap">${body}</div>`;
      scr.querySelectorAll<HTMLElement>('[data-m]').forEach((c) => c.onclick = () => {
        const id = c.dataset.m as MeasureId;
        if (plan.measures.includes(id)) plan.measures = plan.measures.filter((x) => x !== id);
        else { plan.measures.push(id); if (plan.measures.length > 2) plan.measures.shift(); }
        render();
      });
      scr.querySelectorAll<HTMLElement>('[data-v]').forEach((c) => c.onclick = () => { plan.variant = c.dataset.v as 'A' | 'B'; render(); });
      scr.querySelectorAll<HTMLElement>('[data-r]').forEach((c) => c.onclick = () => { plan.roe = c.dataset.r as 'hold' | 'free'; render(); });
      scr.querySelectorAll<HTMLSelectElement>('select[data-g]').forEach((s) => s.onchange = () => { plan.roles[Number(s.dataset.g)] = s.value as RoleId; render(); });
      scr.querySelector<HTMLElement>('[data-a="back"]')?.addEventListener('click', () => { step--; render(); });
      scr.querySelector<HTMLElement>('[data-a="next"]')?.addEventListener('click', () => {
        if (step < 3) { step++; render(); scr.scrollTop = 0; } else { scr.remove(); resolve(plan); }
      });
    };
    render();
  });
}

/** Generates the 5-point order (Orientierung, Absicht, Aufträge, Besondere Anordnungen, Standorte). */
export function orderText(plan: Plan, groups: Gruppe[]): string {
  const main = plan.variant === 'A' ? 'im Strassentunnel' : 'im Sicherheitsstollen';
  return [
    '1. ORIENTIERUNG',
    '   Bewaffnete Gruppe im Strassentunnel Nord, Stärke unbekannt, vermutlich bei Querschlag 2',
    '   und in der Lüftungszentrale (Sprengladung). 6 Zivilpersonen eingeschlossen bei 180–270 m.',
    '   Kapo Uri sperrt das Portal; Bastion hält Reserve in Göschenen.',
    '',
    '2. ABSICHT',
    `   Ich will mit der Hauptanstrengung ${main} bis Querschlag 2 vorstossen, die Zivilpersonen`,
    '   über die Querschläge in den Sicherheitsstollen evakuieren, die Saboteure festnehmen',
    '   und anschliessend die Lüftungszentrale sichern.',
    '',
    '3. AUFTRÄGE',
    ...groups.map((g) => `   ${g.name} (${g.callsign}) ${ROLES[plan.roles[g.id]].task}`),
    '',
    '4. BESONDERE ANORDNUNGEN',
    plan.roe === 'hold'
      ? '   Feuereröffnung nur in Notwehr/Notwehrhilfe. Vor Waffeneinsatz Anruf «Halt! Armee!».'
      : '   Feuer frei auf erkannte bewaffnete Personen.',
    '   Festnahme vor Wirkung. Personen, die sich ergeben, werden nicht beschossen.',
    `   Sofortmassnahmen: ${plan.measures.map((m) => MEASURES[m].title).join(', ')}.`,
    '   Phasenlinien: ALPHA = QS 1, BRAVO = QS 2, CHARLIE = Lüftungszentrale.',
    '   Verwundetennest beim Kontrollposten Portal.',
    '',
    '5. STANDORTE',
    '   Zfhr (Riegel) bei der Hauptanstrengung. Funk: Zugsnetz, Rufname «Riegel».',
    '   Kp Kdt (Bastion): Kommandoposten Göschenen.',
  ].join('\n');
}
