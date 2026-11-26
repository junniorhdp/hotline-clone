// Genera las 3 portadas de CrazyGames en crazygames-assets/.
//   node tools/crazygames-covers/generate.mjs
// Sin dependencias: dibuja con HTML5 Canvas en el Edge o Chrome ya instalados (en segundo plano, con un perfil temporal) y no descarga nada.
// Opciones: --source <carpeta>  --out <carpeta>  --no-captures (ignora source/ y usa la escena dibujada). Variable BROWSER = ruta de otro Chromium.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const outDir = path.resolve(arg('--out') || path.join(root, 'crazygames-assets'));
const sourceDir = path.resolve(arg('--source') || path.join(root, 'crazygames-assets', 'source'));

const FORMATS = [
  { id: 'landscape', file: 'cover-landscape-16x9.png', W: 1920, H: 1080 },
  { id: 'portrait', file: 'cover-portrait-2x3.png', W: 800, H: 1200 },
  { id: 'square', file: 'cover-square-1x1.png', W: 800, H: 800 },
];

// --- Capturas base: `landscape.png` / `portrait.png` / `square.png` van a su formato; si no, la primera imagen sirve para todos. `covers.json` (opcional) ajusta el encuadre. ---
fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
const images = process.argv.includes('--no-captures') ? [] : fs.readdirSync(sourceDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
let config = {};
const configPath = path.join(sourceDir, 'covers.json');
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { console.error(`covers.json no es un JSON válido: ${e.message}`); process.exit(1); }
}
function captureFor(format) {
  const c = config[format] || {};
  const name = c.file || images.find((f) => f.toLowerCase().startsWith(format)) || images.find((f) => !/^(landscape|portrait|square)/i.test(f));
  if (!name) return null;
  const file = path.join(sourceDir, name);
  if (!fs.existsSync(file)) { console.error(`No existe la captura ${file}`); process.exit(1); }
  const ext = path.extname(name).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return { name, dataUrl: `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`,
    focus: c.focus || [0.5, 0.5], zoom: Math.max(1, c.zoom || 1), cropTop: c.cropTop ?? 0.22, cropBottom: c.cropBottom ?? 0 };
}

// --- Navegador en segundo plano (protocolo DevTools) ------------------------------------------------------------------------------------------------------------------
const candidates = [process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const browser = candidates.find((p) => fs.existsSync(p));
if (!browser) { console.error('No se encontró Edge ni Chrome. Indica la ruta en la variable de entorno BROWSER.'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neonrush-covers-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;

async function connect() {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150; i++) {
    if (fs.existsSync(portFile)) {
      try { // (el navegador puede estar aún escribiendo el archivo: EBUSY)
        const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
        const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
        if (page) return page.webSocketDebuggerUrl;
      } catch { /* aún arrancando */ }
    }
    await sleep(100);
  }
  throw new Error('el navegador no respondió');
}

let nextId = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`sin respuesta a ${method}`)); }, 60000);
    pending.set(id, (msg) => { clearTimeout(timer); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); });
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

let failed = false;
try {
  ws = new WebSocket(await connect());
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('no se pudo conectar con el navegador')); });
  ws.onmessage = (e) => { const msg = JSON.parse(e.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); };
  await evaluate(`${fs.readFileSync(path.join(here, 'render.js'), 'utf8')}\n;true`);
  console.log(images.length ? `Capturas en ${sourceDir}: ${images.join(', ')}` : `Sin capturas en ${sourceDir}: se usa la escena dibujada.`);
  for (const f of FORMATS) {
    const capture = captureFor(f.id);
    const { dataUrl, report } = await evaluate(`renderCover(${JSON.stringify({ format: f.id, W: f.W, H: f.H, capture })})`);
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(outDir, f.file), png);
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20); // cabecera IHDR del PNG
    const problems = [];
    if (w !== f.W || h !== f.H) problems.push(`tamaño ${w}x${h}`);
    if (report.titleInBadge) problems.push('el título pisa la esquina del distintivo');
    if (report.minMargin < 4) problems.push(`título con poco margen (${report.minMargin}%)`);
    if (report.whiteEdge) problems.push('borde blanco');
    if (problems.length) failed = true;
    console.log(`  ${f.file}  ${w}x${h}  ${(png.length / 1024).toFixed(0)} KB  base: ${capture ? capture.name : 'escena dibujada'}  margen del título ${report.minMargin}%  ${problems.length ? 'PROBLEMAS: ' + problems.join(', ') : 'OK'}`);
    if (report.upscale > 2.5) console.log(`    aviso: la captura se amplía ×${report.upscale}; usa una más grande o menos zoom si se ve poco nítida.`);
  }
  console.log(`Portadas en ${outDir}`);
} catch (e) {
  console.error('Error:', e.message);
  failed = true;
} finally {
  try { await send('Browser.close'); } catch { proc.kill(); }
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* el sistema lo limpiará */ }
}
process.exit(failed ? 1 : 0);
