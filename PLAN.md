# GOTTHARD — Plan

A browser-based, first-person 3D tactical RPG. The player is a **Leutnant (Zugführer)** of the Swiss Armed Forces
leading a platoon during a **Wiederholungskurs (WK)** at the **Gotthard road tunnel, north portal (Göschenen, UR)**.

## 1. Product goal

| | |
|---|---|
| **Audience** | Cadres (Lt, Hptm, Wm, Kpl) in the Swiss Armed Forces doing their repetition course; secondary: anyone curious about small-unit leadership. |
| **Must do well** | Let one player **lead 5 Gruppen of 4–8 soldiers** fluidly: select, order, see the result, and be judged on leadership — not just marksmanship. |
| **Design feel** | "Call of Duty on an okay workstation": first-person, weapon viewmodel, cinematic lighting, fog, bloom, tone-mapping, HUD with compass and squad cards — while holding 60 fps on an integrated/mid-range GPU. |

## 2. Platform & tech

* **Three.js** (WebGL2) + **TypeScript** + **Vite**. Runs in any modern desktop browser, no install — important for military
  laptops where installing a game client is not possible.
* **No external asset downloads**: all geometry is procedural, all textures (rock, asphalt, concrete, TAZ 90 camo, snow)
  are generated on a canvas at startup. Keeps the repo small and avoids licensing issues.
* Rendering: PBR `MeshStandardMaterial`, ACES filmic tone mapping, sRGB output, PCF soft shadows, exponential fog,
  post-processing (bloom for tunnel lights / muzzle flash, output pass).
* **Graphics presets (Low / Medium / High)**: shadow map size, pixel ratio, bloom on/off, draw distance, number of
  tunnel light shadows. Default chosen from a quick GPU probe, overridable in the menu.

## 3. Setting

* **Outside:** Göschenen valley — steep alpine walls (heightfield with ridged noise), snow line, the Reuss river bed,
  the A2 approach road, toll/control plaza area, portal building with the "GOTTHARD" lettering, ventilation building.
* **Inside:** the 2-lane road tunnel (≈ 7.8 m wide, arched), sodium/LED lighting strips, lay-bys (*Ausstellbuchten*),
  SOS niches, and cross-passages to the parallel **safety gallery** (*Sicherheitsstollen*). The playable section is a
  ~600 m slice of the tunnel — enough for the scenario, cheap enough to render.
* Civil vehicles (cars, a truck) stopped in the tunnel after the incident.

## 4. Scenario — "Operation RIEGEL" (one mission, ~15–25 min)

Exercise framing: subsidiary security operation (*Unterstützung der zivilen Behörden*). The Kantonspolizei Uri has
requested army support after an armed group sabotaged ventilation and stopped traffic in the tunnel.

Phases follow the Swiss Army **Führungsrhythmus** so the game teaches the real process:

1. **Problemerfassung / Orientierung** — briefing by the Kp Kdt (Hptm). Map, situation, mission.
2. **Sofortmassnahmen** — pick 1–2 immediate measures (block A2, alert Rettungsdienst, recon portal). Each has an effect.
3. **Beurteilung der Lage / Entschluss** — choose a variant (e.g. *Main effort via road tunnel* vs *via safety gallery*).
4. **Befehlsgebung** — assign the 5 Gruppen to tasks (the 5-point order: Orientierung, Absicht, Aufträge, Besondere
   Anordnungen, Standorte). Assignments define start positions.
5. **Steuerung (play)** — real-time: lead the platoon in first person, give orders, react to events
   (hostile contact, civilians in the cross-passage, a casualty, a radio request from the Kp Kdt).
6. **Debriefing (AAR)** — scored on mission, people, ROE, time and communication. Rank-style grade + written feedback.

Objectives during play:
* Secure the portal (Gruppe at the control plaza).
* Clear the tunnel to the ventilation niche; neutralise / arrest the saboteurs.
* Evacuate civilians via the cross-passage into the safety gallery.
* Report to the Kp Kdt (SITREP) at the defined phase lines.

## 5. Core system: platoon command (the thing that must work best)

* **Platoon** = Lt (player) + 5 Gruppen (`1 Gr` … `5 Gr`), each with a Gruppenführer (Wm/Kpl) and 3–7 soldiers —
  total 4–8 per Gruppe, randomized names (Swiss German/French/Italian/Romansh surnames) and traits.
