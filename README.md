# GOTTHARD – Operation Riegel

A first-person 3D leadership RPG that runs in the browser. You play a **Leutnant (Zugführer)** of the Swiss Armed
Forces during a repetition course (WK). You lead **5 Gruppen (32 soldiers)** at the **north portal of the Gotthard road
tunnel** near Göschenen. The game scores you on leadership, not only on marksmanship.

See [`PLAN.md`](PLAN.md) for the product plan and architecture.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (can be served from any web server or file share)
```

It needs a desktop browser with WebGL2 (Chrome, Edge, Firefox or Safari). Nothing is downloaded at runtime except an
optional web font: all geometry and textures are generated procedurally.

## How a mission runs

1. **Problemerfassung / Orientierung**: situation, mission and a schematic of the sector.
2. **Sofortmassnahmen**: choose 2 of 4 immediate measures (road block, medical readiness, drone recon, emergency
   power). Each one changes the mission.
3. **Beurteilung / Entschluss**: choose the main effort (road tunnel or safety gallery) and the rules of engagement.
4. **Befehlsgebung**: assign a task to each Gruppe. The game generates the matching **5-point order** (Orientierung,
   Absicht, Aufträge, Besondere Anordnungen, Standorte).
5. **Steuerung**: lead the platoon in real time. Secure the portal, evacuate six motorists through the
   cross-passages, arrest or neutralise eight saboteurs, and secure the charge in the ventilation room before it goes off.
   Answer the company commander's SITREP requests.
6. **Debriefing (AAR)**: grade A–E across Auftrag, Planung, Truppe & Fürsorge, Einsatzregeln and Kommunikation,
   with written feedback. Points go into the Lt's career attributes (Führung, Übersicht, Fürsorge, Schiessen).

## Controls

Bindings use physical keys and avoid Y/Z, so they work the same on Swiss QWERTZ keyboards.

| Key | Action |
|---|---|
| `W A S D`, `Shift`, `C` | Move, sprint, kneel |
| Mouse L / R, `R`, `N`, `L` | Fire, aim, reload, single/auto, weapon light |
| `1`–`5` (`Shift` adds), `0` | Select Gruppe(n) / whole platoon |
| `Q` or middle mouse | **Verschieben**: move to the point under the crosshair |
| `X` | **Halten / Sichern** facing where you look |
| `F` | **Folgen**: follow the Lt |
| `V` | **Durchsuchen**: clear the area around the point |
| `B` | **Evakuieren**: collect civilians near the point and lead them to safety |
| `G` | Toggle *Feuer frei* / *Notwehr* for the selected Gruppen |
| `H` | Challenge: «Halt! Armee!» (can make saboteurs surrender) |
| `E` | Interact: lead civilians, treat wounded, arrest, secure the charge |
| `T` | SITREP to the company commander (Bastion) |
| `M` | Tactical map (left click selects, right click orders, drag and scroll to pan and zoom) |

## Leadership mechanics

* **Reaction time** of a Gruppe depends on its morale and the Lt's *Führung*.
* **Morale** falls under fire and with casualties. It recovers when the Lt is nearby, scaled by *Fürsorge*.
* **«Befehl, Gegenbefehl, Unordnung»**: changing a Gruppe's order within seconds costs morale and is noted in the AAR.
* **ROE**: with *Notwehr*, Gruppen challenge armed persons before they fire and only return fire when attacked.
  Outnumbered saboteurs may surrender, and an arrest scores higher than a kill. Firing on people who surrendered,
  on civilians or on your own troops is heavily penalised.
* **Casualties**: wounded soldiers bleed out unless the Gruppe's medic, or you (`E`), treats them.

## Performance

Graphics presets (Niedrig / Mittel / Hoch) are picked automatically and can be changed in the main menu. The tunnel's
lighting is baked per vertex. Only a small pool of dynamic lights follows the player, and the AI runs on a 2D
navigation grid. *Mittel* is meant for typical office laptops and *Niedrig* for integrated graphics.

## Code map

```
src/engine   renderer + post FX, quality presets, input, synthesized audio
src/world    layout (single source of truth), nav grid + A*, terrain, tunnel, portal, vehicles, sky/lighting
src/actors   humanoid rig, soldier / enemy / civilian AI, player controller, Stgw 90
src/command  Gruppe + orders + formations, tactical map, names
src/rpg      plan & doctrine review, scenario/objectives/scoring, career
src/ui       HUD, briefing, styles
```

*This is a fictional training scenario. It is not an official product of the Swiss Armed Forces, and the locations are
simplified.*
