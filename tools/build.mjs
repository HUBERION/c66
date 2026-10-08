// Baut den Blockbild-Editor zu einer einzigen, eigenständigen HTML-Datei.
//   node tools/build.mjs
// Ergebnis:
//   dist/blockbild-editor.html  – komplette Seite (zum Hochladen auf einen Webserver oder lokal öffnen)
//   dist/artifact.html          – derselbe Inhalt ohne <html>/<head>/<body>-Rahmen (für eingebettete Vorschauen)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const html = read('index.html');
const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => read(m[1])).join('\n');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => `/* ${m[1]} */\n` + read(m[1]));
const js = scripts.join('\n;\n').replace(/<\/script/gi, '<\\/script');
const version = (read('js/ui/app.js').match(/const VERSION = '([^']+)'/) || [])[1] || '';
const stamp = new Date().toISOString().slice(0, 10);

const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'Blockbild-Editor';
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
  .replace(/\s*<link rel="stylesheet"[^>]*>/g, '')
  .replace(/\s*<title>[^<]*<\/title>/, '');
const bodyMarkup = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/\s*<script src="[^"]+"><\/script>/g, '')
  .trim();

const banner = `<!-- Blockbild-Editor ${version} · gebaut ${stamp} · eine Datei, keine externen Abhängigkeiten -->`;

const full = `<!DOCTYPE html>
<html lang="de">
<head>
  <title>${title}</title>${head.replace(/\n\s*$/, '')}
  <style>
${css}
  </style>
</head>
<body>
  ${banner}
  ${bodyMarkup}
  <script>
${js}
  </script>
</body>
</html>
`;

const artifact = `<title>${title}</title>
<style>
${css}
</style>
${banner}
${bodyMarkup}
<script>
${js}
</script>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'blockbild-editor.html'), full);
writeFileSync(join(root, 'dist', 'artifact.html'), artifact);
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log('dist/blockbild-editor.html ' + kb(full));
console.log('dist/artifact.html         ' + kb(artifact));
