# Atticus's Big Day

A watercolour game for toddlers that helps with potty training, brushing teeth and being a kind big brother. Everything is spoken aloud, so children who can't read yet can play on their own.

**To play:** open `index.html` in a browser (Chrome, Safari, Edge or Firefox). It works offline and straight from the file; no install or server needed. Landscape on a tablet is best. Tap the green button to start, which also turns the sound on.

## What's inside

| Room | What Atticus learns |
|---|---|
| **Potty time** | Three rounds of play. When Atticus gets the *wiggly feeling* (he does a potty dance and his tummy glows), the child chooses the potty over the toys and is rewarded straight away. Then each step: pants down, sit, wee or poo, wipe, pants up, flush, and wash hands with soap. |
| **Brushy teeth** | Toothpaste the size of a pea, then brush every tooth in a giant open mouth to chase the sugar bugs away. Spit, rinse, sparkly smile. |
| **Baby sister** | Work out what she needs: her teddy when she's sad, her bottle when she's hungry (and a burp), peekaboo, gentle strokes, and a blanket and lullaby at bedtime. |
| **Cartoons** | Three short videos (`videos/*.mp4`) showing each routine from start to finish. |

Every success earns stars or a sticker, and Mama and Dada pop up to cheer. With all three stickers, there's a party with balloons to pop and a Big Boy award. "New day" under the sticker chart starts again.

Mistakes are never punished: a wrong choice gets a gentle "try again", and if nothing happens for a few seconds a hand points to what to tap.

## Making it yours

- **Family colours:** skin, hair and clothes for everyone are at the top of `js/art-characters.js` (`AT.palette`).
- **Words:** all spoken lines are in `tools/voice-lines.json`. After editing, regenerate the voices (below).

## How it's built

Plain HTML, CSS and JavaScript with no libraries.

