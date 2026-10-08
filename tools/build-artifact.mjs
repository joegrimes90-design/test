// Bundle the game into one HTML fragment (CSS and JS inlined) for hosting as a
// claude.ai artifact. Videos stay as separate files next to it.
//   node tools/build-artifact.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const title = html.match(/<title>[^<]*<\/title>/)[0];
const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => read(m[1])).join('\n');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => {
  const src = read(m[1]);
  if (src.includes('</script')) throw new Error(m[1] + ' contains </script');
  return `<script>\n${src}\n</script>`;
});
const inline = [...html.matchAll(/<script>([^<]+)<\/script>/g)].map((m) => `<script>${m[1]}</script>`);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'atticus.html'), `${title}\n<style>\n${css}\n</style>\n${body}\n${scripts.join('\n')}\n${inline.join('\n')}\n`);
console.log('wrote', path.join(out, 'atticus.html'), Math.round(fs.statSync(path.join(out, 'atticus.html')).size / 1024) + ' KB');
