// Genera `crazygames-build/` (carpeta lista para subir a CrazyGames). Uso: node tools/crazygames/build.mjs
// No usa vite.config.js (ese es el de GitHub Pages) ni toca el código del juego.
import { build } from 'vite';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = path.join(root, 'crazygames-build');
let version = 'dev';
try { version = execSync('git rev-parse --short=7 HEAD', { cwd: root }).toString().trim(); } catch { /* sin git */ }

await build({
  configFile: false,
  root: here,
  base: './', // solo rutas relativas (CrazyGames lo exige)
  publicDir: path.join(root, 'public'),
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir, emptyOutDir: true, assetsDir: '', sourcemap: false, minify: true, cssMinify: true, modulePreload: false, chunkSizeWarningLimit: 800 },
});

// Comprobaciones de la carpeta resultante: sin mapas, sin rutas absolutas y sin enlaces externos (salvo el script del SDK).
const files = fs.readdirSync(outDir, { recursive: true }).filter((f) => fs.statSync(path.join(outDir, f)).isFile());
const problems = [];
if (files.some((f) => f.endsWith('.map'))) problems.push('hay archivos .map');
if (!files.includes('index.html')) problems.push('falta index.html en la raíz');
const ALLOWED = [/^https:\/\/sdk\.crazygames\.com\/crazygames-sdk-v3\.js$/, /^http:\/\/www\.w3\.org\//];
for (const f of files) {
  const text = fs.readFileSync(path.join(outDir, f), 'utf8');
  for (const url of text.match(/https?:\/\/[^"'`\s)<>]+/g) || []) if (!ALLOWED.some((re) => re.test(url))) problems.push(`${f}: enlace externo ${url}`);
  if (f.endsWith('.html') && /(src|href)="\//.test(text)) problems.push(`${f}: ruta absoluta`);
}
console.log(`\ncrazygames-build (versión ${version}):`);
let total = 0;
for (const f of files) { const size = fs.statSync(path.join(outDir, f)).size; total += size; console.log(`  ${f}  ${size} bytes`); }
console.log(`  total: ${files.length} archivos, ${(total / 1024).toFixed(0)} KB`);
if (problems.length) { console.error('PROBLEMAS:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log('Comprobaciones correctas: sin .map, rutas relativas, sin enlaces externos.');
