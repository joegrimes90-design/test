// Bundle the game into one HTML fragment (CSS and JS inlined) for hosting as a
// claude.ai artifact. Videos stay as separate files next to it.
//   node tools/build-artifact.mjs [outDir]
// Scripts keep their document order, so the narration audio (js/voice-data.js,
// after <script>AT.boot();</script>) still arrives after the game has started.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const title = html.match(/<title>[^<]*<\/title>/)[0];
const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => read(m[1])).join('\n');
const bodyAt = html.indexOf('<body>') + 6;
const scriptsAt = html.indexOf('<script', bodyAt);
const body = html.slice(bodyAt, scriptsAt);
const scripts = [...html.slice(scriptsAt).matchAll(/<script(?: src="([^"]+)")?>([^<]*)<\/script>/g)].map(([, src, inline]) => {
  if (!src) return `<script>${inline}</script>`;
  const code = read(src);
  if (code.includes('</script')) throw new Error(src + ' contains </script');
  return `<script>\n${code}\n</script>`;
});
fs.mkdirSync(out, { recursive: true });
// AT_BUNDLE marks the one-file bundle (the game itself treats it like index.html)
fs.writeFileSync(path.join(out, 'atticus.html'), `${title}\n<style>\n${css}\n</style>\n${body}\n<script>window.AT_BUNDLE = true;</script>\n${scripts.join('\n')}\n`);
console.log('wrote', path.join(out, 'atticus.html'), Math.round(fs.statSync(path.join(out, 'atticus.html')).size / 1024) + ' KB');
