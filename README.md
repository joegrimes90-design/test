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
- **Loading** (`js/art-core.js`, `js/game.js` `AT.go`, `js/raster-cache.js`). Painting a sprite's watercolour filters is the slow part (about 2 s for a full-screen background at 1x CPU), so it is kept away from what the child sees:
  - *Off the page's thread.* In Chromium the bitmaps are rasterised on the browser's worker threads (`createImageBitmap` of a wrapper SVG that draws the sprite's own SVG at exactly the scale `drawImage` would, so the pixels are identical) and PNG-encoded by a small worker; the page's thread only loads and hands over images, never for more than a few milliseconds. A boot probe paints a small drawing both ways and compares the bytes: wherever they differ (other engines, GPU canvases, a future Chromium), and for sprites with rotated shapes (teddy), the synchronous canvas bake is used as before (`?bake=sync` forces it). Painting starts at once and the probe's answer is waited for before a result is kept.
  - *Behind covers.* `AT.go` fades to paper, builds the scene with the stage hidden (nothing under the cover paints; in live play the clock stands still), and paints every bitmap its sprites need plus everything the scene will ask for while it is played, listed in the generated `js/sprite-manifest.js` (close-ups such as the mouth and the hand-washing card, thought bubbles, celebrations, particles, the steps of pulsing sprites): the big ones first, at most two at a time so that a third worker thread keeps painting the many small ones, PNG-encoded by two workers, the rest by the time the scene has faded in. So nothing is painted during play (random sizes, such as balloons, are the exception: they are painted off the page's thread when they appear). An img made behind a cover never loads its SVG at all; its bitmaps go in all at once at the end. Painting for the next scene starts while the last one fades out.
  - *The first visit's still title.* When the title's bitmaps are neither painted nor stored, it is shown at once, still, as plain SVG (which looks the same: nothing moves, so it is rasterised once) with a small "Getting the paints ready…" pill outside the stage; a tap is taken. When its bitmaps (and its manifest's) are painted they go in all at once, the frames settle, and the clock starts (`at:live:title`). Nothing else changes on the page meanwhile (each change would wait for that first raster).
  - *Idle time.* While a scene is played, bitmaps of the scenes that can follow it are painted one at a time when the page is idle (`requestIdleCallback`), off the page's thread, so their covers are shorter: first the big backgrounds two of them share (from the hub: the bathroom of potty and teeth, the lounge of tv and party), then their small sprites. Their own big bitmaps wait for their covers. Fades run on the wall clock in live play (the engine clock in tests and recordings), the paper `#fade` is composited, and the scene stays still under it until it has faded in.
  - *Across visits.* Painted bitmaps are stored losslessly in IndexedDB (`js/raster-cache.js`) under a key covering everything that affects their pixels: sprite id, a hash of its SVG text (editing a drawing or `AT.palette` invalidates it), scale, browser build and `CACHE_VERSION` (bump it when painting or the scale mapping changes). They are written when the browser is idle after a scene has faded in, read in one go at boot, and checked for size when used (a wrong one is painted again). Once a session, in idle time, records for other drawings or browsers go, at most 32 scales per sprite are kept, and the least recently used above 150 MB. Where IndexedDB is refused (sandboxed iframes, some `file://` pages, private windows) the game paints as on a first visit. A returning player's scenes appear without painting anything.
- **Characters** (`js/characters.js`) are puppets made of painted parts that bend at the joints, with swappable faces.
- **Sound** (`js/audio.js`): all sound effects and music are synthesised with the Web Audio API, and pause while the page is hidden. Narration is pre-recorded neural speech in three generated files: `js/voice-index.js` (every line's text, speaker and duration, and the lines each scene says) loads with the game; the audio, `js/voice-data.js` (1.7 MB), loads after the game has started, so the title never waits for it; `js/voice-cartoons.js` holds the lines only the cartoons say and is loaded only when recording them. Each scene decodes its lines as it starts, keeping at most about 8 MB of decoded audio.
- **Engine** (`js/engine.js`): every animation runs on one game clock, so the cartoons can be recorded frame by frame.

### Tools (`tools/`)

Only needed to change voices, videos or what a scene shows. Needs Node 18+ (and Python 3 and ffmpeg for voices and videos).

```sh
npm install                        # once, at the repo root: Playwright (for rendering and tests)
cd tools

# Voices: Kokoro text-to-speech (see the header of gen_voice.py for the model download)
python3 -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile numpy
.venv/bin/python gen_voice.py kokoro-v1.0.onnx voices-v1.0.bin
# After a scene starts (or stops) saying an existing line: re-sort the clips, nothing is re-spoken
node split-voice.mjs

# Sprite manifest: after changing what a scene shows, or at which size (tests/unit/manifest.test.mjs says so)
node sprite-manifest.mjs           # plays every scene (about a minute) and writes js/sprite-manifest.js

# Cartoon videos: records js/cartoons.js to videos/*.mp4
node render-videos.mjs             # or: node render-videos.mjs potty

# Development helpers
node playtest.mjs potty out/ 90 4  # auto-plays a scene and saves screenshots
node perf.mjs --cpu 1 --net 1600,150 --page /dist/atticus.html   # the artifact bundle on a slow connection
```

Developer URL options: `index.html?scene=teeth` jumps to a scene, `&speed=3` runs the clock faster, `&manual=1` stops the clock for tests (see Testing), `&raster=svg` shows the sprites as plain SVG images (no bitmap layer), `&bake=sync` paints every bitmap on the page's thread, `&enc=toblob` encodes PNGs with `canvas.toBlob` instead of the worker (the artifact bundle does that: its host may forbid `blob:` workers), `&debug=1` also warns about bitmaps painted during play (a stale manifest), `&spritelog=1` records every bitmap request (`AT.art.spriteLog()`, for `tools/sprite-manifest.mjs`).

## Testing

```sh
npm install                       # once: Playwright 1.56.1 + pngjs (needs its Chromium: npx playwright install chromium)
npm test                          # unit + end-to-end + visual, about 8 minutes
npm run test:unit                 # static checks in Node, about 1 second
npm run test:e2e                  # plays the game in headless Chromium
npm run test:visual               # screenshots compared with tests/visual/baselines/
npm run test:update-baselines     # re-record the baselines after an intended visual change
npm run perf                      # load and frame-rate budgets (not part of npm test)
```

- **Unit** (`tests/unit/`, `node --test`): every spoken line exists in `tools/voice-lines.json` and the narration files with the same text, each scene's lines are in its list with their audio in `js/voice-data.js`, and every clip is byte-for-byte the audio of the last commit; narration that arrives late waits for its audio instead of using the browser's robot voice, and decoded audio stays within its budget; sound paused both for a resize repaint and for a hidden page comes back only when both are over; every sprite the code uses is defined and renders to well-formed SVG; each scene's generated sprite manifest lists every sprite the scene's code shows (its own, its puppets' parts and faces, celebrations, confetti, the HUD), so it is regenerated when a scene changes; scenes, cartoons and videos are wired up; every sound effect and music track renders (through a fake `OfflineAudioContext`); the clock and the test hook work; the game still runs from `file://` (no modules, no `fetch`) and still bundles with `tools/build-artifact.mjs`; every `js/` file parses as an ES2019 classic script (with acorn), so older iPads (Safari before 13.1) can still start the game.
- **End-to-end** (`tests/e2e/`): boots with no console errors; the title leads to the hub; an auto-player (the logic of `tools/playtest.mjs`) plays potty, teeth and baby to the end and earns each sticker; the last sticker starts the party; balloons pop; the TV plays a cartoon (WebM where H.264 is missing); Home, the sound toggle and "New day" work; with real audio, narration requested before its audio file has arrived waits for it and never uses the speech synthesiser (title, hub, a whole potty round), and sound pauses while the page is hidden. `bitmaps.spec.mjs` covers the bitmap layer where screenshots can't: a live resize never shows a magnified bitmap (checked every animation frame) and a slow repaint shows the still scene with a progress pill; a cache squeezed by a tiny memory budget evicts old bitmaps but never one an image shows; brushing teeth paints no bitmap inside a pointer event and the foam shares a handful of bitmaps. `loading.spec.mjs`: a cold first visit shows the still title with a pill, then all its bitmaps at once (never some), then the clock; a tap or a resize during that preview; at 1280x720@2, teeth paints nothing between its entry cover and brushing (the mouth close-up is painted behind the cover). `cache.spec.mjs` (1280x720@2): a reload paints nothing, takes every bitmap from IndexedDB and gives a bit-identical title; an `indexedDB` that throws still plays; a stored bitmap of the wrong size is painted again and stored anew.
- **Visual** (`tests/visual/`, 1280x720 at deviceScaleFactor 2): every sprite in a gallery (`gallery.html`, at natural size and at its largest in-game scale, shown through the bitmap layer), plus frames of every scene and of the hand-washing and mouth close-ups. The baselines were recorded from the plain SVG sprites; `AT_RASTER=svg npm run test:visual` runs the suite on them (the `?raster=svg` kill switch), and must give PSNR ∞. `raster-parity.spec.mjs` renders the same frames with `?raster=svg` and with bitmaps in one run and compares them with much stricter limits (also at 1194x834, where sprites come to rest between device pixels, and with the Home button's CSS pulse paused at its peak); `RASTER_PARITY_SELFTEST=1 npx playwright test raster-parity` also renders known-bad variants of the layer and checks that each one fails those limits. `bake-ab.spec.mjs` renders the 9 scene frames and the 9 gallery pages (all 150 sprites) with off-thread painting and with `?bake=sync` in the same run and requires bit-identical screenshots, so a Chromium update that changes either way of painting fails here.

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

**Performance.** `npm run perf` (`tests/perf/check.mjs`) runs `tools/perf.mjs` in four configurations and prints every metric next to `tests/perf/budget.json` and `tests/perf/baseline.json`. It fails if a budgeted metric (or a scene's own transition limit, under `scenes`) is over budget; the `stretch` block is printed but never fails. The budgets are the optimisation targets, so code that has not reached them fails. Timings depend on what else the machine is doing (raster threads are shared): run it on a quiet machine.

| configuration | `tools/perf.mjs` flags | what it adds |
|---|---|---|
| `noThrottle` | `--cpu 1 --scenes --trace --play` | frame pacing and raster cost on the title, then every scene transition, then potty and teeth played on the real clock |
| `cpu4` | `--cpu 4` | 4x CPU throttling, like a tablet |
| `revisit` | `--cpu 1 --revisit --scenes` | a persistent profile loaded twice; the budgets read the second load (bitmaps from IndexedDB) |
| `revisitCpu4` | `--cpu 4 --revisit` | the same at 4x CPU throttling |

The main metrics (milliseconds after navigation start unless noted):

- `titleShown`: the title has faded in (game mark `at:shown:title`; on a cold visit, the still preview). `titlePainted`: when it is on screen: two animation frames later (marked in the page, so Playwright round trips don't count), or its largest-contentful-paint (`titleLcp`: the frame showing its largest image presented, i.e. rasterised) if that is later. `titleLive`: the title is animating with all its bitmaps (`at:live:title`).
- `frameP50`/`frameP95`: animation-frame intervals on the title once it is live (16.7 = 60 fps), up to 120 frames or 12 s.
- `rasterMsPerFrame` (`--trace`): tile raster time on the compositor worker threads per frame drawn, from a 3 s Chromium trace 1 s after the title is painted.
- `maxLongTaskPlay` (`--play`): the longest main-thread task while potty and teeth are played on the real clock (at `--play-speed 2`, up to `--play-cap 45000` ms each) by the test suites' auto-player (taps what glows, rubs where the hand points, brushes the teeth), not counting `AT.go` transitions (`at:go:X` to `at:shown:X`): card pop-ins, thought bubbles, star flights and the teeth close-up count. `playFrameP95`: the worst played scene's frame p95; per scene under `play`.
- `maxLongTaskIdle`: the longest task in idle frames only (the title, and each scene just after `AT.go`, with nobody playing).
- `maxLongTask`: the longest task anywhere, loading included.
- `bitmapsPainted` (`bitmapsOffThread` of them off the page's thread), `paintedInPlay` (painted while a scene was played rather than behind its cover: random sizes, or a stale manifest), `bitmapsStored` (taken from IndexedDB), `storeLoadMs` (reading the stored records at boot).
- `voiceAudio`: when the narration audio (`js/voice-data.js`, loaded after the game has started) arrived (`at:voice`); the title does not wait for it.
- `--scenes`: per scene (hub, potty, teeth, baby, tv, party, entered with `AT.go`), the game marks `faded`, `dom`, `raster`, `built`, `shown` and `painted` relative to the `AT.go` call, plus the scene's frame p50/p95 (up to 60 frames or 5 s). `transitionMax` is the slowest `shown`; `sceneFrameP95` the worst scene p95.
- `--revisit`: every run uses a fresh persistent profile, loads the page (`cold.*`), then loads it again (`revisit.*`).

Other flags: `--play` (with `--play-cap ms`, `--play-speed x`), `--runs N` (default 3, medians are reported), `--json out.json`, `--dpr 2`, `--page /dist/atticus.html` (the one-file artifact bundle, rebuilt first), `--net kbps,rtt` (network emulation, with text files served gzipped like a web host), `--title-frames N`/`--title-cap ms`, `--scene-frames N`/`--scene-cap ms`. `npm run perf -- --only noThrottle,cpu4` runs some of the configurations, and `npm run perf -- --update-baseline` re-records `baseline.json`. With the SVG sprites the first baseline came from, it takes about 11 minutes, because every frame is slow.

## Credits

- Voices: [Kokoro-82M](https://github.com/hexgrad/kokoro) (Apache 2.0), via [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx).
- Font: [Fredoka](https://github.com/hafontia/Fredoka-One) (SIL Open Font License, `assets/fonts/OFL.txt`).
- "Twinkle Twinkle Little Star" (traditional) plays at bedtime.