- **Art** (`js/art-*.js`) is drawn in code as SVG and painted with filters that imitate watercolour: wobbly edges, uneven pigment, darker rims where paint pools, and loose ink lines over a paper texture. Browsers re-run those filters whenever anything moves over an SVG image, so each sprite `<img>` shows a PNG painted from its SVG once per exact device scale and mapped 1:1 onto the screen's pixels (`AT.art.fit`, in `js/art-core.js`). `?raster=svg` turns this off and shows the plain SVG images, exactly as before (the layer also falls back to them by itself if a boot self-check shows the browser can't paint SVG into a canvas at full resolution). A bitmap is never shown magnified, and a sprite at rest shows a bitmap at exactly its displayed scale, starting on a whole device pixel: scale tweens get a bitmap for the largest scale they reach (in coarse steps, never painted inside a tap or brush stroke), particles one for their largest size, sprites under a CSS animation (the pulsing Home button) one for the animation's peak, pulsing and breathing sprites step through cached scales both ways, sprites that stop changing are repainted at their exact scale and re-snapped to the pixel grid when they come to rest (after a camera pan, a move, or at the once-a-second sweep). Resizing or zooming swaps in cached bitmaps at once (or the exact SVG where an old bitmap would look magnified), then repaints the rest with the clock and sound paused behind the paper cover; if that would take more than about a second, the still scene is shown with a "Getting the paints ready…" pill until the new bitmaps go in all at once. Cached bitmaps are kept within 512 MB of decoded pixels (192 MB on iPads, iPhones and small-memory devices). `?debug=1` logs any visible sprite that breaks these rules (`AT.art.audit()`).
- **Characters** (`js/characters.js`) are puppets made of painted parts that bend at the joints, with swappable faces.
- **Sound** (`js/audio.js`): all sound effects and music are synthesised with the Web Audio API, and pause while the page is hidden. Narration is pre-recorded neural speech in three generated files: `js/voice-index.js` (every line's text, speaker and duration, and the lines each scene says) loads with the game; the audio, `js/voice-data.js` (1.7 MB), loads after the game has started, so the title never waits for it; `js/voice-cartoons.js` holds the lines only the cartoons say and is loaded only when recording them. Each scene decodes its lines as it starts, keeping at most about 8 MB of decoded audio.
- **Engine** (`js/engine.js`): every animation runs on one game clock, so the cartoons can be recorded frame by frame.

### Tools (`tools/`)

Only needed to change voices or videos. Needs Node 18+, Python 3 and ffmpeg.

```sh
npm install                        # once, at the repo root: Playwright (for rendering and tests)
cd tools

# Voices: Kokoro text-to-speech (see the header of gen_voice.py for the model download)
python3 -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile numpy
.venv/bin/python gen_voice.py kokoro-v1.0.onnx voices-v1.0.bin
# After a scene starts (or stops) saying an existing line: re-sort the clips, nothing is re-spoken
node split-voice.mjs

# Cartoon videos: records js/cartoons.js to videos/*.mp4
node render-videos.mjs             # or: node render-videos.mjs potty

# Development helpers
node playtest.mjs potty out/ 90 4  # auto-plays a scene and saves screenshots
node perf.mjs --cpu 1 --net 1600,150 --page /dist/atticus.html   # the artifact bundle on a slow connection
```

Developer URL options: `index.html?scene=teeth` jumps to a scene, `&speed=3` runs the clock faster, `&manual=1` stops the clock for tests (see Testing), `&raster=svg` shows the sprites as plain SVG images (no bitmap layer).

## Testing

```sh
npm install                       # once: Playwright 1.56.1 + pngjs (needs its Chromium: npx playwright install chromium)
npm test                          # unit + end-to-end + visual, about 3 minutes
npm run test:unit                 # static checks in Node, about 1 second
npm run test:e2e                  # plays the game in headless Chromium
npm run test:visual               # screenshots compared with tests/visual/baselines/
npm run test:update-baselines     # re-record the baselines after an intended visual change
npm run perf                      # load and frame-rate budgets (not part of npm test)
```

- **Unit** (`tests/unit/`, `node --test`): every spoken line exists in `tools/voice-lines.json` and the narration files with the same text, each scene's lines are in its list with their audio in `js/voice-data.js`, and every clip is byte-for-byte the audio of the last commit; narration that arrives late waits for its audio instead of using the browser's robot voice, and decoded audio stays within its budget; sound paused both for a resize repaint and for a hidden page comes back only when both are over; every sprite the code uses is defined and renders to well-formed SVG; scenes, cartoons and videos are wired up; every sound effect and music track renders (through a fake `OfflineAudioContext`); the clock and the test hook work; the game still runs from `file://` (no modules, no `fetch`) and still bundles with `tools/build-artifact.mjs`; every `js/` file parses as an ES2019 classic script (with acorn), so older iPads (Safari before 13.1) can still start the game.
- **End-to-end** (`tests/e2e/`): boots with no console errors; the title leads to the hub; an auto-player (the logic of `tools/playtest.mjs`) plays potty, teeth and baby to the end and earns each sticker; the last sticker starts the party; balloons pop; the TV plays a cartoon (WebM where H.264 is missing); Home, the sound toggle and "New day" work; with real audio, narration requested before its audio file has arrived waits for it and never uses the speech synthesiser (title, hub, a whole potty round), and sound pauses while the page is hidden. `bitmaps.spec.mjs` covers the bitmap layer where screenshots can't: a live resize never shows a magnified bitmap (checked every animation frame) and a slow repaint shows the still scene with a progress pill; a cache squeezed by a tiny memory budget evicts old bitmaps but never one an image shows; brushing teeth paints no bitmap inside a pointer event and the foam shares a handful of bitmaps.
- **Visual** (`tests/visual/`, 1280x720 at deviceScaleFactor 2): every sprite in a gallery (`gallery.html`, at natural size and at its largest in-game scale, shown through the bitmap layer), plus frames of every scene and of the hand-washing and mouth close-ups. The baselines were recorded from the plain SVG sprites; `AT_RASTER=svg npm run test:visual` runs the suite on them (the `?raster=svg` kill switch), and must give PSNR ∞. `raster-parity.spec.mjs` renders the same frames with `?raster=svg` and with bitmaps in one run and compares them with much stricter limits (also at 1194x834, where sprites come to rest between device pixels, and with the Home button's CSS pulse paused at its peak); `RASTER_PARITY_SELFTEST=1 npx playwright test raster-parity` also renders known-bad variants of the layer and checks that each one fails those limits.

**Deterministic mode.** Tests open `index.html?manual=1`: the clock only moves when the test calls `await __test.step(seconds, fps)`, and `Math.random` is seeded, so every frame is reproducible (two runs give bit-identical screenshots). Each step, and every screenshot, first waits for `AT.art.idle()`: sprite bitmaps are painted between steps, never while the clock moves (and their resolution policy runs on the game clock). Before every screenshot the visual tests also check `AT.art.audit()` is empty: no visible bitmap is magnified, or off its displayed scale or off the device-pixel grid at rest. While fast-forwarding, the tests hide the stage, because painting is the slow part. They show it again before every tap and screenshot.

**Visual thresholds** (`tests/visual/thresholds.mjs`). Each screenshot is compared with its baseline using PSNR, SSIM, sharpness (gradient energy, new ÷ baseline) and mean colour shift. These are checked for the whole image, every 256 px tile, and every sprite in the gallery. The limits were set by rendering changes on purpose:

| change | sharpness (image / worst tile) | colour shift | result |
|---|---|---|---|
| sprites cached as bitmaps at the displayed resolution, or compositor layers | ≥ 0.91 / ≥ 0.79 | ≤ 0.4 | pass |
| 1x bitmaps on a 2x screen | 0.82–0.87 / ≤ 0.62 | | fail |
| 2x bitmaps for a sprite shown at 2.6x (sink close-up) | 0.98 / 0.59 | | fail |
| 0.5 px blur | ≤ 0.76 / ≤ 0.44 | | fail |
| brightness +2 %, saturation +10 %, hue +4° | | 2.3–9 levels | fail |

The limits: whole image PSNR ≥ 32 dB, SSIM ≥ 0.97, sharpness 0.89–1.10, shift ≤ 1.5 levels; tiles sharpness ≥ 0.70, shift ≤ 3; sprites sharpness ≥ 0.78. When a test fails, `test-results/<test>/` gets `*-actual.png`, `*-expected.png`, an amplified `*-diff.png` and `*-metrics.json`, naming the worst tiles and sprites. They are also in the HTML report (`npx playwright show-report`).

**Updating baselines.** Run `npm run test:update-baselines` after a change that is *meant* to look different. Look at the new PNGs before committing them. Baselines depend on the browser build and fonts (these come from Playwright 1.56.1's headless Chromium on Linux). On another machine, record them first from unchanged code.

**Performance.** `npm run perf` (`tests/perf/check.mjs`) runs `tools/perf.mjs` in three configurations and prints every metric next to `tests/perf/budget.json` and `tests/perf/baseline.json`. It fails if a budgeted metric is over budget; the `stretch` block is printed but never fails. The budgets are the optimisation targets, so code that has not reached them fails.

| configuration | `tools/perf.mjs` flags | what it adds |
|---|---|---|
| `noThrottle` | `--cpu 1 --scenes --trace --play` | frame pacing and raster cost on the title, then every scene transition, then potty and teeth played on the real clock |
| `cpu4` | `--cpu 4` | 4x CPU throttling, like a tablet |
| `revisit` | `--cpu 1 --revisit --scenes` | a persistent profile loaded twice; the budgets read the second load |

The main metrics (milliseconds after navigation start unless noted):

- `titleShown`: the title has faded in (game mark `at:shown:title`). `titlePainted`: two animation frames later, when the faded-in title is on screen (marked in the page, so Playwright round trips don't count). `titleLive`: the title is animating (`at:live:title` when the game marks it, else `titlePainted`).
- `frameP50`/`frameP95`: animation-frame intervals on the title (16.7 = 60 fps), up to 120 frames or 12 s.
- `rasterMsPerFrame` (`--trace`): tile raster time on the compositor worker threads per frame drawn, from a 3 s Chromium trace 1 s after the title is painted.
- `maxLongTaskPlay` (`--play`): the longest main-thread task while potty and teeth are played on the real clock (at `--play-speed 2`, up to `--play-cap 45000` ms each) by the test suites' auto-player (taps what glows, rubs where the hand points, brushes the teeth), not counting `AT.go` transitions (`at:go:X` to `at:shown:X`): card pop-ins, thought bubbles, star flights and the teeth close-up count. `playFrameP95`: the worst played scene's frame p95; per scene under `play`.
- `maxLongTaskIdle`: the longest task in idle frames only (the title, and each scene just after `AT.go`, with nobody playing).
- `maxLongTask`: the longest task anywhere, loading included (a stretch target: one large background is painted and PNG-encoded in a single task, about 2 s at 1x CPU).
- `voiceAudio`: when the narration audio (`js/voice-data.js`, loaded after the game has started) arrived (`at:voice`); the title does not wait for it.
- `--scenes`: per scene (hub, potty, teeth, baby, tv, party, entered with `AT.go`), the game marks `faded`, `dom`, `raster`, `built`, `shown` and `painted` relative to the `AT.go` call, plus the scene's frame p50/p95 (up to 60 frames or 5 s). `transitionMax` is the slowest `shown`; `sceneFrameP95` the worst scene p95.
- `--revisit`: every run uses a fresh persistent profile, loads the page (`cold.*`), then loads it again (`revisit.*`).

Other flags: `--play` (with `--play-cap ms`, `--play-speed x`), `--runs N` (default 3, medians are reported), `--json out.json`, `--dpr 2`, `--page /dist/atticus.html` (the one-file artifact bundle, rebuilt first), `--net kbps,rtt` (network emulation, with text files served gzipped like a web host), `--title-frames N`/`--title-cap ms`, `--scene-frames N`/`--scene-cap ms`. `npm run perf -- --only noThrottle,cpu4` runs some of the configurations, and `npm run perf -- --update-baseline` re-records `baseline.json`. With the SVG sprites the first baseline came from, it takes about 11 minutes, because every frame is slow.

## Credits

- Voices: [Kokoro-82M](https://github.com/hexgrad/kokoro) (Apache 2.0), via [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx).
- Font: [Fredoka](https://github.com/hafontia/Fredoka-One) (SIL Open Font License, `assets/fonts/OFL.txt`).
- "Twinkle Twinkle Little Star" (traditional) plays at bedtime.
