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

- **Art** (`js/art-*.js`) is drawn in code as SVG and painted with filters that imitate watercolour: wobbly edges, uneven pigment, darker rims where paint pools, and loose ink lines over a paper texture.
- **Characters** (`js/characters.js`) are puppets made of painted parts that bend at the joints, with swappable faces.
- **Sound** (`js/audio.js`): all sound effects and music are synthesised with the Web Audio API. Narration is pre-recorded neural speech stored in `js/voice-data.js`.
- **Engine** (`js/engine.js`): every animation runs on one game clock, so the cartoons can be recorded frame by frame.

### Tools (`tools/`)

Only needed to change voices or videos. Needs Node 18+, Python 3 and ffmpeg.

```sh
cd tools && npm install            # Playwright, for rendering

# Voices: Kokoro text-to-speech (see the header of gen_voice.py for the model download)
python3 -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile numpy
.venv/bin/python gen_voice.py kokoro-v1.0.onnx voices-v1.0.bin

# Cartoon videos: records js/cartoons.js to videos/*.mp4
node render-videos.mjs             # or: node render-videos.mjs potty

# Development helpers
node playtest.mjs potty out/ 90 4  # auto-plays a scene and saves screenshots
```

Developer URL options: `index.html?scene=teeth` jumps to a scene, `&speed=3` runs the clock faster.

## Credits

- Voices: [Kokoro-82M](https://github.com/hexgrad/kokoro) (Apache 2.0), via [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx).
- Font: [Fredoka](https://github.com/hafontia/Fredoka-One) (SIL Open Font License, `assets/fonts/OFL.txt`).
- "Twinkle Twinkle Little Star" (traditional) plays at bedtime.
