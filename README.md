# Tilt

A phone game: tilt a round steel plate to roll every ball into its own hole, as fast as you can.
Gentle tilts move the balls; a sharp flick knocks seated balls back out.

Play it at **https://keithhearne.github.io/tilt/** on your phone. It needs the phone's motion sensors, so it does nothing useful on a computer.
Add it to your home screen to play offline in full screen.

## How to play

1. Pick a difficulty, or open **Settings** to mix your own.
2. Tap **Play** and allow motion access if asked.
3. Hold the phone at whatever angle is comfortable during the 3-2-1 countdown. Its angle at Go becomes level, and the timer starts.
4. Tilt to roll the balls. The timer stops once every ball has stayed in a hole for one second.

The little circle bottom right is a spirit level: its bubble drifts uphill.

## Settings

| Setting | Options | What it changes |
|---|---|---|
| Balls | 1, 3, 5, 7 | Balls and holes |
| Holes | Pocket, Deep cup, Shallow cup | Pocket: once in, a ball stays. Deep cup: a slow tilt to about 30° or a quick flick to about 7° knocks it out. Shallow cup: about 15° slow, 2° quick |
| Cup size | Large, Medium, Small | Cup radius: 32, 24 or 16 mm across for a 20 mm ball. Smaller cups are a narrower target and need a harder flick to empty (deep cup: about 7°, 9° and 14.5° over a tenth of a second) |
| Rolling | Tuned, Real steel | Real steel rolls about five times more freely, so it is much harder to stop |
| Plate | Small, Normal, Large | Everything scales together; bigger plays slower |
| Obstacles | None, Posts, Guards, Both | Posts deflect balls; guards wall off the outer side of each hole |

Presets: Easy (3 balls, pockets), Medium (5, deep cups), Hard (5, shallow cups, posts), Expert (7, shallow cups, real steel, posts).

## How it works

Plain HTML and JavaScript modules, no build step, no dependencies.

- `js/physics.js`: rigid steel balls at a 1 kHz fixed step, with restitution, friction and rolling resistance.
- `js/input.js`: reads `devicemotion` (falling back to `deviceorientation`), takes the angle at Go as level, and turns it into the gravity a ball on the plate feels.
- `js/levels.js`: difficulty settings and layouts.
- `js/render.js`, `js/main.js`: drawing and the game flow.
- `sw.js`, `manifest.webmanifest`: offline play and home-screen install.

The physics values come from the research in `research/`. Run `node research/sim.mjs <suite>` to repeat any of it; `research/results.txt` has the output.

## Develop

```bash
python3 -m http.server 8765
```

Motion sensors need HTTPS, so test on a phone through the GitHub Pages site (or any HTTPS tunnel).
Add `?debug` to the address to get `window.tiltDebug` in the console.

```bash
node --test tests/*.test.mjs
```

After changing the file list, bump `VERSION` in `sw.js` so installed copies refresh.