* **Selection:** keys `1`–`5` select a Gruppe (`Shift`+key adds), `` ` `` / `0` = all. Squad cards on the HUD show
  status, order, strength, morale.
* **Orders** (radial/hotkey):
  * `Z` / click **Move** (Verschieben) to the point under the crosshair
  * `X` **Halten / Sichern** (hold and secure, facing where you look)
  * `C` **Folgen** (follow me)
  * `V` **Durchsuchen / Säubern** (clear area around point)
  * `B` **Evakuieren** (escort civilians near point to the gallery)
  * `G` **Feuer frei / Feuer halt** (ROE toggle per Gruppe)
* **Tactical map** (`M`): top-down view of the sector; right-click to send selected Gruppen; shows phase lines.
* **Formations:** column in the tunnel, line/wedge outside, automatic based on space.
* **Gruppe AI:** finite state machine (Idle → Move → Hold → Engage → Clear → Escort → Casualty). Soldiers spot
  enemies with view cones + line-of-sight raycasts, return fire, report contact over the radio ("Kontakt! 2 Gr,
  Feind bei Querschlag 3").
* **Radio log** (Funk) with Swiss Army procedure phrasing, mixed DE with short EN hints.

## 6. RPG layer

* **Leadership attributes** of the Lt: *Führung* (orders obeyed faster), *Übersicht* (bigger HUD/map awareness),
  *Fürsorge* (morale recovery), *Schiessen* (accuracy). Points earned per mission rating.
* **Morale per Gruppe**: drops with casualties, contradictory orders, long idle under fire; rises when the Lt is near,
  after successful actions, after "Fürsorge" actions (rest, praise). Low morale → slower reactions, hesitation.
* **Dialogue** at decision points (briefing, Sofortmassnahmen, civilians, Kp Kdt calls) with consequences.
* **Debriefing** with grade (A–E) and specific leadership feedback.

## 7. Player & combat

* First-person controller: walk / sprint / crouch, collision with world, head bob.
* Weapon: **Stgw 90** viewmodel, semi/auto, 20-round magazine, reload, recoil, muzzle flash, tracer, impact decals.
* Health with regenerate-under-cover, medic call (Sanitäter in each Gruppe).
* Enemies: armed saboteurs with simple cover AI; civilians who panic/flee/follow.
* **ROE**: hitting a civilian or firing with "Feuer halt" is logged and heavily penalised.

## 8. HUD (CoD-style)

Compass strip with objective markers, squad cards (left), radio log (bottom-left), ammo & stance (bottom-right),
objective panel (top-left), hit markers, damage vignette, order feedback ping in the world, mini map.

## 9. Architecture

```
src/
  main.ts            boot, menu, game loop
  engine/            renderer, post FX, quality presets, input, audio (WebAudio synth)
  world/             textures (procedural), terrain, tunnel, portal, props, lights, collision
  actors/            soldier mesh builder, soldier AI, enemy AI, civilian AI, player controller, weapon
  command/           platoon model, orders, selection, formations, tactical map
  rpg/               scenario/phases, dialogue, morale, scoring/debriefing
  ui/                HUD, menus, briefing screens
```

Collision uses a simple axis-aligned box + tunnel-cylinder model (no physics engine) to stay fast.

## 10. Performance budget ("okay stations")

* ≤ 150 draw calls via merged static geometry and instancing (tunnel lights, road markings, rocks).
* 1 shadow-casting sun outside; inside the tunnel, baked-look emissive strips + a few unshadowed point lights.
* AI updates at 10 Hz staggered; raycasts against a coarse collision set, not render meshes.
* Target: 60 fps on Intel Iris Xe at 1080p on *Medium*.

## 11. Milestones

| | Milestone | Status |
|---|---|---|
| M1 | Skeleton: Vite/TS project, renderer, quality presets, procedural textures, player controller | ✅ |
| M2 | World: valley terrain, portal, tunnel with baked lighting, gallery, cross-passages, vent room, vehicles | ✅ |
| M3 | Platoon: soldier meshes (1 skinned draw call each), 5 Gruppen, selection, orders, formations, tactical map | ✅ |
| M4 | Combat: Stgw 90, saboteurs with cover/surrender AI, civilians, ROE, damage, casualty care | ✅ |
| M5 | RPG layer: briefing → measures → decision → order → play → AAR; morale; scoring; career | ✅ |
| M6 | Polish: HUD, synthesized audio, bloom, performance pass | ✅ first pass |

**Verification so far:** typecheck and production build pass. In headless Chromium (software GL) the full flow runs
without errors: menu, briefing, play, SITREP, debrief. A scripted 5-minute AI simulation showed contact reports,
challenges, surrenders, arrests, casualties, medic treatment, evacuation and the charge timer all working. Outdoors
the scene costs ~230–340 draw calls including shadow and bloom passes, and inside the tunnel ~110–170.
Frame rate has **not** been measured on real GPU hardware yet.

**Next steps:** profile on target laptops (Iris Xe), tune difficulty with real cadres, add voice lines, add more
missions (e.g. the south portal at Airolo, or a night scenario).

## 12. Out of scope (for now)

Multiplayer, skinned/motion-captured character animation, real map data import, voice acting, multiple missions,
save games beyond the attribute points (stored in `localStorage`).
