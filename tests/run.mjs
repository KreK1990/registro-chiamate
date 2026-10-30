// Controlli automatici dell'app, da lanciare prima di pubblicare (cartella tests: npm install
// la prima volta, poi npm test). Apre l'app in Chrome/Edge (playwright-core usa il browser
// installato) con un Firebase finto in memoria (fake-firebase.js) e dati di prova: niente
// rete verso Firebase, Netlify, Nominatim o le mappe, nessun dato reale.
// I PDF di prova (conferma d'ordine, export del portale) contengono dati di clienti e testo
// coperto da copyright: stanno FUORI dal repository, in ../../test-fixtures; se mancano quei
// controlli vengono saltati.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const fixtures = path.resolve(site, '..', 'test-fixtures');
const pdfjsDir = path.join(here, 'node_modules', 'pdfjs-dist', 'build');
const show = process.argv.includes('--show');
// --shots: salva le schermate del telefono in una cartella temporanea (per guardarle)
const shotsDir = process.argv.includes('--shots') ? fs.mkdtempSync(path.join(os.tmpdir(), 'registro-shots-')) : null;

// ---------- dati di prova (date relative a oggi) ----------
// data locale (come l'app): con toISOString tra mezzanotte e le 2 il giorno sarebbe quello prima
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const year = new Date().getFullYear();
const month = String(new Date().getMonth() + 1).padStart(2, '0');
function seedData() {
  return {
    contacts: [
      { id: 'c1', nome: 'Mario', cognome: 'Rossi', professione: 'Architetto', cellulare: '333 1234567', azienda: 'Studio Rossi', via: 'Via Roma 1', citta: 'Torino', email: 'mario@studiorossi.it', tag: 'vip' },
      { id: 'c2', nome: 'Mario', cognome: 'Rossi', professione: 'Architetto', cellulare: '+39 3331234567', email: '', note: 'conosciuto in fiera', followUp: daysAgo(-5) + 'T10:00' },
      { id: 'c3', nome: 'Laura', cognome: 'Bianchi', professione: 'Ingegnere', telefono: '011 555555', azienda: 'Studio Rossi', via: 'Via Roma 1', citta: 'Torino', email: 'info@studiorossi.it' },
      { id: 'c4', nome: 'Paolo', cognome: 'Verdi', professione: 'Impresa', cellulare: '347 7654321', email: 'info@verdi.it' },
    ],
    calls: [
      { id: 'k1', contactId: 'c1', data: daysAgo(40), esito: 'Interessato', note: 'prima chiamata', progetto: '', createdAt: 1 },
      { id: 'k2', contactId: 'c2', data: daysAgo(20), esito: 'Appuntamento fissato', appuntamento: daysAgo(18) + 'T15:00', note: '', progetto: '', progetti: ['p1'], createdAt: 2 },
      { id: 'k3', contactId: 'c4', data: daysAgo(100), esito: 'Da richiamare', note: '', progetto: '', createdAt: 3 },
    ],
    projects: [
      { id: 'p1', codice: '4800001', nome: 'Residenza Aurora', via: 'Via Po 10', citta: 'Torino', importoOfferta: 100000, probabilita: 50, chiusuraPrevista: `${year}-12`,
        partecipanti: [{ contactId: 'c1', ruolo: 'Progettazione architettonica' }, { contactId: 'c2', ruolo: 'Direzione lavori' }, { contactId: 'c4', ruolo: 'Impresa esecutrice' }],
        fasi: { richiesta: daysAgo(90), offertaPresentata: daysAgo(40) }, createdAt: 1, updatedAt: 1 },
      { id: 'p2', codice: '4800002', nome: 'Uffici Beta', via: 'Corso Francia 5', citta: 'Torino', importoOfferta: 60000, importoDeliberato: 50000,
        partecipanti: [{ contactId: 'c3', ruolo: 'Progettazione strutturale' }],
        fasi: { richiesta: daysAgo(200), offertaPresentata: daysAgo(150), confermaOrdine: `${year}-${month}-01` },
        ordini: [{ id: 'o1', data: `${year}-${month}-02`, numero: '2000001', importo: 20000, consegna: '' }], createdAt: 2, updatedAt: 2 },
      { id: 'p3', codice: '4800003', nome: 'Villa Gamma', via: 'Via Asti 3', citta: 'Alba', importoOfferta: 30000, importoDeliberato: 30000,
        partecipanti: [], fasi: { richiesta: `${year - 1}-01-10`, offertaPresentata: `${year - 1}-02-10`, confermaOrdine: `${year - 1}-03-01` },
        ordini: [{ id: 'o2', data: `${year - 1}-11-01`, numero: '2000002', importo: 10000, consegna: daysAgo(3) },
                 { id: 'o3', data: `${year - 1}-11-02`, numero: '2000003', importo: 20000, consegna: daysAgo(-10) }], createdAt: 3, updatedAt: 3 },
    ],
    // confermata l'anno scorso, tutta ordinata: non cambia le cifre del forecast di quest'anno
    settings: [{ id: 's1', budget: { [year]: 200000 } }],
    portale: [{ id: 'ps1', pid: '9000002', stato: 'seguito', nota: 'richiamare a novembre', seguitoIl: 1, aggiornatoIl: 1, dati: {
      id: '9000002', titolo: 'Palazzina di 8 alloggi', comune: 'Alba', indirizzo: 'Corso Italia 5 12051 Alba ( CN )', nuovaCostruzione: true, fase: 'Esecuzione', unita: 8, soggetti: [] } }],
    forecastStorico: [],
    portaleImport: [{ id: '9000001', pid: '9000001', scartato: false, nuovo: true, importatoIl: 1, dati: {
      id: '9000001', titolo: 'Nuovo complesso residenziale di 24 alloggi', comune: 'Torino', indirizzo: 'Via Nizza 100', nuovaCostruzione: true,
      fase: 'Progettazione', intervento: 'Nuova costruzione', unita: 24,
      descrizione: 'Realizzazione di un edificio residenziale. '.repeat(30) + 'FINE DESCRIZIONE',
      soggetti: [
        { ruolo: 'Progettazione architettonica', nome: 'Studio Associato Esempio', altro: [], tel: ['011 1111111', '011 2222222'], email: ['studio@esempio.it', 'altro@esempio.it'], via: 'Via Garibaldi 3', citta: 'Torino', web: 'www.esempio.it' },
        { ruolo: 'Committente', nome: 'Immobiliare Prova Srl', altro: [], tel: [], email: ['prova@immobiliare.it'], via: '', citta: 'Milano', web: '' },
      ] } }],
  };
}
// copia di backup gia' presente sul "server" (per il ripristino)
const backupKey = daysAgo(1);
const backupData = {
  version: 2, uid: 'test-user', createdAt: new Date().toISOString(),
  collections: {
    contacts: [{ id: 'c1', nome: 'Mario', cognome: 'Rossi', cellulare: '333 1234567' }, { id: 'c9', nome: 'Gina', cognome: 'Neri' }],
    calls: [{ id: 'k9', contactId: 'c9', data: daysAgo(3), esito: 'Interessato', note: 'dal backup' }],
    projects: [], settings: [{ id: 's1', budget: { [year]: 123000 } }], portale: [], forecastStorico: [],
  },
};

// ---------- piccolo server statico ----------
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = u.startsWith('/__fixtures/') ? path.join(fixtures, u.slice(12)) : path.join(site, u);
  if (!file.startsWith(site) && !file.startsWith(fixtures)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- browser ----------
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
if (!exe) { console.error('Chrome o Edge non trovato.'); process.exit(2); }
const browser = await chromium.launch({ executablePath: exe, headless: !show });

let results = [], errors = [];
const backupStore = new Map();
const backupCalls = [];

async function openApp({ width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', locale: 'it-IT', timezoneId: 'Europe/Rome',
    geolocation: { latitude: 45.07, longitude: 7.68 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'] });   // il telefono "e'" a Torino
  await ctx.addInitScript(seed => { window.__seed = seed; window.alert = m => { (window.__alerts = window.__alerts || []).push(String(m)); }; }, seedData());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const fake = fs.readFileSync(path.join(here, 'fake-firebase.js'), 'utf8');
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: r.request().url().includes('firebase-app-compat') ? fake : '' }));
  await ctx.route(/outlook\.office\.com/, r => r.fulfill({ contentType: 'text/html', body: '<p>outlook finto</p>' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route(/tile\.openstreetmap\.org/, r => r.fulfill({ status: 204, body: '' }));
  // posizioni finte: qualche comune riconoscibile, tutto il resto ad Alba
  await page.route(/nominatim\.openstreetmap\.org/, r => {
    const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase();
    const at = /collegno/.test(q) ? [45.08, 7.57] : /casale/.test(q) ? [45.13, 8.45] : /torino/.test(q) ? [45.07, 7.68] : [44.70, 8.03];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: String(at[0]), lon: String(at[1]) }]) });
  });
  // percorsi finti: tempo = distanza in linea d'aria x 1,3 a 60 km/h
  await page.route(/router\.project-osrm\.org/, r => {
    const pts = new URL(r.request().url()).pathname.split('/').pop().split(';').map(s => s.split(',').map(Number));
    const km = (a, b) => { const R = 6371, t = x => x * Math.PI / 180, dLa = t(b[1] - a[1]), dLo = t(b[0] - a[0]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[1])) * Math.cos(t(b[1])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
    if (/\/route\//.test(r.request().url())) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'Ok', routes: [{ geometry: { coordinates: pts } }] }) });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'Ok', durations: pts.map(a => pts.map(b => Math.round(km(a, b) * 1.3 * 60))), distances: pts.map(a => pts.map(b => Math.round(km(a, b) * 1300))) }) });
  });
  await page.route(/google\.com\/maps|maps\.google/, r => r.fulfill({ contentType: 'text/html', body: '' }));
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\/(pdf(\.worker)?)\.min\.js/, r => {
    const name = /pdf\.worker/.test(r.request().url()) ? 'pdf.worker.min.js' : 'pdf.min.js';
    r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(pdfjsDir, name)) });
  });
  // URL dei file di Storage del Firebase finto: un'immagine qualsiasi
  await page.route('https://example.test/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  await page.route('**/.netlify/functions/suggest*', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/.netlify/functions/backups*', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams.get('date');
    backupCalls.push(req.method() + (q ? ' ' + q : ''));
    if (req.method() === 'POST') {
      const snap = await page.evaluate(() => { const out = {}; ['contacts', 'calls', 'projects', 'settings', 'portale', 'forecastStorico'].forEach(c => out[c] = window.__fake.docs(c)); return out; });
      const key = `${iso(new Date())}_${String(Date.now()).slice(-6)}`;
      backupStore.set(key, { version: 2, collections: snap });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ date: key, counts: {} }) });
    }
    if (q) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(backupStore.get(q)) });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ backups: [...backupStore.keys()].sort().reverse() }) });
  });
  await page.goto(base + '/crm-chiamate-standalone.html');
  await page.waitForFunction(() => typeof contacts !== 'undefined' && contacts.length > 0 && projects.length > 0);
  return { ctx, page };
}

async function test(name, fn) {
  const before = errors.length;
  const t0 = Date.now();
  try {
    await fn();
    const errs = errors.slice(before);
    if (errs.length) throw new Error('errori nella pagina:\n    ' + errs.join('\n    '));
    results.push([true, name]); console.log(`  ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push([false, name]); console.log(`  FAIL ${name}\n       ${String(e.message || e).split('\n').join('\n       ')}`);
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const show_ = (page, v, extra = '') => page.evaluate(([v, extra]) => { eval(extra); view = v; renderMain(); return document.getElementById('main').innerText; }, [v, extra]);
const settle = page => page.waitForTimeout(50);

console.log('Registro Chiamate - controlli automatici');
let { ctx, page } = await openApp();

await test('tutte le pagine si aprono senza errori', async () => {
  const views = ['agenda', 'contactsList', 'call', 'followup', 'appt', 'projects', 'map', 'forecast', 'table', 'dashboard', 'settings', 'portal', 'dups', 'new', 'import', 'projectForm', 'segnalati'];
  for (const v of views) {
    const txt = await show_(page, v);
    await settle(page);
    expect(txt.trim().length > 20, `pagina "${v}" vuota`);
  }
  await show_(page, 'detail', "selectedId='c1'");
  await show_(page, 'projectDetail', "selectedProjectId='p1'");
  await show_(page, 'projectDetail', "selectedProjectId='p2'");
  for (const id of ['navAgenda', 'navContacts', 'navProjects', 'navForecast', 'navDashboard', 'navSettings']) { await page.click('#' + id).catch(() => page.evaluate(id => document.getElementById(id).click(), id)); await settle(page); }
});

await test('forecast: ponderato, budget e fatturato', async () => {
  const txt = await show_(page, 'forecast');
  expect(txt.includes('50.000'), 'manca il ponderato 50.000 (100.000 x 50%)');
  expect(txt.includes('200.000'), 'manca il budget 200.000');
  expect(txt.includes('20.000'), 'manca il fatturato reale 20.000 (ordine del mese)');
  expect(txt.includes('30.000'), 'manca il confermato da spedire 30.000 (50.000 deliberato - 20.000 ordinato)');
});

await test('Oggi -> Da fare: offerta da sollecitare', async () => {
  const txt = await show_(page, 'agenda');
  expect(txt.includes('Residenza Aurora'), 'l\'offerta presentata 40 giorni fa non compare tra quelle da sollecitare');
});

await test('registrare una chiamata', async () => {
  await page.waitForFunction(() => appSettings && appSettings.attivitaV2);   // la conversione iniziale delle attivita' aggiunge documenti: si conta dopo
  const n0 = await page.evaluate(() => window.__fake.docs('calls').length);
  await show_(page, 'detail', "selectedId='c4'");
  await page.fill('#callNote', 'chiamata di prova');
  await page.selectOption('#callEsito', 'Interessato');
  await page.click('#saveCallBtn');
  await page.waitForFunction(n => window.__fake.docs('calls').length === n + 1, n0);
  const k = await page.evaluate(() => window.__fake.docs('calls').find(c => c.note === 'chiamata di prova'));
  expect(k && k.contactId === 'c4' && k.esito === 'Interessato', 'chiamata salvata male: ' + JSON.stringify(k));
});

await test('doppioni: trova Mario Rossi e unisce', async () => {
  const txt = await show_(page, 'dups');
  expect(/Possibili doppioni \(1\)/.test(txt), 'atteso 1 gruppo di doppioni:\n' + txt.slice(0, 400));
  expect(!txt.includes('Bianchi'), 'Bianchi (email info@ con cognome diverso, telefono dello studio) non e\' un doppione');
  await page.click('[data-dup-merge]');
  await page.waitForFunction(() => !window.__fake.docs('contacts').some(c => c.id === 'c2'));
  const st = await page.evaluate(() => ({ c1: window.__fake.docs('contacts').find(c => c.id === 'c1'), k2: window.__fake.docs('calls').find(c => c.id === 'k2'), p1: window.__fake.docs('projects').find(p => p.id === 'p1') }));
  expect(st.c1, 'il contatto tenuto (c1, con piu\' dati) e\' sparito');
  expect(st.k2.contactId === 'c1', 'la chiamata del doppione non e\' passata al contatto tenuto');
  expect(st.c1.note === 'conosciuto in fiera', 'nota del doppione non riportata');
  expect(st.c1.followUp, 'follow-up del doppione non riportato');
  const pc = st.p1.partecipanti.map(x => x.contactId);
  expect(pc.filter(x => x === 'c1').length === 1 && !pc.includes('c2'), 'partecipanti del progetto non uniti: ' + pc.join(','));
  expect(/Possibili doppioni \(0\)/.test(await show_(page, 'dups')), 'il gruppo e\' ancora proposto dopo l\'unione');
});

await test('ripristino da una copia', async () => {
  backupStore.clear(); backupCalls.length = 0;
  backupStore.set(backupKey, backupData);
  await show_(page, 'settings', 'backupList=null; loadBackupList()');
  await page.waitForSelector(`[data-restore="${backupKey}"]`);
  await page.click(`[data-restore="${backupKey}"]`);
  await page.click(`[data-restore-yes="${backupKey}"]`);
  await page.waitForFunction(() => /Ripristino (completato|non riuscito)/.test(document.getElementById('restoreMsg')?.textContent || restoreMsg));
  const msg = await page.evaluate(() => restoreMsg);
  expect(msg.startsWith('Ripristino completato'), msg);
  expect(backupCalls.indexOf("POST") >= 0 && backupCalls.indexOf("POST") < backupCalls.indexOf("GET " + backupKey), 'manca la copia di sicurezza prima del ripristino: ' + backupCalls.join(', '));
  const safe = backupStore.get([...backupStore.keys()].find(k => k !== backupKey));
  expect(safe && safe.collections.contacts.some(c => c.id === 'c4'), 'la copia di sicurezza non contiene i dati di prima');
  const st = await page.evaluate(() => ({ c: window.__fake.docs('contacts').map(c => c.id).sort().join(','), k: window.__fake.docs('calls').map(c => c.id).join(','), p: window.__fake.docs('projects').length, s: window.__fake.docs('settings')[0] }));
  expect(st.c === 'c1,c9' && st.k === 'k9' && st.p === 0, 'dati dopo il ripristino diversi dalla copia: ' + JSON.stringify(st));
  expect(st.s.budget[year] === 123000, 'impostazioni non ripristinate');
  await page.waitForFunction(() => contacts.length === 2);
});

await ctx.close();
({ ctx, page } = await openApp());

await test('foto del cantiere: riduzione, caricamento, nota, eliminazione', async () => {
  await show_(page, 'projectDetail', "selectedProjectId='p1'");
  // foto finta 4000x3000 creata nel browser
  await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 4000; cv.height = 3000;
    const g = cv.getContext('2d'); for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 37 % 360},60%,${30 + i % 40}%)`; g.fillRect((i * 97) % 4000, (i * 53) % 3000, 300, 200); }
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.95));
    await addProjectPhotos(projects.find(p => p.id === 'p1'), [new File([blob], 'IMG_0001.JPG', { type: 'image/jpeg', lastModified: new Date('2026-09-20T10:00:00').getTime() })]);
    renderMain();
  });
  let st = await page.evaluate(() => ({ foto: window.__fake.docs('projects').find(p => p.id === 'p1').foto, files: [...window.__fake.files.keys()] }));
  expect(st.foto && st.foto.length === 1, 'foto non registrata nel progetto');
  const f = st.foto[0];
  expect(f.w === 2560 && f.h === 1920, `dimensioni ${f.w}x${f.h} (attese 2560x1920)`);
  expect(f.data === '2026-09-20', 'data della foto: ' + f.data);
  expect(st.files.includes(f.path) && st.files.includes(f.thumb), 'file non caricati su Storage');
  await page.waitForSelector('#fotoCard [data-foto-open]');
  if (shotsDir) { await page.waitForTimeout(300); await (await page.$('#fotoCard')).screenshot({ path: path.join(shotsDir, 'foto-scheda.png') }); }
  await page.click('#fotoCard [data-foto-open]');
  await page.waitForSelector('#fotoViewer #fvNota');
  if (shotsDir) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shotsDir, 'foto-visore.png') }); }
  await page.fill('#fvNota', 'getto solaio');
  await page.press('#fvNota', 'Tab');
  await page.waitForFunction(() => (window.__fake.docs('projects').find(p => p.id === 'p1').foto[0] || {}).nota === 'getto solaio');
  await page.click('[data-fv="del"]');
  await page.click('[data-fv="del-yes"]');
  await page.waitForFunction(() => !document.getElementById('fotoViewer'));
  const pdoc = () => window.__fake.docs('projects').find(p => p.id === 'p1');
  st = await page.evaluate(() => { const p = window.__fake.docs('projects').find(p => p.id === 'p1'); return { n: p.foto.length, trash: (p.cestino || []).length, files: window.__fake.files.size }; });
  expect(st.n === 0 && st.trash === 1 && st.files === 2, 'foto non spostata nel cestino: ' + JSON.stringify(st));
  // ripristino dal cestino della scheda
  await show_(page, 'projectDetail', "selectedProjectId='p1'");
  await page.click('.trash-card summary');
  await page.click('[data-trash-restore]');
  await page.waitForFunction(() => { const p = window.__fake.docs('projects').find(p => p.id === 'p1'); return p.foto.length === 1 && !(p.cestino || []).length; });
  // eliminata di nuovo e scaduti i 30 giorni: il file viene cancellato davvero
  await page.waitForFunction(() => (projects.find(p => p.id === 'p1').foto || []).length === 1);
  await page.evaluate(async () => { await deletePhoto('p1', projects.find(p => p.id === 'p1').foto[0].id); });
  await page.waitForFunction(() => (window.__fake.docs('projects').find(p => p.id === 'p1').cestino || []).length === 1);
  await page.evaluate(async d => { const p = projects.find(p => p.id === 'p1'); await db.collection('projects').doc('p1').update({ cestino: p.cestino.map(t => ({ ...t, eliminatoIl: d })) }); }, daysAgo(31));
  await page.waitForFunction(d => projects.find(p => p.id === 'p1').cestino[0].eliminatoIl === d, daysAgo(31));
  await page.evaluate(async () => { trashPurged = false; await purgeTrash(); });
  st = await page.evaluate(() => ({ trash: (window.__fake.docs('projects').find(p => p.id === 'p1').cestino || []).length, files: window.__fake.files.size }));
  expect(st.trash === 0 && st.files === 0, 'cestino non svuotato dopo 30 giorni: ' + JSON.stringify(st));
  // qualita' alta da Impostazioni
  await show_(page, 'settings');
  await page.check('input[name=fotoQ][value=alta]');
  await page.waitForFunction(() => fotoQualita() === 'alta');
});

const orderPdf = path.join(fixtures, 'conferma-ordine.pdf');
await test('conferma d\'ordine da PDF', async () => {
  if (!fs.existsSync(orderPdf)) { console.log('       (saltato: manca ' + orderPdf + ')'); return; }
  const r = await page.evaluate(async () => {
    await loadPdfJs();
    const doc = await pdfjsLib.getDocument({ url: '/__fixtures/conferma-ordine.pdf' }).promise;
    let lines = [];
    for (let i = 1; i <= doc.numPages; i++) lines = lines.concat(pdfItemsToLines((await (await doc.getPage(i)).getTextContent()).items));
    return parseOrderConfirmation(lines);
  });
  expect(r.numero === '2078251', 'numero ordine: ' + r.numero);
  expect(r.data === '2026-10-05', 'data: ' + r.data);
  expect(r.progetto === '4840879', 'progetto: ' + r.progetto);
  expect(r.consegna === '2026-10-13', 'consegna: ' + r.consegna);
  expect(r.totaleMerce === 1201.09 && r.trasporto === 290 && r.imponibile === 1491.09, `importi: merce ${r.totaleMerce}, trasporto ${r.trasporto}, imponibile ${r.imponibile}`);
  expect(r.righe && r.righe.length === 1 && r.righe[0].qta === 11 && r.righe[0].um === 'PZ' && r.righe[0].totale === 1201.09, 'righe: ' + JSON.stringify(r.righe));
  expect(r.righe[0].descrizione === 'Isokorb® XT K-O-M1-V1-REI120-CV35-LR145-X120-H160-7.2', 'descrizione: ' + r.righe[0].descrizione);
  const cat = await page.evaluate(r => [articleCategory(r).label, articleMeters(r), articleMeters({ ...r, descrizione: 'Isokorb T Q-VV1-L500-H200' })], r.righe[0]);
  expect(cat[0] === 'Isokorb XT tipo K' && cat[1] === 11 && cat[2] === 5.5, 'categoria/metri: ' + JSON.stringify(cat));
  const pid = await page.evaluate(() => projects[0].id);
  await page.evaluate(([pid, righe]) => db.collection('projects').doc(pid).update({ ordini: [...(projects.find(p => p.id === pid).ordini || []), { id: 'oart', data: todayISO(), numero: '2078251', importo: 1201.09, righe }] }), [pid, r.righe]);
  await page.waitForFunction(pid => (projects.find(p => p.id === pid).ordini || []).some(o => o.id === 'oart'), pid);
  const txt = await show_(page, 'dashboard', "dashboardSubView='projects'; dashProjPeriod='year'");
  expect(/Articoli venduti[\s\S]*11 m[\s\S]*Isokorb XT tipo K/.test(txt), 'Dashboard: articoli venduti mancanti');
  // Bole: kg di ferro dalla sigla (diametro, altezza, pioli, listello)
  const bole = await page.evaluate(() => { const rr = parseOrderLines(['Pos. Codice articolo Qtà. U.m. Prezzo unitario Totale netto', '10 1056928', 'BOLE O/U 12-330-2/450', '150-200-100', 'Prezzo netto 14 PZ 50,00 700,00', '20 1056983', 'BOLE O/U 14-330-2/405', '150-170-85', 'Prezzo netto 96 PZ 60,00 5.760,00', 'Totale merce 6.460,00']); return { rr, cat: rr.map(r => articleCategory(r).label), kg: rr.map(r => Math.round(articleKg(r) * 10) / 10) }; });
  expect(bole.rr.length === 2 && bole.cat[0] === 'Bole O/U Ø12' && bole.cat[1] === 'Bole O/U Ø14', 'Bole lette male: ' + JSON.stringify(bole));
  expect(bole.kg[0] === 13.7 && bole.kg[1] === 123.1, 'peso Bole: ' + JSON.stringify(bole.kg));
  await page.evaluate(([pid, righe]) => db.collection('projects').doc(pid).update({ ordini: [...(projects.find(p => p.id === pid).ordini || []), { id: 'obole', data: todayISO(), numero: '9', importo: 6460, righe }] }), [pid, bole.rr]);
  await page.waitForFunction(pid => (projects.find(p => p.id === pid).ordini || []).some(o => o.id === 'obole'), pid);
  const txt2 = await show_(page, 'dashboard', "dashboardSubView='projects'; dashProjPeriod='year'");
  expect(/Ferro Bole\s*137 kg/.test(txt2) && /Metri lineari\s*11 m/.test(txt2), 'Dashboard: kg delle Bole mancanti');
  // Isokorb tipo S / SK: elementi puntuali, a pezzi e fuori dai metri lineari
  await page.evaluate(pid => db.collection('projects').doc(pid).update({ ordini: [...(projects.find(p => p.id === pid).ordini || []), { id: 'os', data: todayISO(), numero: '11', importo: 848.12, righe: [{ codice: '1300001', descrizione: 'Isokorb® T_S-N-R0-D16-2.0', qta: 26, um: 'PZ', prezzo: 32.62, totale: 848.12 }] }] }), pid);
  await page.waitForFunction(pid => (projects.find(p => p.id === pid).ordini || []).some(o => o.id === 'os'), pid);
  const txt3 = await show_(page, 'dashboard', "dashboardSubView='projects'; dashProjPeriod='year'");
  expect(/Metri lineari\s*11 m/.test(txt3) && /Isokorb S\s*26 pz/.test(txt3) && /Isokorb T tipo S[\s\S]*26 pz/.test(txt3) && !/T_S/.test(txt3), 'tipo S non trattato come elemento puntuale:\n' + txt3.slice(txt3.indexOf('Articoli venduti'), txt3.indexOf('Articoli venduti') + 700));
  expect(await page.evaluate(() => articleVariant({ descrizione: 'Isokorb® T_S-N-R0-D16-2.0' })) === 'N-R0-D16-2.0', 'variante del tipo S');
  // Tronsole: solo nel valore, niente metri ne' dettaglio
  await page.evaluate(pid => db.collection('projects').doc(pid).update({ ordini: [...(projects.find(p => p.id === pid).ordini || []), { id: 'otr', data: todayISO(), numero: '12', importo: 300, righe: [{ codice: '1400001', descrizione: 'Tronsole T-B-L-25', qta: 40, um: 'PZ', prezzo: 7.5, totale: 300 }] }] }), pid);
  await page.waitForFunction(pid => (projects.find(p => p.id === pid).ordini || []).some(o => o.id === 'otr'), pid);
  const txt4 = await show_(page, 'dashboard', "dashboardSubView='projects'; dashProjPeriod='year'");
  expect(/Metri lineari\s*11 m/.test(txt4) && /Tronsole: 300,00\s€ compresi nel valore merce/.test(txt4) && !/Tronsole T/.test(txt4) && /Valore merce\s*8\.809,21/.test(txt4), 'Tronsole non escluse:\n' + txt4.slice(txt4.indexOf('Articoli venduti'), txt4.indexOf('Articoli venduti') + 500));
  // dettaglio per classe M1...M14 e prezzi medi
  await page.evaluate(pid => db.collection('projects').doc(pid).update({ ordini: [...(projects.find(p => p.id === pid).ordini || []), { id: 'om4', data: todayISO(), numero: '10', importo: 650, righe: [{ codice: '1215190', descrizione: 'Isokorb® XT K-O-M4-V1-REI120-CV35-LR145-X120-H180-7.2', qta: 5, um: 'PZ', prezzo: 130, totale: 650 }] }] }), pid);
  await page.waitForFunction(pid => (projects.find(p => p.id === pid).ordini || []).some(o => o.id === 'om4'), pid);
  await show_(page, 'dashboard', "dashboardSubView='projects'; dashProjPeriod='year'");
  await page.click('[data-sold-cat="Isokorb XT tipo K"] > summary');
  const det = await page.evaluate(() => document.querySelector('[data-sold-cat="Isokorb XT tipo K"]').innerText);
  expect(/media 115,69 €\/pz/.test(det) && /M1[\s\S]*11 pz[\s\S]*109,19 €\/pz/.test(det) && /M4[\s\S]*5 pz[\s\S]*130,00 €\/pz/.test(det) && /da 109,19 € a 130,00 €/.test(det), 'dettaglio M1/M4 o prezzi medi sbagliati:\n' + det);
  expect(det.indexOf('M1') < det.indexOf('M4'), 'classi non in ordine');
  await page.evaluate(() => renderMain());
  expect(await page.$('[data-sold-cat="Isokorb XT tipo K"][open]'), 'la categoria aperta si richiude al ridisegno');
  const grp = await page.evaluate(() => document.querySelector('[data-sold-cat="gruppo:Bole"] > summary').innerText);
  expect(/Bole[\s\S]*110 elementi[\s\S]*2 diametri[\s\S]*137 kg/.test(grp), 'gruppo Bole: ' + grp);
  await page.click('[data-sold-cat="gruppo:Bole"] > summary');
  expect(await page.isVisible('[data-sold-cat="Bole O/U Ø14"] > summary'), 'dentro il gruppo mancano i diametri');
  if (shotsDir) {
    await page.click('[data-sold-cat="Bole O/U Ø14"] > summary');
    await page.waitForTimeout(300); await (await page.$('#soldArticles')).screenshot({ path: path.join(shotsDir, 'articoli-pc.png') });
    const vs = page.viewportSize(); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    await (await page.$('#soldArticles')).screenshot({ path: path.join(shotsDir, 'articoli-telefono.png') });
    await page.setViewportSize(vs);
  }
});

const portalPdf = path.join(fixtures, 'portale.pdf');
await test('PDF del portale: lettura e importazione', async () => {
  if (!fs.existsSync(portalPdf)) { console.log('       (saltato: manca ' + portalPdf + ')'); return; }
  await show_(page, 'portal');
  await page.evaluate(async () => {
    const blob = await (await fetch('/__fixtures/portale.pdf')).blob();
    await loadPortalPdf(new File([blob], 'portale.pdf', { type: 'application/pdf' }));
  });
  const st = await page.evaluate(() => {
    const docs = window.__fake.docs('portaleImport');
    const d = docs.map(x => x.dati);
    return { n: docs.length, nc: d.filter(x => /nuova costruzione/i.test(x.categoria || x.tipo || JSON.stringify(x))).length, via: d.filter(x => x.via || x.indirizzo).length, alerts: window.__alerts || [], txt: document.getElementById('main').innerText.slice(0, 300) };
  });
  expect(!st.alerts.length, 'avviso: ' + st.alerts.join(' | '));
  expect(st.n === 895, `cantieri importati: ${st.n} (attesi 894 dal PDF + 1 gia' presente, che non va tolto)`);
  expect(st.via >= 700, `cantieri con indirizzo: ${st.via} (attesi ~740)`);
  // filtro per regione (il PDF e' del Piemonte)
  await show_(page, 'portal', "portalTab='esamina'");
  const regs = await page.$$eval('#pfRegione option', o => o.map(x => x.textContent));
  expect(regs.includes('Piemonte'), 'regioni proposte: ' + regs.join(', '));
  const cnt = await page.evaluate(() => { portalFilters.regione = 'Piemonte'; const a = portalFiltered(portalExamRows()).length; portalFilters.regione = 'Liguria'; const b = portalFiltered(portalExamRows()).length; portalFilters.regione = ''; return [a, b]; });
  expect(cnt[0] > 300 && cnt[1] === 0, 'conteggi per regione (Piemonte, Liguria): ' + cnt.join(', '));
  // ordine per importo materiale stimato: decrescente, senza unita' in fondo
  await page.selectOption('#pfOrdine', 'vol');
  const vols = await page.evaluate(() => portalFiltered(portalExamRows()).map(r => r.vol));
  const bad = vols.findIndex((v, i) => i && (v ?? -1) > (vols[i - 1] ?? -1));
  expect(bad < 0 && vols[0] > 0, 'ordine per importo sbagliato alla posizione ' + bad + ': ' + vols.slice(0, 8).join(', '));
  expect((await page.inputValue('#pfOrdine')) === 'vol', 'la scelta dell\'ordine non resta selezionata');
  await page.evaluate(() => { portalFilters.ordine = 'prio'; });
  // secondo PDF: si aggiunge, non toglie e non duplica; scartati e posizioni restano
  const pid = await page.evaluate(() => { const d = window.__fake.docs('portaleImport').find(x => x.id !== '9000001'); window.__fake.put('portaleImport', d.id, { ...d, scartato: true, geo: { lat: 45, lng: 7, a: 'x' } }); return d.id; });
  await page.evaluate(async () => {
    const blob = await (await fetch('/__fixtures/portale.pdf')).blob();
    await loadPortalPdf(new File([blob], 'portale-bis.pdf', { type: 'application/pdf' }));
  });
  const st2 = await page.evaluate(pid => { const docs = window.__fake.docs('portaleImport'); const d = docs.find(x => x.id === pid); return { n: docs.length, nuovi: docs.filter(x => x.nuovo).length, scartato: d.scartato, geo: !!d.geo, old: docs.some(x => x.id === '9000001'), meta: appSettings.portaleImport }; }, pid);
  expect(st2.n === 895 && st2.old, 'il secondo PDF ha tolto o duplicato cantieri: ' + st2.n);
  expect(st2.scartato && st2.geo, 'il secondo PDF ha perso scartato o posizione: ' + JSON.stringify({ s: st2.scartato, g: st2.geo }));
  expect(st2.nuovi === 0 && st2.meta.nuovi === 0 && st2.meta.files.length === 2, 'nuovi/metadati dopo il secondo PDF: ' + JSON.stringify({ nuovi: st2.nuovi, meta: st2.meta }));
});

// telefono: niente deve uscire dalla larghezza dello schermo
await ctx.close();
({ ctx, page } = await openApp({ width: 390, height: 844 }));
// Chrome di prova: la posizione simulata va letta una volta prima che la Mappa la segua, altrimenti le
// letture successive scadono (solo nel browser di test)
await page.evaluate(() => new Promise(r => navigator.geolocation.getCurrentPosition(r, r, { timeout: 5000 })));
await test('telefono: nessuna pagina piu\' larga dello schermo', async () => {
  const bad = [];
  const pages = [['agenda'], ['contactsList'], ['call'], ['detail', "selectedId='c1'"], ['projects'], ['projectDetail', "selectedProjectId='p1'"], ['forecast'], ['dashboard'], ['settings'], ['portal'], ['table'], ['appt'], ['followup'], ['dashboard', "dashboardDrilldown=null; dashboardSubView='report'"], ['map'], ['deliveries', "delTab='fatt'"], ['deliveries', "delTab='consegne'"], ['regali'], ['segnalati'], ['sop', "sopEdit={ id:'new', prefill:{}, back:{ view:'appt', tab:'navAppt' } }"], ['rete']];
  for (const [v, extra] of pages) {
    await show_(page, v, extra || '');
    await settle(page);
    if (v === 'rete') await page.waitForFunction(() => !document.getElementById('reteGraph') || document.querySelector('#reteGraph canvas'), null, { timeout: 20000 }).catch(() => {});   // la mappa della rete si disegna dopo aver caricato d3
    const w = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth, out = [];
      document.querySelectorAll('#main *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > vw + 1 && !el.closest('.table-wrap, .map-embed, .plan-scroll, [style*="overflow"]')) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} (destra ${Math.round(r.right)} > ${vw})`);
      });
      return out.slice(0, 3);
    });
    if (w.length) bad.push(`${v}: ${w.join(', ')}`);
    if (shotsDir) {
      // la pagina scorre dentro #main: per la schermata intera si sblocca l'altezza
      await page.evaluate(() => { for (let el = document.getElementById('main'); el; el = el.parentElement) { el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; } });
      await page.screenshot({ path: path.join(shotsDir, `${v}.png`), fullPage: true });
      await page.evaluate(() => { for (let el = document.getElementById('main'); el; el = el.parentElement) el.removeAttribute('style'); });
    }
  }
  expect(!bad.length, bad.join('\n'));
  if (shotsDir) console.log('       schermate in ' + shotsDir);
});

await test('mappa: cantieri del portale seguiti e da valutare', async () => {
  await page.evaluate(() => { mapFilters.portaleEsame = false; mapFilters.portaleSeguiti = true; });
  await show_(page, 'map');
  await page.waitForSelector('.map-mk.dm.seguito', { timeout: 15000 });
  expect(!(await page.$('.map-mk.dm.esame')), 'i cantieri da valutare non devono comparire con il filtro spento');
  await page.check('[data-map-filter="portaleEsame"]');
  await page.waitForSelector('.map-mk.dm.esame', { timeout: 15000 });
  const g = await page.evaluate(() => ({ imp: (window.__fake.docs('portaleImport').find(d => d.id === '9000001') || {}).geo, seg: (window.__fake.docs('portale').find(d => d.id === 'ps1') || {}).geo }));
  expect(g.imp && g.imp.lat && g.seg && g.seg.a === 'Corso Italia 5, Alba', 'posizioni non salvate: ' + JSON.stringify(g));
  // nel test tutti gli indirizzi hanno la stessa posizione: segnaposto sovrapposti, clic diretto
  await page.$eval('.map-mk.dm.seguito', el => el.parentElement.click());
  await page.waitForSelector('.map-pop [data-portal-goto]');
  expect((await page.textContent('.map-pop')).includes('richiamare a novembre'), 'manca la nota nel fumetto');
  await page.click('.map-pop [data-portal-goto]');
  await page.waitForFunction(() => view === 'portal' && portalTab === 'seguiti');
  // pulsante fisso per tornare alla mappa
  await page.waitForSelector('#mapReturnBtn');
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, 'torna-alla-mappa.png') });
  await page.click('#mapReturnBtn');
  await page.waitForFunction(() => view === 'map' && !document.getElementById('mapReturnBtn'));
  await page.$eval('#navAgenda', b => b.click());
  expect(!(await page.$('#mapReturnBtn')), 'il pulsante resta anche cambiando sezione');
  await page.evaluate(() => { mapFilters.portaleEsame = false; });
});

await test('consegne: elenco, posticipa, consegnato, annulla', async () => {
  await page.$eval('#navDeliveries', b => b.click());
  const txt = await page.evaluate(() => document.getElementById('main').innerText);
  expect(txt.includes('In ritardo') && txt.includes('Villa Gamma') && txt.includes('Senza data di consegna'), 'sezioni mancanti:\n' + txt.slice(0, 500));
  expect((await page.textContent('#delBadge')).trim() === '1', 'badge del menu: ' + (await page.textContent('#delBadge')));
  const o = id => page.evaluate(id => window.__fake.docs('projects').find(p => p.id === 'p3').ordini.find(x => x.id === id), id);
  const p3 = () => page.evaluate(() => window.__fake.docs('projects').find(p => p.id === 'p3'));
  await page.click('[data-del-key="p3|o2"] [data-del-mode="post"]');
  await page.click('[data-del-plus="7"]');
  await page.click('[data-del-save="post"]');
  await page.waitForFunction(() => window.__fake.docs('projects').find(p => p.id === 'p3').ordini.find(x => x.id === 'o2').rinvii === 1);
  let r = await o('o2');
  expect(r.consegna === daysAgo(-4) && r.consegnaIniziale === daysAgo(3), 'posticipo: ' + JSON.stringify(r));
  await page.click('[data-del-key="p3|o3"] [data-del-mode="done"]');
  await page.click('[data-del-save="done"]');
  await page.waitForFunction(() => !!window.__fake.docs('projects').find(p => p.id === 'p3').ordini.find(x => x.id === 'o3').consegnatoIl);
  expect((await p3()).fasi.merceCantiere === iso(new Date()), 'la fase "Merce arrivata in cantiere" non e\' stata compilata');
  await page.waitForSelector('[data-del-key="p3|o3"] [data-del-undo]', { state: 'attached' });
  await page.$eval('[data-del-key="p3|o3"] [data-del-undo]', b => b.click());
  await page.waitForFunction(() => !window.__fake.docs('projects').find(p => p.id === 'p3').ordini.find(x => x.id === 'o3').consegnatoIl);
  expect(!(await p3()).fasi.merceCantiere, 'annullando la consegna la fase doveva tornare vuota');
  // la modifica dalla scheda progetto conserva i rinvii
  await show_(page, 'projectDetail', "selectedProjectId='p3'");
  await page.click('[data-order-edit="o2"]');
  await page.click('#ordSaveBtn');
  await page.waitForFunction(() => !orderEdit);
  r = await o('o2');
  expect(r.rinvii === 1 && r.consegnaIniziale, 'la modifica dell\'ordine ha perso i rinvii');
});

await test('chiamata senza risposta: follow-up proposto dopo 7 giorni', async () => {
  await show_(page, 'detail', "selectedId='c4'");
  await page.selectOption('#callEsito', 'Nessuna risposta');
  expect(await page.inputValue('#callFollowUpDate') === daysAgo(-7) && await page.inputValue('#callFollowUpTime') === '09:00', 'follow-up non proposto: ' + await page.inputValue('#callFollowUpDate'));
  await page.selectOption('#callEsito', 'Interessato');
  expect(await page.inputValue('#callFollowUpDate') === '', 'cambiando esito il follow-up proposto doveva sparire');
  await page.selectOption('#callEsito', 'Filtrato dalla segreteria');
  await page.fill('#callNote', 'segreteria');
  await page.click('#saveCallBtn');
  await page.waitForFunction(() => window.__fake.docs('calls').some(k => k.note === 'segreteria'));
  await page.waitForFunction(d => (window.__fake.docs('contacts').find(c => c.id === 'c4') || {}).followUp === d + 'T09:00', daysAgo(-7));
});

await test('contatto spento: in grigio, fuori dai follow-up, riattivabile', async () => {
  await show_(page, 'detail', "selectedId='c4'");
  await page.click('#offBtn');
  await page.selectOption('#offMotivo', 'In pensione');
  await page.click('#offConfirmBtn');
  await page.waitForFunction(() => !!(window.__fake.docs('contacts').find(c => c.id === 'c4') || {}).spento);
  const c = await page.evaluate(() => window.__fake.docs('contacts').find(c => c.id === 'c4'));
  expect(c.spento.motivo === 'In pensione' && !c.followUp, 'dati del contatto spento: ' + JSON.stringify(c));
  await page.waitForSelector('#offReactivateBtn');
  const list = await show_(page, 'contactsList');
  expect(await page.$('.card.contact-off[data-contact-id="c4"]'), 'nell\'elenco contatti non e\' in grigio');
  await page.evaluate(() => window.__fake.put('contacts', 'c4', { ...window.__fake.docs('contacts').find(c => c.id === 'c4'), followUp: '2020-01-01T09:00' }));
  await page.waitForFunction(() => contacts.find(c => c.id === 'c4').followUp === '2020-01-01T09:00');
  const agenda = await show_(page, 'agenda');
  expect(!/Verdi Paolo/.test(agenda.split('Follow-up da fare')[1].split('Da fare')[0]), 'il contatto spento compare tra i follow-up');
  await show_(page, 'detail', "selectedId='c4'");
  await page.click('#offReactivateBtn');
  await page.waitForFunction(() => !(window.__fake.docs('contacts').find(c => c.id === 'c4') || {}).spento);
});

await test('sopralluoghi: pianifica dal progetto, agenda, mappa, esito, elimina', async () => {
  await show_(page, 'projectDetail', "selectedProjectId='p1'");
  await page.click('[data-sop-project="p1"]');
  await page.waitForSelector('#sopDate');
  await page.fill('#sopDate', daysAgo(-1));
  await page.selectOption('#sopTime', '10:00');
  await page.fill('#sopNote', 'verificare i balconi');
  await page.click('#sopSaveBtn');
  await page.waitForFunction(() => window.__fake.docs('sopralluoghi').length === 1);
  await page.waitForFunction(() => view === 'projectDetail');
  const s = (await page.evaluate(() => window.__fake.docs('sopralluoghi')))[0];
  expect(s.projectId === 'p1' && s.quando === daysAgo(-1) + 'T10:00' && s.durata === 10, 'sopralluogo salvato male: ' + JSON.stringify(s));
  expect((await page.textContent('#main')).includes('verificare i balconi'), 'non compare nella scheda progetto');
  // agenda per pianificare: mostra gli impegni della settimana e un clic sceglie giorno e ora
  await show_(page, 'appt', "apptSubView='list'");
  await page.click('#main [data-sop-new]');
  await page.waitForSelector('.planner .plan-grid');
  await page.fill('#sopDate', daysAgo(-1));
  await page.$eval('#sopDate', i => i.dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForSelector('.planner .plan-ev.sop');
  await page.$eval(`.planner [data-plan-day="${daysAgo(-1)}"][data-plan-time="14:00"]`, s => s.click());
  expect(await page.inputValue('#sopTime') === '14:00' && await page.inputValue('#sopDate') === daysAgo(-1), 'il clic sull\'agenda non ha scelto giorno e ora');
  expect(await page.$('.planner .plan-ev.new'), 'manca il nuovo impegno tratteggiato');
  expect((await page.textContent('.planner .plan-ev.sop')).includes('Via Po 10, Torino'), 'manca l\'indirizzo sotto il nome');
  await page.$eval('.planner .plan-ev.sop', el => el.click());
  const info = await page.textContent('.planner .plan-info');
  expect(await page.isVisible('.planner .plan-info') && info.includes('Via Po 10, Torino · Vedi su Maps') && info.includes('verificare i balconi'), 'scheda dell\'impegno: ' + info);
  expect(await page.evaluate(() => view) === 'sop', 'toccare un impegno non deve uscire dal modulo');
  // trascinamento: impegno gia' fissato (con conferma) e blocco "questo"
  const drag = async (fromSel, toSel) => {
    await page.$eval(fromSel, el => el.scrollIntoView({ block: 'center' }));
    const a = await page.locator(fromSel).boundingBox();
    await page.mouse.move(a.x + 10, a.y + 5); await page.mouse.down();
    await page.mouse.move(a.x + 14, a.y + 12, { steps: 3 });
    await page.$eval(toSel, el => el.scrollIntoView({ block: 'nearest' }));
    const b = await page.locator(toSel).boundingBox();
    await page.mouse.move(b.x + 10, b.y + 5, { steps: 8 }); await page.mouse.up();
  };
  await drag('.planner .plan-ev.sop', `.planner [data-plan-day="${daysAgo(-1)}"][data-plan-time="12:00"]`);
  expect((await page.textContent('.planner .plan-info')).includes('Spostare'), 'manca la conferma dello spostamento');
  await page.click('.planner [data-plan-move]');
  await page.waitForFunction(d => window.__fake.docs('sopralluoghi').some(s => s.quando === d + 'T12:00'), daysAgo(-1));
  await drag('.planner .plan-ev.new', `.planner [data-plan-day="${daysAgo(-1)}"][data-plan-time="16:00"]`);
  expect(await page.inputValue('#sopTime') === '16:00', 'trascinare "questo" doveva cambiare l\'ora del modulo: ' + await page.inputValue('#sopTime'));
  await page.selectOption('#sopTime', '14:00');
  await page.$eval('#sopTime', i => i.dispatchEvent(new Event('change', { bubbles: true })));
  if (shotsDir) await (await page.$('.planner')).screenshot({ path: path.join(shotsDir, 'agenda-pianifica.png') });
  await page.click('#sopBackBtn');
  // anche negli appuntamenti delle chiamate
  await show_(page, 'detail', "selectedId='c1'");
  expect(await page.$('#callApptWrap .planner .plan-grid'), 'manca l\'agenda nel modulo dell\'appuntamento');
  // cantiere non presente tra i progetti, oggi piu' tardi
  await page.evaluate(d => window.__fake.put('sopralluoghi', 'sx', { quando: d + 'T23:30', durata: 60, projectId: '', titolo: 'Cantiere di prova', via: 'Via Milano 3', citta: 'Bra', note: '' }), daysAgo(0));
  await page.waitForFunction(() => sops.length === 2);
  const agenda = await show_(page, 'agenda');
  expect(agenda.includes('Cantiere di prova'), 'il sopralluogo di oggi non compare in Oggi');
  expect((await page.textContent('#sidebarToday')).includes('Cantiere di prova'), 'non compare nel riepilogo laterale');
  const appt = await show_(page, 'appt', "apptSubView='list'");
  expect(appt.includes('Residenza Aurora') && appt.includes('Cantiere di prova'), 'non compaiono negli Appuntamenti');
  await show_(page, 'appt', "apptSubView='calendar'; apptWeekOffset=0");
  expect(await page.$('.appt-chip.sop'), 'non compare nel calendario settimanale');
  await page.evaluate(() => { mapFilters.portaleSeguiti = false; });
  await show_(page, 'map');
  await page.waitForSelector('.map-mk.sop', { timeout: 15000 });
  // apertura dal calendario, esito ed eliminazione
  await show_(page, 'appt', "apptSubView='list'");
  await page.click('#main [data-sop-id="sx"] .sop-tag');   // sul titolo: al centro della scheda c'e' il link alla mappa
  await page.waitForSelector('#sopNoteDopo');
  await page.fill('#sopNoteDopo', 'getto previsto a novembre');
  await page.click('#sopSaveBtn');
  await page.waitForFunction(() => (window.__fake.docs('sopralluoghi').find(s => s.id === 'sx') || {}).noteDopo === 'getto previsto a novembre');
  await page.waitForFunction(() => view === 'appt');
  await page.click('#main [data-sop-id="sx"] .sop-tag');   // sul titolo: al centro della scheda c'e' il link alla mappa
  await page.click('#sopDelBtn');
  await page.click('#sopDelYes');
  await page.waitForFunction(() => !window.__fake.docs('sopralluoghi').some(s => s.id === 'sx'));
  await page.evaluate(() => { mapFilters.portaleSeguiti = true; });
});

await test('suggerisci quando: incastra il sopralluogo prima dell\'appuntamento a Casale', async () => {
  // primo giorno lavorativo da domani in poi, appuntamento alle 16 a Casale
  const D = await page.evaluate(() => { for (let i = 2; i < 9; i++) { const d = addDaysISO(todayISO(), i), w = new Date(d + 'T12:00:00').getDay(); if (w && w !== 6) return d; } });
  await page.evaluate(D => {
    window.__fake.put('contacts', 'c5', { nome: 'Test', cognome: 'Casale', via: 'Via Roma 5', citta: 'Casale Monferrato' });
    window.__fake.put('calls', 'k5', { contactId: 'c5', data: todayISO(), esito: 'Appuntamento fissato', appuntamento: D + 'T16:00', note: '' });
  }, D);
  await page.waitForFunction(() => calls.some(k => k.id === 'k5'));
  await show_(page, 'appt', "apptSubView='list'");
  await page.click('#main [data-sop-new]');
  await page.waitForSelector('#sopVia');
  await page.fill('#sopTitolo', 'Prova Corso Lione');
  await page.fill('#sopVia', 'Corso Lione 10');
  await page.fill('#sopCitta', 'Torino');
  expect(await page.inputValue('#sopDur') === '10', 'durata predefinita del sopralluogo: ' + await page.inputValue('#sopDur'));
  await page.click('[data-trip-run]');
  await page.waitForSelector('.trip-opt', { timeout: 30000 });
  const txt = await page.textContent('.trip-list');
  expect(txt.includes('Casale Test alle 16:00'), 'nessun suggerimento prima dell\'appuntamento a Casale:\n' + txt);
  const picks = await page.$$eval('.trip-opt', b => b.map(x => x.dataset.tripPick));
  const mine = picks.find(p => p.startsWith(D + '|'));
  expect(mine, 'manca il giorno dell\'appuntamento a Casale (' + D + ') tra i suggerimenti: ' + picks.join(', '));
  const t = mine.split('|')[1];
  expect(t < '16:00' && t > '13:00', 'orario suggerito poco sensato: ' + t);
  await page.click(`.trip-opt[data-trip-pick="${mine}"]`);
  expect(await page.inputValue('#sopDate') === D && await page.inputValue('#sopTime') === t, 'il suggerimento non ha compilato data e ora');
  if (shotsDir) await (await page.$('.trip-box')).screenshot({ path: path.join(shotsDir, 'suggerisci-quando.png') });
  await page.click('#sopBackBtn');
});

await test('fasi: in attesa di Michael, file allegato alla fase dalla timeline e da Oggi', async () => {
  await page.evaluate(d => window.__fake.put('projects', 'p4', { codice: '4800004', nome: 'Torre Delta', via: 'Via Roma 9', citta: 'Torino', partecipanti: [], fasi: { richiesta: d }, createdAt: 4, updatedAt: 4 }), daysAgo(10));
  await page.waitForFunction(() => projects.some(p => p.id === 'p4'));
  let txt = await show_(page, 'agenda');
  expect(await page.$('#waitingCard[open]') && /In attesa di Michael \/ Claudia\s*1/.test(await page.textContent('#waitingCard')) && txt.includes('Torre Delta') && txt.includes('attesa da Michael da 10 giorni'), 'manca il promemoria:\n' + txt.slice(0, 1500));
  const file = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prova') });
  let [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#main [data-phase-attach="p4|propostaTecnica"]')]);
  await fc.setFiles(file('proposta-tecnica.pdf'));
  await page.waitForFunction(() => (window.__fake.docs('projects').find(p => p.id === 'p4').fasi || {}).propostaTecnica, null, { timeout: 15000 }).catch(async e => { throw new Error('passo 1 (proposta): ' + JSON.stringify(await page.evaluate(() => ({ p4: window.__fake.docs('projects').find(p => p.id === 'p4'), files: [...window.__fake.files.keys()], notice: document.getElementById('noticeBar').innerText, view })))); });
  let p4 = await page.evaluate(() => window.__fake.docs('projects').find(p => p.id === 'p4'));
  expect(p4.fasi.propostaTecnica === daysAgo(0) && (p4.allegati || []).some(a => a.tag === 'propostaTecnica' && a.nome === 'proposta-tecnica.pdf'), 'file o fase non registrati: ' + JSON.stringify(p4));
  await page.waitForFunction(() => (projects.find(p => p.id === 'p4').fasi || {}).propostaTecnica);   // l'app riceve l'aggiornamento un attimo dopo
  txt = await show_(page, 'agenda');
  expect(!(await page.textContent('#waitingCard')).includes('Torre Delta'), 'dopo l\'arrivo la commessa non deve essere piu\' in attesa');
  expect(await page.$('#waitingCard:not([open])'), 'senza commesse in attesa il riquadro deve restare chiuso');
  await show_(page, 'projectDetail', "selectedProjectId='p4'");
  expect((await page.textContent('#main .timeline')).includes('proposta-tecnica.pdf'), 'il file non compare sotto la fase');
  [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#main [data-phase-attach="p4|offertaEconomica"]')]);
  await fc.setFiles(file('offerta.pdf'));
  await page.waitForFunction(() => (window.__fake.docs('projects').find(p => p.id === 'p4').fasi || {}).offertaEconomica, null, { timeout: 15000 }).catch(async e => { throw new Error('passo 2 (offerta): ' + JSON.stringify(await page.evaluate(() => ({ p4: window.__fake.docs('projects').find(p => p.id === 'p4'), notice: document.getElementById('noticeBar').innerText, view })))); });
  p4 = await page.evaluate(() => window.__fake.docs('projects').find(p => p.id === 'p4'));
  expect(p4.allegati.length === 2 && p4.allegati.some(a => a.tag === 'offertaEconomica'), 'offerta non allegata: ' + JSON.stringify(p4.allegati));
  await page.waitForFunction(() => document.querySelector('#main .timeline') && document.querySelector('#main .timeline').textContent.includes('offerta.pdf'), null, { timeout: 15000 }).catch(async e => { throw new Error('passo 3 (timeline): ' + JSON.stringify(await page.evaluate(() => ({ view, can: canAutoRender(), hold: plannerHold - Date.now(), glob: (projects.find(p => p.id === 'p4') || {}).fasi })))); });
});

await test('cosa fare in zona e la mia posizione sulla mappa', async () => {
  await page.evaluate(() => {
    const s = window.__fake.docs('portale').find(d => d.id === 'ps1'); window.__fake.put('portale', 'ps1', { ...s, geo: { lat: 44.70, lng: 8.03, a: 'Corso Italia 5, Alba', v: GEO_V } });
    const i = window.__fake.docs('portaleImport').find(d => d.id === '9000001'); window.__fake.put('portaleImport', '9000001', { ...i, geo: { lat: 45.07, lng: 7.68, a: 'Torino', v: GEO_V } });
  });
  await show_(page, 'agenda', 'startPortalImport()');
  await page.waitForFunction(() => portalImport && portalImport.get('9000001') && portalImport.get('9000001').geo && portalSaved.get('9000002') && portalSaved.get('9000002').geo);
  await show_(page, 'agenda');
  await page.fill('#zonePlace', 'Alba');
  await page.click('[data-zone-place]');
  await page.waitForFunction(() => /Giro di[\s\S]*?da Alba/.test(document.querySelector('.zone-card').innerText));
  let txt = await page.textContent('.zone-card');
  expect(txt.includes('Palazzina di 8 alloggi') && !txt.includes('Nuovo complesso residenziale'), 'cantieri vicino ad Alba:\n' + txt);
  expect(/Giro di 1 tappa/.test(txt), 'riepilogo del giro:\n' + txt);
  const href = await page.getAttribute('.zone-sum a.btn', 'href');
  expect(href.includes('origin=44.7,8.03') && href.includes('destination=44.7,8.03') && href.includes('travelmode=driving'), 'link del giro: ' + href);
  await page.click('[data-zone-here]');
  await page.waitForFunction(() => /Giro di[\s\S]*?dalla tua posizione/.test(document.querySelector('.zone-card').innerText));
  txt = await page.textContent('.zone-card');
  expect(txt.includes('Nuovo complesso residenziale') && txt.includes('Residenza Aurora') && !txt.includes('Palazzina di 8 alloggi'), 'cantieri vicino a Torino:\n' + txt);
  expect(/Giro di 2 tappe/.test(txt) && txt.includes('dalla partenza') && txt.includes('dalla tappa 1'), 'tappe del giro:\n' + txt);
  await page.waitForFunction(() => document.querySelectorAll('#zoneMap .zone-pin').length === 3 && document.querySelector('#zoneMap .leaflet-interactive'));
  await page.click('.zone-route [data-zone-drop]');
  await page.waitForFunction(() => /Giro di 1 tappa/.test(document.querySelector('.zone-card').innerText) && /Altri cantieri nel raggio \(1\)/.test(document.querySelector('.zone-card').innerText));
  await page.click('.zone-others summary');
  await page.click('.zone-others [data-zone-add]');
  await page.waitForFunction(() => /Giro di 2 tappe/.test(document.querySelector('.zone-card').innerText));
  if (shotsDir) await (await page.$('.zone-card')).screenshot({ path: path.join(shotsDir, 'cosa-fare-in-zona.png') });
  await page.click('.zone-card [data-zone-map]');
  await page.waitForFunction(() => view === 'map');
  await page.waitForSelector('.me-dot', { timeout: 15000 });
});

await test('indirizzi: aprono la posizione su Maps, non le indicazioni', async () => {
  await show_(page, 'detail', "selectedId='c1'");
  const href = await page.getAttribute('#main a.addr-link[href*="google.com/maps"]', 'href');
  expect(href.startsWith('https://www.google.com/maps/search/?api=1&query=') && !href.includes('/dir/') && /Vedi su Maps/.test(await page.textContent('#main a.addr-link[href*="google.com/maps"]')), 'link indirizzo: ' + href);
});

await test('contatto: salva nella rubrica del telefono (vCard)', async () => {
  await show_(page, 'detail', "selectedId='c1'");
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#vcardBtn')]);
  const txt = fs.readFileSync(await dl.path(), 'utf8');
  expect(dl.suggestedFilename() === 'Rossi Mario.vcf', 'nome del file: ' + dl.suggestedFilename());
  for (const l of ['BEGIN:VCARD', 'N:Rossi;Mario;;;', 'FN:Mario Rossi', 'ORG:Studio Rossi', 'TITLE:Architetto', 'TEL;TYPE=CELL,VOICE:333 1234567', 'EMAIL;TYPE=INTERNET,WORK:mario@studiorossi.it', 'ADR;TYPE=WORK:;;Via Roma 1;Torino;;;Italia', 'END:VCARD'])
    expect(txt.includes(l + '\r\n'), 'manca nel vCard: ' + l + '\n' + txt);
});

await test('mail di presentazione: firma richiesta, poi Outlook con destinatario, oggetto e testo', async () => {
  await show_(page, 'detail', "selectedId='c1'");
  await page.click('[data-mail-pres="c1"]');
  expect((await page.textContent('#noticeBar')).includes('manca la tua firma'), 'senza firma doveva chiedere di impostarla');
  await show_(page, 'settings');
  await page.fill('#mpFirma', 'Geom. Prova Test');
  await page.press('#mpFirma', 'Tab');
  await page.waitForFunction(() => (appSettings.mailPres || {}).firma === 'Geom. Prova Test');
  await show_(page, 'detail', "selectedId='c1'");
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.click('[data-mail-pres="c1"]')]);
  const u = new URL(pop.url());
  expect(u.hostname === 'outlook.office.com' && u.searchParams.get('to') === 'mario@studiorossi.it', 'indirizzo: ' + pop.url());
  expect(!u.searchParams.has('body'), 'il testo va negli appunti, non nel collegamento: ' + pop.url());
  expect(u.searchParams.get('subject').includes('Isokorb'), 'oggetto: ' + u.searchParams.get('subject'));
  expect(!pop.url().includes('+') && pop.url().includes('subject=SCH%C3%96CK%20Isokorb'), 'spazi dell\'oggetto da scrivere come %20, non +: ' + pop.url());
  // testo formattato negli appunti, con il grassetto
  const clip = await page.evaluate(async () => { const it = (await navigator.clipboard.read())[0]; return { html: await (await it.getType('text/html')).text(), txt: await (await it.getType('text/plain')).text() }; });
  expect(clip.html.includes('<b>Isokorb</b>') && clip.html.includes('<b>15 minuti</b>') && clip.html.includes('Geom. Prova Test'), 'appunti (html): ' + clip.html.slice(0, 300));
  expect(clip.txt.startsWith('Buongiorno, sono Geom. Prova Test, Tecnico Commerciale Schöck GmbH.') && !clip.txt.includes('**'), 'appunti (testo): ' + clip.txt.slice(0, 200));
  expect((await page.textContent('#noticeBar')).includes('copiato con il grassetto'), 'manca l\'indicazione di incollare');
  await pop.close();
  await page.waitForFunction(() => window.__fake.docs('calls').some(m => m.contactId === 'c1' && m.tipo === 'mail' && m.sottotipo === 'presentazione' && m.oggetto.includes('Isokorb')));
  await show_(page, 'detail', "selectedId='c1'");
  await page.waitForFunction(() => /Mail[\s\S]*presentazione/i.test(document.querySelector('.last-card').innerText));
  // registrata per sbaglio: si toglie
  await page.click('.last-mails summary');
  await page.click('.last-mails [data-mail-del]');
  await page.click('.last-mails [data-mail-del-yes]');
  await page.waitForFunction(() => !window.__fake.docs('calls').some(m => m.contactId === 'c1' && m.tipo === 'mail'));
});

await test('ultimi contatti: la mail conta per i promemoria Da ricontattare', async () => {
  await page.evaluate(([d10, d100, d2]) => {
    window.__fake.put('contacts', 'c7', { nome: 'Solo', cognome: 'Mail' });
    window.__fake.put('calls', 'm7', { tipo: 'mail', sottotipo: 'presentazione', contactId: 'c7', data: d10, ora: '10:00', oggetto: 'x' });
    window.__fake.put('contacts', 'c8', { nome: 'Vecchio', cognome: 'Cliente' });
    window.__fake.put('calls', 'k8', { contactId: 'c8', data: d100, esito: 'Interessato', note: '' });
  }, [daysAgo(10), daysAgo(100), daysAgo(2)]);
  await page.waitForFunction(() => calls.some(m => m.id === 'm7') && calls.some(k => k.id === 'k8'));
  let txt = await show_(page, 'agenda');
  expect(txt.includes('Mail Solo') && txt.includes('mail di presentazione inviata 10 giorni fa'), 'contatto con sola mail non proposto:\n' + txt.slice(0, 2000));
  expect(txt.includes('Cliente Vecchio'), 'il cliente fermo da 100 giorni doveva essere da ricontattare');
  await page.evaluate(d2 => window.__fake.put('calls', 'm8', { tipo: 'mail', sottotipo: 'presentazione', contactId: 'c8', data: d2, ora: '09:00', oggetto: 'x' }), daysAgo(2));
  await page.waitForFunction(() => calls.some(m => m.id === 'm8'));
  txt = await show_(page, 'agenda');
  expect(!txt.includes('Cliente Vecchio'), 'dopo una mail di 2 giorni fa il cliente non va ancora richiamato');
  await show_(page, 'detail', "selectedId='c8'");
  const last = await page.textContent('.last-card');
  expect(last.includes('Interessato') && /Mail[\s\S]*2 giorni fa/i.test(last), 'riquadro ultimi contatti: ' + last);
});

await test('attività: conversione dei vecchi incontri, incontro e mail registrati, Registra l\'incontro', async () => {
  // conversione una tantum: l'appuntamento passato k2 (seme) e' diventato anche un incontro a se'
  await page.waitForFunction(() => appSettings.attivitaV2);
  let st = await page.evaluate(() => { const k2 = calls.find(k => k.id === 'k2'); return { k2, m: calls.find(k => k.tipo === 'incontro' && k.daAppuntamento === 'k2') }; });
  expect(st.k2.incontroId && st.m && st.m.id === st.k2.incontroId && st.m.data === st.k2.appuntamento.slice(0, 10), 'conversione: ' + JSON.stringify(st));
  // incontro registrato dalla scheda contatto
  await show_(page, 'detail', "selectedId='c4'");
  await page.click('#actFormCard [data-act-type="incontro"]');
  if (shotsDir) await (await page.$('#actFormCard')).screenshot({ path: path.join(shotsDir, 'attivita-incontro.png') });
  expect(await page.isVisible('#callMeetNote') && !(await page.isVisible('#callEsito')) && (await page.textContent('#saveCallBtn')) === 'Salva incontro', 'sezioni dell\'incontro');
  await page.fill('#callDate', daysAgo(1));
  await page.selectOption('#callMeetTime', '15:00');
  await page.fill('#callMeetNote', 'visto il cantiere, interessati');
  await page.click('#saveCallBtn');
  await page.waitForFunction(() => calls.some(k => k.tipo === 'incontro' && k.note === 'visto il cantiere, interessati'));
  st = await page.evaluate(() => calls.find(k => k.note === 'visto il cantiere, interessati'));
  expect(st.contactId === 'c4' && st.data === daysAgo(1) && st.ora === '15:00' && !st.esito, 'incontro salvato: ' + JSON.stringify(st));
  // mail incollata da Outlook: oggetto, data e ora letti dal testo
  await page.waitForSelector('#actFormCard [data-act-type="mail"]');
  await page.click('#actFormCard [data-act-type="mail"]');
  await page.fill('#callMailPaste', 'Da: Alessandro\nInviato: lunedì 12 ottobre 2026 18:04\nA: info@verdi.it\nOggetto: Offerta Isokorb per Via Roma\n\nBuongiorno, come d\'accordo...');
  expect(await page.inputValue('#callMailSubj') === 'Offerta Isokorb per Via Roma' && await page.inputValue('#callDate') === '2026-10-12', 'lettura della mail incollata');
  await page.click('#saveCallBtn');
  await page.waitForFunction(() => calls.some(k => k.tipo === 'mail' && k.oggetto === 'Offerta Isokorb per Via Roma'));
  st = await page.evaluate(() => calls.find(k => k.oggetto === 'Offerta Isokorb per Via Roma'));
  expect(st.data === '2026-10-12' && st.ora === '18:04' && st.testo.includes('come d\'accordo'), 'mail salvata: ' + JSON.stringify(st));
  const hist = await page.textContent('#main');
  expect(hist.includes('Storico attività') && /Incontro/.test(hist) && hist.includes('Offerta Isokorb per Via Roma'), 'storico attività');
  // appuntamento passato da registrare: da Oggi a "Registra l'incontro" precompilato
  await page.evaluate(d => window.__fake.put('calls', 'k9a', { contactId: 'c3', data: d, esito: 'Appuntamento fissato', appuntamento: d + 'T11:30', note: '', progetti: ['p2'] }), daysAgo(2));
  await page.waitForFunction(() => calls.some(k => k.id === 'k9a'));
  await show_(page, 'agenda');
  await page.waitForSelector('.meet-reg-card [data-meet-register="k9a"]');
  await page.click('.meet-reg-card [data-meet-register="k9a"]');
  await page.waitForFunction(() => view === 'detail' && selectedId === 'c3' && document.querySelector('#actFormCard [data-act-type="incontro"].on'));
  expect(await page.inputValue('#callDate') === daysAgo(2) && await page.inputValue('#callMeetTime') === '11:30', 'incontro non precompilato');
  await page.fill('#callMeetNote', 'incontro registrato da Oggi');
  await page.click('#saveCallBtn');
  await page.waitForFunction(() => { const m = calls.find(k => k.note === 'incontro registrato da Oggi'); const a = calls.find(k => k.id === 'k9a'); return m && a && a.incontroId === m.id; });
  st = await page.evaluate(() => calls.find(k => k.note === 'incontro registrato da Oggi'));
  expect(st.daAppuntamento === 'k9a' && (st.progetti || []).includes('p2'), 'collegamento con l\'appuntamento: ' + JSON.stringify(st));
  const ag = await show_(page, 'agenda');
  expect(!ag.includes('Incontri da registrare') || !(await page.$('[data-meet-register="k9a"]')), 'l\'appuntamento registrato non deve restare da registrare');
});

await test('clic su un appuntamento: oggi -> registra l\'incontro, registrato -> incontro, futuro -> telefonata', async () => {
  await page.evaluate(([d0, d5]) => {
    window.__fake.put('calls', 'k9b', { contactId: 'c3', data: d0, esito: 'Appuntamento fissato', appuntamento: d0 + 'T00:05', note: 'fissato' });
    window.__fake.put('calls', 'k9c', { contactId: 'c4', data: d0, esito: 'Appuntamento fissato', appuntamento: d5 + 'T10:00', note: 'futuro' });
  }, [daysAgo(0), daysAgo(-5)]);
  await page.waitForFunction(() => calls.some(k => k.id === 'k9b') && calls.some(k => k.id === 'k9c'));
  await show_(page, 'agenda');
  await page.click('#main [data-appt-call-id="k9b"]');
  await page.waitForFunction(() => view === 'detail' && selectedId === 'c3' && document.querySelector('#actFormCard [data-act-type="incontro"].on'));
  await page.fill('#callMeetNote', 'note dell\'incontro di oggi');
  await page.click('#saveCallBtn');
  await page.waitForFunction(() => (calls.find(k => k.id === 'k9b') || {}).incontroId);
  await show_(page, 'agenda');
  await page.click('#main [data-appt-call-id="k9b"]');
  await page.waitForFunction(() => { const m = calls.find(k => k.id === tableDetailCallId); return m && m.tipo === 'incontro' && m.daAppuntamento === 'k9b'; });
  expect((await page.textContent('#main')).includes('note dell\'incontro di oggi'), 'il dettaglio dell\'incontro non mostra le note');
  await show_(page, 'appt', "tableDetailCallId=null; apptSubView='list'");
  await page.click('#main [data-appt-call-id="k9c"]');
  await page.waitForFunction(() => tableDetailCallId === 'k9c');
  await page.evaluate(() => { tableDetailCallId = null; });
});

await test('riepilogo mail: grafico in Dashboard e filtro Tipo in Tabella attività', async () => {
  await page.evaluate(d => window.__fake.put('calls', 'mx1', { tipo: 'mail', contactId: 'c3', data: d, ora: '10:00', oggetto: 'Mail di prova per il riepilogo', note: '' }), daysAgo(0));
  await page.waitForFunction(() => calls.some(k => k.id === 'mx1'));
  const dash = await show_(page, 'dashboard', "dashboardSubView='weekly'; dashboardDrilldown=null");
  expect(dash.includes('Mail inviate per settimana') && dash.includes('Incontri svolti per settimana'), 'grafici mancanti:\n' + dash.slice(0, 800));
  // colonna dell'ultima settimana del grafico delle mail -> elenco del periodo
  await page.$$eval('.bar-clickable[data-chart-type="mail"]', els => els[els.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForFunction(() => dashboardDrilldown && dashboardDrilldown.type === 'mail');
  expect((await page.textContent('#main')).includes('Mail inviate'), 'titolo del dettaglio');
  // giorno di oggi nella settimana -> elenco delle mail
  await page.evaluate(() => { const today = new Date().toDateString(); const el = [...document.querySelectorAll('.bar-clickable[data-drill]')].find(e => { try { const d = JSON.parse(e.dataset.drill); return d.kind === 'day' && d.day === today; } catch (x) { return false; } }); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForFunction(() => dashboardDrilldown.stack.length === 2);
  expect((await page.textContent('#main')).includes('Mail di prova per il riepilogo'), 'dettaglio delle mail della settimana');
  const tab = await show_(page, 'table', "dashboardDrilldown=null; tableFilters.tipo='mail'");
  const rows = await page.$$eval('#main tbody tr', trs => trs.map(tr => !!tr.querySelector('.act-tag.mail')));
  expect(tab.includes('Mail di prova per il riepilogo') && rows.length > 0 && rows.every(Boolean), 'tabella filtrata per Mail: ' + rows.join(','));
  expect(await page.inputValue('#tableTipoFilter') === 'mail', 'filtro Tipo non selezionato');
  await page.evaluate(() => { tableFilters.tipo = ''; });
});

await test('mail trascinata: file .eml letto (oggetto codificato, quoted-printable, multipart)', async () => {
  await show_(page, 'detail', "selectedId='c3'");
  await page.click('#actFormCard [data-act-type="mail"]');
  const eml = [
    'From: Alessandro <a@example.it>', 'To: Studio Bianchi <info@studiorossi.it>',
    'Subject: =?utf-8?Q?Proposta_Isokorb_=E2=80=93_balconi_Via_Po?=', 'Date: Mon, 12 Oct 2026 18:04:00 +0200',
    'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="XYZ"', '',
    '--XYZ', 'Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: quoted-printable', '',
    'Buongiorno, le invio la proposta per i balconi. Cos=C3=AC risolviamo il ponte termico.=', '', 'Cordiali saluti',
    '--XYZ', 'Content-Type: text/html; charset="utf-8"', '', '<p>html</p>', '--XYZ--', ''].join('\r\n');
  await page.evaluate(src => {
    const dt = new DataTransfer(); dt.items.add(new File([src], 'Proposta.eml', { type: 'message/rfc822' }));
    const z = document.querySelector('[data-mail-drop="call"]');
    z.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    z.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, eml);
  await page.waitForFunction(() => /Letto dalla mail/.test(document.getElementById('callMailParsed').textContent));
  const st = await page.evaluate(() => ({ subj: callMailSubj.value, date: callDate.value, ora: callMailPaste.dataset.ora, testo: callMailPaste.value }));
  expect(st.subj === 'Proposta Isokorb – balconi Via Po', 'oggetto: ' + st.subj);
  expect(st.date === '2026-10-12' && st.ora === '18:04', 'data/ora: ' + st.date + ' ' + st.ora);
  expect(st.testo.startsWith('Buongiorno, le invio la proposta per i balconi. Così risolviamo il ponte termico.') && st.testo.includes('Cordiali saluti') && !st.testo.includes('<p>'), 'testo: ' + st.testo);
  await page.click('#saveCallBtn');
  await page.waitForFunction(() => calls.some(k => k.tipo === 'mail' && k.oggetto === 'Proposta Isokorb – balconi Via Po' && k.ora === '18:04'));
  // file .msg di Outlook: la libreria si carica e legge l'oggetto (file di prova fuori dal repository)
  if (fs.existsSync(path.join(fixtures, 'prova.msg'))) {
    await page.waitForSelector('#actFormCard [data-act-type="mail"]');
    await page.click('#actFormCard [data-act-type="mail"]');
    await page.evaluate(async () => { const b = await (await fetch('/__fixtures/prova.msg')).blob(); await takeMailFile('call', new File([b], 'prova.msg')); });
    const s = await page.evaluate(() => ({ subj: callMailSubj.value, msg: callMailParsed.textContent }));
    expect(s.subj.trim() === 'Offerta balconi Via Nizza', 'lettura del .msg: ' + JSON.stringify(s));
  }
});

await test('cantieri dal portale: "Mostra tutto" apre testo e contatti completi', async () => {
  await show_(page, 'portal', "portalTab='esamina'");
  await page.waitForSelector('.portal-card[data-pid="9000001"]');
  const vis = () => page.evaluate(() => {
    const card = document.querySelector('.portal-card[data-pid="9000001"]'), d = card.querySelector('.portal-desc');
    return { open: card.classList.contains('open'), clipped: d.scrollHeight > d.clientHeight + 2, text: card.innerText };
  });
  let s = await vis();
  expect(!s.open && s.clipped && !s.text.includes('altro@esempio.it'), 'la scheda chiusa dovrebbe essere ridotta');
  await page.click('.portal-card[data-pid="9000001"] .portal-less[data-portal-toggle]');
  s = await vis();
  expect(s.open && !s.clipped, 'descrizione ancora tagliata dopo "Mostra tutto"');
  expect(s.text.includes('FINE DESCRIZIONE') && s.text.includes('altro@esempio.it') && s.text.includes('011 2222222') && s.text.includes('www.esempio.it'), 'mancano dati nella scheda aperta');
  await page.click('.portal-card[data-pid="9000001"] .portal-more[data-portal-toggle]');
  expect(!(await vis()).open, '"Riduci" non chiude la scheda');
});

await test('Oggi: riquadri richiudibili; portale: barra in alto risalendo', async () => {
  await show_(page, 'agenda');
  const fu = () => page.evaluate(() => { const h = [...document.querySelectorAll('#main > .card h3')].find(x => x.textContent.startsWith('Follow-up da fare')); const c = h.closest('.card'); return { folded: c.classList.contains('folded'), hidden: [...c.children].slice(1).every(e => e.offsetHeight === 0) }; });
  await page.evaluate(() => [...document.querySelectorAll('#main > .card h3')].find(x => x.textContent.startsWith('Follow-up da fare')).click());
  let s = await fu();
  expect(s.folded && s.hidden, 'il riquadro Follow-up non si chiude toccando il titolo ');
  await show_(page, 'agenda');
  expect((await fu()).folded, 'il riquadro chiuso si riapre da solo dopo il ridisegno');
  await page.evaluate(() => [...document.querySelectorAll('#main > .card h3')].find(x => x.textContent.startsWith('Follow-up da fare')).click());
  expect(!(await fu()).folded, 'il riquadro non si riapre');
  await show_(page, 'portal', "portalTab='esamina'");
  const bar = () => page.evaluate(() => { const m = document.getElementById('main'), b = m.querySelector('.page-bar'); return { stuck: b.classList.contains('stuck'), off: Math.round(b.getBoundingClientRect().top - m.getBoundingClientRect().top) }; });
  await page.evaluate(() => { const d = document.createElement('div'); d.style.height = '4000px'; document.getElementById('main').appendChild(d); });
  const scroll = y => page.evaluate(y => { const m = document.getElementById('main'); m.scrollTop = y; m.dispatchEvent(new Event('scroll')); }, y);
  await scroll(2000); await page.waitForTimeout(50);
  expect(!(await bar()).stuck, 'scendendo la barra non dovrebbe comparire');
  await scroll(1700); await page.waitForTimeout(400);
  s = await bar();
  expect(s.stuck && Math.abs(s.off) <= 2, `risalendo la barra non torna in cima (${JSON.stringify(s)})`);
  await scroll(1900); await page.waitForTimeout(50);
  expect(!(await bar()).stuck, 'scendendo di nuovo la barra resta');
});

await test('chiamata registrata senza "Follow-up effettuato": il follow-up di oggi si chiude, quelli futuri restano', async () => {
  const fu = () => page.evaluate(() => (window.__fake.docs('contacts').find(c => c.id === 'c4') || {}).followUp);
  await page.evaluate(d => db.collection('contacts').doc('c4').update({ followUp: d + 'T08:00' }), daysAgo(0));
  await page.waitForFunction(() => contacts.find(c => c.id === 'c4').followUp);
  await show_(page, 'detail', "selectedId='c4'");
  expect(await page.inputValue('#callFollowUpDate') === '', 'il follow-up di oggi non dovrebbe essere riproposto');
  await page.selectOption('#callEsito', 'Appuntamento fissato').catch(() => page.selectOption('#callEsito', 'Interessato'));
  await page.fill('#callNote', 'chiusura follow-up');
  await page.click('#saveCallBtn');
  await page.waitForFunction(() => window.__fake.docs('calls').some(k => k.note === 'chiusura follow-up'));
  await page.waitForFunction(() => !(window.__fake.docs('contacts').find(c => c.id === 'c4') || {}).followUp).catch(() => {});
  expect(!(await fu()), 'il follow-up di oggi e\' rimasto: ' + await fu());
  await page.evaluate(d => db.collection('contacts').doc('c4').update({ followUp: d + 'T10:00' }), daysAgo(-3));
  await page.waitForFunction(() => contacts.find(c => c.id === 'c4').followUp);
  await show_(page, 'call', "selectedId='c4'; callStep='entry'");
  expect(await page.inputValue('#qcFollowUpDate') === daysAgo(-3), 'il follow-up futuro deve restare nel modulo');
});

await test('torna indietro: Oggi -> cliente -> chiamata registrata -> di nuovo Oggi, stesso punto', async () => {
  await page.evaluate(d => db.collection('contacts').doc('c4').update({ followUp: d + 'T08:00' }), daysAgo(0));
  await page.waitForFunction(() => contacts.find(c => c.id === 'c4').followUp);
  await page.evaluate(() => document.getElementById('navAgenda').click());
  await settle(page);
  await page.evaluate(() => { const m = document.getElementById('main'); m.scrollTop = 300; });
  const y0 = await page.evaluate(() => document.getElementById('main').scrollTop);
  const n0 = await page.evaluate(() => { navStack.length = 0; return 0; });
  await page.evaluate(() => document.querySelector('#main [data-contact-id="c4"]').click());
  await settle(page);
  expect(await page.evaluate(() => view) === 'detail', 'non si apre la scheda del cliente');
  const lbl = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-nav-back]')].find(x => x.offsetParent); return b ? b.title : ''; });
  expect(lbl === 'Torna a: Oggi', 'tasto indietro assente o sbagliato: ' + lbl);
  await page.fill('#callNote', 'giro indietro');
  await page.click('#saveCallBtn');
  await page.waitForFunction(() => window.__fake.docs('calls').some(k => k.note === 'giro indietro'));
  await settle(page);
  await page.evaluate(() => [...document.querySelectorAll('[data-nav-back]')].find(x => x.offsetParent).click());
  await settle(page);
  const st = await page.evaluate(() => ({ view, y: document.getElementById('main').scrollTop, tab: document.getElementById('navAgenda').classList.contains('active'), fu: !!document.querySelector('#main [data-contact-id="c4"][style*="cursor"]') }));
  expect(st.view === 'agenda' && st.tab, 'non torna a Oggi: ' + JSON.stringify(st));
  expect(Math.abs(st.y - y0) < 5, `scorrimento non ripristinato (${st.y} invece di ${y0})`);
  expect(!st.fu, 'il follow-up del cliente chiamato e\' ancora in Oggi');
  expect(await page.evaluate(() => navStack.length) === n0, 'la cronologia non torna come prima ');
});

await test('controllo incrociato: follow-up di oggi chiuso da una chiamata gia\' registrata, non da quella che lo ha fissato', async () => {
  const fu = id => page.evaluate(id => (window.__fake.docs('contacts').find(c => c.id === id) || {}).followUp, id);
  // c4: follow-up fissato ieri per oggi alle 18; oggi telefonata con appuntamento registrata senza "Follow-up effettuato"
  await page.evaluate(d => db.collection('contacts').doc('c4').update({ followUp: d + 'T18:00', followUpSetAt: Date.now() - 86400000 }), daysAgo(0));
  await page.evaluate(d => db.collection('calls').add({ contactId: 'c4', data: d, esito: 'Appuntamento fissato', appuntamento: d + 'T19:00', note: 'incrocio', createdAt: Date.now() }), daysAgo(0));
  await page.waitForFunction(() => !(window.__fake.docs('contacts').find(c => c.id === 'c4') || {}).followUp, null, { timeout: 3000 }).catch(() => {});
  expect(!(await fu('c4')), 'il follow-up di oggi resta nonostante la telefonata: ' + await fu('c4'));
  // c5: la chiamata di stamattina ha fissato "richiamare alle 16": resta
  const id = await page.evaluate(() => contacts.find(c => c.id !== 'c4' && !c.spento).id);
  await page.evaluate(([id, d]) => db.collection('calls').add({ contactId: id, data: d, esito: 'Da richiamare', note: 'fissa fu', createdAt: Date.now() - 2000 }), [id, daysAgo(0)]);
  await page.evaluate(([id, d]) => db.collection('contacts').doc(id).update({ followUp: d + 'T16:00', followUpSetAt: Date.now() }), [id, daysAgo(0)]);
  await page.waitForTimeout(800);
  expect(await fu(id) === daysAgo(0) + 'T16:00', 'il follow-up appena fissato non doveva chiudersi');
});

await test('report del periodo: attività, note modificabili, obiettivo, PDF salvato e condivisibile', async () => {
  const d0 = daysAgo(0);
  await page.evaluate(d => Promise.all([
    db.collection('calls').add({ contactId: 'c4', data: d, esito: 'Appuntamento fissato', appuntamento: d + 'T18:00', note: 'Nota del report: vuole il preventivo', createdAt: Date.now() }),
    db.collection('calls').add({ contactId: 'c4', data: d, esito: 'Interessato', note: 'Nota da togliere', createdAt: Date.now() }),
  ]), d0);
  await page.waitForFunction(() => calls.some(k => k.note === 'Nota da togliere'));
  await page.evaluate(() => { try { localStorage.removeItem('reportBozza'); } catch (e) {} rep = null; });
  let txt = await show_(page, 'dashboard', "dashboardDrilldown=null; dashboardSubView='report'");
  expect(/Report dal/.test(txt) && /Telefonate/.test(txt) && /Appuntamenti fissati/.test(txt) && /Sui 12 mesi/.test(txt) && /Cicli aperti/.test(txt), 'sezioni del report mancanti');
  // commesse riconoscibili: indirizzo, figure con il ruolo, fase
  const info = await page.evaluate(() => { const p = projects.find(x => (x.partecipanti || []).length && x.citta); return p ? [repProjInfo(p), p.citta] : null; });
  expect(info && info[0].includes(info[1]) && /\(.+\)/.test(info[0]), 'riga della commessa nel report: ' + JSON.stringify(info));
  expect(await page.$$eval('.rep-info', els => els.length) > 0, 'nessuna riga di dettaglio delle commesse nel report');
  const tot = await page.evaluate(() => { const d = repData(); const t = repClosingTot(d.closing); return { t, sum: d.closing.reduce((s, p) => s + (Number(p.importoOfferta) || 0), 0) }; });
  expect(tot.t.n > 0 && Math.abs(tot.t.off - tot.sum) < 0.01 && tot.t.months.reduce((s, m) => s + m.n, 0) === tot.t.n, 'totale delle commesse in chiusura: ' + JSON.stringify(tot));
  const id = await page.evaluate(() => calls.find(k => k.note === 'Nota da togliere').id);
  expect(await page.inputValue(`[data-rep-note="${id}"]`) === 'Nota da togliere', 'le note del periodo non compaiono');
  await page.click(`[data-rep-inc="${id}"]`);
  const keep = await page.evaluate(() => calls.find(k => k.note === 'Nota del report: vuole il preventivo').id);
  await page.fill(`[data-rep-note="${keep}"]`, 'Nota corretta a mano');
  await page.fill('#repCommento', 'Commento della settimana');
  // dopo un ridisegno le modifiche restano
  await page.evaluate(() => renderMain());
  expect(await page.inputValue(`[data-rep-note="${keep}"]`) === 'Nota corretta a mano' && await page.inputValue('#repCommento') === 'Commento della settimana', 'modifiche perse al ridisegno');
  const pdfHtml = await page.evaluate(() => reportPdfHtml());
  expect(pdfHtml.includes('Nota corretta a mano') && !pdfHtml.includes('Nota da togliere') && pdfHtml.includes('Commento della settimana'), 'il PDF non rispecchia le scelte');
  // PDF: libreria vera se raggiungibile, altrimenti una finta
  const real = await page.evaluate(() => Promise.race([loadHtml2Pdf().then(() => true, () => false), new Promise(r => setTimeout(() => r(false), 15000))]));
  if (!real) await page.evaluate(() => { window.html2pdf = () => ({ set() { return this; }, from() { return this; }, outputPdf: async () => new Blob(['%PDF-1.4 finto'], { type: 'application/pdf' }) }); });
  await page.click('#repSaveBtn');
  await page.waitForFunction(() => window.__fake.docs('report').length === 1, null, { timeout: 30000 });
  const r = await page.evaluate(() => window.__fake.docs('report')[0]);
  expect(/^users\/.+\/report\/r.+\.pdf$/.test(r.path) && r.size > 0 && /^Report dal/.test(r.titolo), 'report salvato male: ' + JSON.stringify(r));
  if (real) expect(r.size > 5000, 'PDF troppo piccolo: ' + r.size);
  await page.waitForSelector('[data-rep-share-new]');
  console.log('       PDF ' + (real ? 'vero' : 'finto') + ', ' + r.size + ' byte');
  if (shotsDir) {
    const b64 = await page.evaluate(async () => { const buf = new Uint8Array(await rep.saved.blob.arrayBuffer()); let s = ''; buf.forEach(x => s += String.fromCharCode(x)); return btoa(s); });
    fs.writeFileSync(path.join(shotsDir, 'report.pdf'), Buffer.from(b64, 'base64'));
    await page.evaluate(() => { for (let el = document.getElementById('main'); el; el = el.parentElement) { el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; } });
    await page.screenshot({ path: path.join(shotsDir, 'report.png'), fullPage: true });
    await page.evaluate(() => { for (let el = document.getElementById('main'); el; el = el.parentElement) el.removeAttribute('style'); });
  }
  txt = await page.evaluate(() => document.getElementById('main').innerText);
  expect(/Report salvati \(1\)/.test(txt), 'il report non compare tra i salvati');
  await page.click('[data-rep-del]');
  await page.click('[data-rep-del-yes]');
  await page.waitForFunction(() => window.__fake.docs('report').length === 0);
});

await test('fatturazione provvigioni: compenso, margine, sposta mese, emessa, Excel, importazione', async () => {
  const ym = await page.evaluate(() => todayISO().slice(0, 7)), prev = await page.evaluate(m => ymAdd(m, -1), ym);
  await page.evaluate(() => {
    const t = todayISO(), p1 = projects.find(p => p.id === 'p1'), p2 = projects.find(p => p.id === 'p2');
    return Promise.all([
      db.collection('projects').doc('p1').update({ ordini: [...(p1.ordini || []), { id: 'of1', data: t, numero: '9001', importo: 3642.06, consegnatoIl: t }, { id: 'of2', data: t, numero: '9002', importo: 13628.47, consegnatoIl: t }] }),
      db.collection('projects').doc('p2').update({ ordini: [...(p2.ordini || []), { id: 'of3', data: t, numero: '9003', importo: 2335.16, consegnatoIl: t, righe: [{ codice: '1', descrizione: 'BOLE O/U 12-330-2/450', qta: 10, um: 'PZ', prezzo: 233.516, totale: 2335.16 }] }] }),
    ]);
  });
  await page.waitForFunction(() => (projects.find(p => p.id === 'p2').ordini || []).some(o => o.id === 'of3'));
  let txt = await show_(page, 'deliveries', "delTab='fatt'; fattMese=null; fattMsg=''");
  expect(/Fattura di/.test(txt) && /4800001[\s\S]*17\.270,53[\s\S]*4\.317,63/.test(txt), 'righe della commessa (ordini sommati, 25%):\n' + txt.slice(0, 1200));
  expect(/Bole, Tronsole o altri prodotti/.test(txt), 'manca l\'avviso sul margine da verificare');
  // margine 18% sulla commessa con Bole
  await page.fill('[data-fatt-db="p2"]', '18');
  await page.press('[data-fatt-db="p2"]', 'Tab');
  await page.waitForFunction(m => ((window.__fake.docs('fatture').find(d => d.id === m) || {}).db || {}).p2 === 0.18, ym);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); renderMain(); });
  txt = await page.evaluate(() => document.getElementById('main').innerText);
  expect(/420,33/.test(txt) && /Totale fattura\s*8\.237,96/.test(txt), 'compenso con margine 18% o totale (4317,63 + 420,33 + 1000 + 2500):\n' + txt.slice(0, 1500));
  if (shotsDir) {
    await page.screenshot({ path: path.join(shotsDir, 'fatturazione-pc.png'), fullPage: true });
    const vs = page.viewportSize(); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    await page.evaluate(() => { for (let el = document.getElementById('main'); el; el = el.parentElement) { el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; } });
    await page.screenshot({ path: path.join(shotsDir, 'fatturazione-telefono.png'), fullPage: true });
    await page.evaluate(() => { for (let el = document.getElementById('main'); el; el = el.parentElement) el.removeAttribute('style'); });
    await page.setViewportSize(vs);
  }
  // sposta un ordine al mese precedente
  await page.click('[data-fatt-toggle="p1"]');
  await page.selectOption('[data-fatt-move="p1|of2"]', prev);
  await page.waitForFunction(m => projects.find(p => p.id === 'p1').ordini.find(o => o.id === 'of2').meseFattura === m, prev);
  await page.evaluate(() => renderMain());
  txt = await page.evaluate(() => document.getElementById('main').innerText);
  expect(/4800001[\s\S]*3\.642,06/.test(txt) && !/17\.270,53/.test(txt), 'ordine spostato ancora nel mese');
  await page.evaluate(() => db.collection('projects').doc('p1').update({ ordini: projects.find(p => p.id === 'p1').ordini.map(o => { if (o.id !== 'of2') return o; const { meseFattura, ...r } = o; return r; }) }));
  await page.waitForFunction(() => !projects.find(p => p.id === 'p1').ordini.find(o => o.id === 'of2').meseFattura);
  // indirizzo, "Non fatturare" su tutta la commessa, poi di nuovo dentro con "Aggiungi una commessa"
  await page.evaluate(() => renderMain());
  expect(/Via Po 10, Torino/.test(await page.evaluate(() => document.getElementById('main').innerText)), 'manca l\'indirizzo del cantiere');
  await page.selectOption('[data-fatt-rowmove="p2"]', 'no');
  await page.waitForFunction(() => projects.find(p => p.id === 'p2').ordini.find(o => o.id === 'of3').meseFattura === 'no');
  await page.evaluate(() => renderMain());
  expect(!(await page.$('[data-fatt-db="p2"]')), 'la commessa tolta è ancora nel mese');
  const lab = await page.evaluate(() => { const p = projects.find(x => x.id === 'p2'); return [p.codice, p.nome, fattAddr(p)].filter(Boolean).join(' · '); });
  await page.fill('#fattAddQ', lab); await page.press('#fattAddQ', 'Tab');
  await page.waitForSelector('[data-fatt-addorder="p2|of3"]');
  expect(/non fatturato/.test(await page.textContent('.fatt-addbox')), 'stato dell\'ordine tolto');
  await page.click('[data-fatt-addorder="p2|of3"]');
  await page.waitForFunction(() => !projects.find(p => p.id === 'p2').ordini.find(o => o.id === 'of3').meseFattura);
  // riga a mano per una commessa senza ordini del mese, poi tolta
  const lab3 = await page.evaluate(() => { const p = projects.find(x => x.id === 'p3'); return [p.codice, p.nome, fattAddr(p)].filter(Boolean).join(' · '); });
  await page.evaluate(() => { fattAddPid = null; renderMain(); });
  await page.fill('#fattAddQ', lab3); await page.press('#fattAddQ', 'Tab');
  await page.waitForSelector('#fattXImp');
  await page.fill('#fattXImp', '1.000,00'); await page.click('#fattXAdd');
  await page.waitForFunction(m => ((window.__fake.docs('fatture').find(d => d.id === m) || {}).extra || []).length === 1, ym);
  await page.evaluate(() => renderMain());
  txt = await page.evaluate(() => document.getElementById('main').innerText);
  expect(/4800003[\s\S]*1\.000,00[\s\S]*250,00/.test(txt) && /Totale fattura\s*8\.487,96/.test(txt), 'riga a mano:\n' + txt.slice(0, 1600));
  await page.click('[data-fatt-xdel]');
  await page.waitForFunction(m => !((window.__fake.docs('fatture').find(d => d.id === m) || {}).extra || []).length, ym);
  await page.evaluate(() => renderMain());
  // emessa: fotografia delle righe
  await page.evaluate(() => renderMain());
  await page.click('#fattEmitBtn');
  await page.waitForFunction(m => (window.__fake.docs('fatture').find(d => d.id === m) || {}).stato === 'emessa', ym);
  const doc = await page.evaluate(m => window.__fake.docs('fatture').find(d => d.id === m), ym);
  expect(doc.righe.length === 2 && doc.totale === 8237.96 && doc.voci.length === 2, 'fattura emessa: ' + JSON.stringify(doc).slice(0, 400));
  // Excel: un foglio per mese con le formule
  await page.evaluate(() => renderMain());
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#fattXlsBtn')]);
  const b64 = fs.readFileSync(await dl.path()).toString('base64');
  const xl = await page.evaluate(([b, m]) => { const wb = XLSX.read(b, { type: 'base64', cellFormula: true }), ws = wb.Sheets[m.replace('-', '_')]; return { names: wb.SheetNames, f1: ws.F1.v, a2: ws.A2.v, d3: ws.D3 && ws.D3.v, e2f: ws.E2.f, tot: Object.keys(ws).filter(k => ws[k] && ws[k].v === 'invoice total').map(k => ws['E' + k.slice(1)]) }; }, [b64, ym]);
  expect(xl.names.includes(ym.replace('-', '_')) && xl.f1 === 0.25 && xl.e2f === 'IF(A2="","",IF(D2>=0.25,C2*$F$1,C2*D2))' && xl.tot[0] && xl.tot[0].v === 8237.96 && /^SUM\(E2:E\d+\)$/.test(xl.tot[0].f), 'Excel: ' + JSON.stringify(xl));
  // importazione di un mese passato dal file dell'utente
  const r = await page.evaluate(async () => {
    const aoa = [['N° project', 'Project name', 'sales amount', 'DB > 25 ?', 'fee', 0.25], [4830685, 'Cabinovia - Scopello', 2335.16, 0.18, 420.3288], ['', '', '', '', ''], [], [], [], [], ['spese tecniche assistenze in cantiere', '', '', '', 'detail'], ['', '', '', '', 1000, 'car from 01-04 to 30-04'], ['', '', '', '', 2500, 'monthly fee from 01-04 to 30-04'], ['', '', '', 'invoice total', 3920.3288]];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '2025_04');
    const file = new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'INVOICE.xlsx');
    return fattImportXlsx(file);
  });
  const imp = await page.evaluate(() => window.__fake.docs('fatture').find(d => d.id === '2025-04'));
  expect(r.done.length === 1 && imp && imp.stato === 'emessa' && imp.importato && imp.righe[0].db === 0.18 && imp.righe[0].fee === 420.33 && imp.totale === 3920.33 && imp.voci.length === 2, 'importazione: ' + JSON.stringify({ r, imp }).slice(0, 500));
  // fornitura fatturata il mese prima (uscita a fine mese, consegnata in questo): l'importazione la abbina
  await page.evaluate(() => { const t = todayISO(), p3 = projects.find(p => p.id === 'p3'); return db.collection('projects').doc('p3').update({ ordini: [...(p3.ordini || []), { id: 'of4', data: t, numero: '9004', importo: 529.56, consegnatoIl: t }] }); });
  await page.waitForFunction(() => projects.find(p => p.id === 'p3').ordini.some(o => o.id === 'of4'));
  const rec = await page.evaluate(async m => {
    const aoa = [['N° project', 'Project name', 'sales amount', 'DB > 25 ?', 'fee', 0.25], [4800003, 'Villa Gamma', 529.56, 'SI', 132.39], [], [], [], [], [], ['spese tecniche assistenze in cantiere', '', '', '', 'detail'], ['', '', '', '', 1000, 'car'], ['', '', '', '', 2500, 'monthly fee'], ['', '', '', 'invoice total', 3632.39]];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), m.replace('-', '_'));
    await fattImportXlsx(new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'INVOICE.xlsx'));
    await new Promise(r => setTimeout(r, 300));
    const moved = await fattReconcile();
    return { moved, mese: projects.find(p => p.id === 'p3').ordini.find(o => o.id === 'of4').meseFattura, refs: (window.__fake.docs('fatture').find(d => d.id === m).righe[0].ordini || []).map(o => o.oid) };
  }, prev);
  expect(rec.moved === 1 && rec.mese === prev && rec.refs.join() === 'of4', 'abbinamento del mese importato: ' + JSON.stringify(rec));
  // forniture dimenticate e riepilogo dell'anno
  await page.evaluate(m => { const p1 = projects.find(p => p.id === 'p1'); return db.collection('projects').doc('p1').update({ ordini: [...p1.ordini, { id: 'of5', data: m + '-10', numero: '9005', importo: 1000, consegnatoIl: m + '-12' }, { id: 'of6', data: m + '-01', numero: '9006', importo: 500, consegna: addDaysISO(todayISO(), -20) }] }); }, prev);
  await page.waitForFunction(() => projects.find(p => p.id === 'p1').ordini.some(o => o.id === 'of6'));
  txt = await show_(page, 'deliveries', "delTab='fatt'; fattMese=null; fattYear=null");
  expect(/Forniture non fatturate \(2\)[\s\S]*9005[\s\S]*fuori dalla fattura emessa[\s\S]*9006[\s\S]*mai segnata come arrivata/.test(txt) || /Forniture non fatturate \(2\)[\s\S]*9006[\s\S]*9005/.test(txt), 'forniture non fatturate:\n' + txt.slice(txt.indexOf('Forniture non'), txt.indexOf('Forniture non') + 700));
  expect(/Riepilogo dell'anno[\s\S]*Totale \d{4}[\s\S]*Provvigioni[\s\S]*Commesse fatturate/.test(txt), 'riepilogo dell\'anno mancante');
  expect(/In arrivo nel \d{4}[\s\S]*da ordini confermati/.test(txt) && /Obiettivo \d{4}: provvigioni che coprono auto e compenso fisso \(42\.000,00\s€\)/.test(txt) && /dal forecast 12\.500,00/.test(txt), 'provvigioni in arrivo / obiettivo:\n' + txt.slice(txt.indexOf('Riepilogo'), txt.indexOf('Riepilogo') + 900));
  const inc = await page.evaluate(() => { const m = fattIncoming(); let a = 0, f = 0; m.forEach(v => { a += v.arrivo; f += v.fc; }); return { a: Math.round(a * 100) / 100, f }; });
  expect(inc.a > 0 && inc.f === 12500, 'calcolo provvigioni in arrivo: ' + JSON.stringify(inc));
  await page.click('[data-fatt-move-here="p1|of5"]');
  await page.waitForFunction(m => projects.find(p => p.id === 'p1').ordini.find(o => o.id === 'of5').meseFattura === m, ym);
  if (shotsDir) {
    await page.evaluate(() => { renderMain(); document.querySelectorAll('#main details').forEach(d => d.open = true); for (let el = document.getElementById('main'); el; el = el.parentElement) { el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; } });
    await page.screenshot({ path: path.join(shotsDir, 'fatturazione-riepilogo.png'), fullPage: true });
    await page.evaluate(() => { for (let el = document.getElementById('main'); el; el = el.parentElement) el.removeAttribute('style'); });
  }
});

await test('revisione del forecast in Oggi: commesse da aggiornare, correzioni, revisione fatta', async () => {
  await page.evaluate(() => saveSettings({ revisioneForecast: '' }));
  const items = await page.evaluate(() => forecastReviewItems().map(x => ({ id: x.p.id, why: x.why.join(' | ') })));
  await page.evaluate(() => window.__fake.put('projects', 'prev', { codice: '4800099', nome: 'Commessa ferma', importoOfferta: 5000, probabilita: 40, chiusuraPrevista: '2020-01', partecipanti: [], fasi: { richiesta: '2020-01-01' }, createdAt: 9, updatedAt: 9 }));
  await page.waitForFunction(() => projects.some(p => p.id === 'prev'));
  const it = await page.evaluate(() => forecastReviewItems().find(x => x.p.id === 'prev'));
  expect(it && /chiusura prevista superata/.test(it.why.join()) && /nessun aggiornamento da \d+ giorni/.test(it.why.join()), 'commessa ferma non segnalata: ' + JSON.stringify(it && it.why));
  const html = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return forecastReviewHtml(d); });
  expect(/Revisione del forecast/.test(html), 'riquadro del lunedì mancante');
  expect(await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6); return forecastReviewHtml(d); }) === '', 'la domenica il riquadro non deve comparire');
  const weekday = await page.evaluate(() => { const g = new Date().getDay(); return g > 0 && g < 6; });
  if (weekday) {
    await show_(page, 'agenda');
    await page.waitForSelector('#fcReview [data-rev-close="prev"]');
    await page.fill('#fcReview [data-rev-prob="prev"]', '70'); await page.press('#fcReview [data-rev-prob="prev"]', 'Tab');
    await page.waitForFunction(() => window.__fake.docs('projects').find(p => p.id === 'prev').probabilita === 70);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); renderMain(); });
    await page.click('#revDoneBtn');
    await page.waitForFunction(() => appSettings.revisioneForecast === todayISO());
    await page.evaluate(() => renderMain());
    expect(!(await page.$('#fcReview')), 'dopo "Revisione fatta" il riquadro deve sparire fino al lunedì dopo');
  }
});

await test('follow-up: dalla scheda del contatto e dalla pagina Follow-up, non dal modulo del contatto', async () => {
  const c3fu = () => page.evaluate(() => (window.__fake.docs('contacts').find(c => c.id === 'c3') || {}).followUp);
  await page.evaluate(() => db.collection('contacts').doc('c3').update({ followUp: '' }));
  await page.waitForFunction(() => !contacts.find(c => c.id === 'c3').followUp);
  // scheda del contatto
  await show_(page, 'detail', "selectedId='c3'; fuEdit=null");
  await page.click('#fuOpenBtn');
  await page.click('[data-fu-plus="7"]');
  await page.click('#fuSaveBtn');
  await page.waitForFunction(d => (window.__fake.docs('contacts').find(c => c.id === 'c3') || {}).followUp === d + 'T09:00', daysAgo(-7));
  expect(/Modifica follow-up/.test(await page.evaluate(() => document.getElementById('main').innerText)), 'il pulsante deve diventare "Modifica follow-up"');
  // il modulo "Modifica contatto" non ha piu' il follow-up e salvando lo conserva
  await show_(page, 'new', "window.__editing = { ...contacts.find(c => c.id === 'c3') }");
  expect(!(await page.$('#fFollowUpDate')), 'il modulo del contatto non deve avere il follow-up');
  // pagina Follow-up: aggiungi con scelta del contatto, poi togli
  await show_(page, 'followup', 'fuEdit=null');
  await page.click('#fuAddBtn');
  await page.fill('#fuWho', 'Verdi Paolo');
  await page.fill('#fuDate', daysAgo(-3));
  await page.selectOption('#fuTime', '15:00');
  await page.click('#fuSaveBtn');
  await page.waitForFunction(d => (window.__fake.docs('contacts').find(c => c.id === 'c4') || {}).followUp === d + 'T15:00', daysAgo(-3));
  await page.evaluate(() => renderMain());
  await page.click('[data-fu-edit="c3"]');
  await page.click('#fuClearBtn');
  await page.waitForFunction(() => !(window.__fake.docs('contacts').find(c => c.id === 'c3') || {}).followUp);
  expect(!(await c3fu()), 'follow-up non tolto');
});

await test('regali di Natale: lista da commesse e incontri, consegnato, nota, togli e aggiungi, Excel', async () => {
  const y = await page.evaluate(() => todayISO().slice(0, 4));
  let txt = await show_(page, 'regali', 'giftYear=null');
  expect(/Regali di Natale/.test(txt) && /Studio Rossi\s*2 persone/.test(txt) && /Bianchi Laura[\s\S]*collaborazione in corso/i.test(txt) && /Rossi Mario[\s\S]*preventivo aperto/i.test(txt) && /Con cesta di alimenti[\s\S]*Bianchi Laura/.test(txt) && /da comprare \d+ ceste di alimenti e \d+ bottiglie/.test(txt), 'lista proposta:\n' + txt.slice(0, 1500));
  // tipo di regalo: proposto, poi cambiato a mano
  expect(JSON.stringify(await page.evaluate(() => giftList().inList.find(x => x.c.id === 'c3').qta)) === '{"cesta":1,"vino":0}', 'fornitura = una cesta');
  await page.click('[data-gift-q="c3|vino|1"]');
  await page.waitForFunction(y => JSON.stringify(((window.__fake.docs('regali').find(d => d.id === y) || {}).qta || {}).c3) === '{"cesta":1,"vino":1}', y);
  await page.evaluate(() => renderMain());
  await page.click('[data-gift-q="c3|vino|1"]');
  await page.waitForFunction(y => (((window.__fake.docs('regali').find(d => d.id === y) || {}).qta || {}).c3 || {}).vino === 2, y);
  await page.evaluate(() => renderMain());
  await page.click('[data-gift-q="c3|cesta|-1"]');
  await page.waitForFunction(y => (((window.__fake.docs('regali').find(d => d.id === y) || {}).qta || {}).c3 || {}).cesta === 0, y);
  await page.evaluate(() => renderMain());
  expect(/Solo bottiglie[\s\S]*Bianchi Laura/.test(await page.evaluate(() => document.querySelector('.gift-vino').innerText)), 'Bianchi Laura (0 ceste, 2 bottiglie) non è tra le sole bottiglie');
  await page.check('[data-gift-done="c3"]');
  await page.waitForFunction(y => ((window.__fake.docs('regali').find(d => d.id === y) || {}).consegnati || {}).c3 === todayISO(), y);
  await page.evaluate(() => renderMain());
  await page.fill('[data-gift-note="c3"]', 'panettone'); await page.press('[data-gift-note="c3"]', 'Tab');
  await page.waitForFunction(y => ((window.__fake.docs('regali').find(d => d.id === y) || {}).note || {}).c3 === 'panettone', y);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); renderMain(); });
  await page.click('[data-gift-ex="c1"]');
  await page.waitForFunction(y => ((window.__fake.docs('regali').find(d => d.id === y) || {}).esclusi || []).includes('c1'), y);
  await page.evaluate(() => renderMain());
  txt = await page.evaluate(() => document.getElementById('main').innerText);
  expect(/Tolti dalla lista \(1\)/.test(txt), 'contatto tolto non in fondo');
  await page.evaluate(() => document.querySelector('[data-gift-back="c1"]').closest('details').open = true);
  await page.click('[data-gift-back="c1"]');
  await page.waitForFunction(y => !((window.__fake.docs('regali').find(d => d.id === y) || {}).esclusi || []).length, y);
  // aggiunto a mano e spento il criterio delle trattative
  await page.evaluate(() => renderMain());
  await page.check('[data-gift-crit="tratt"]').catch(() => {});
  await page.uncheck('[data-gift-crit="tratt"]');
  await page.waitForFunction(y => ((window.__fake.docs('regali').find(d => d.id === y) || {}).criteri || {}).tratt === false, y);
  const list = await page.evaluate(() => giftList().inList.map(x => ({ id: x.c.id, k: [...x.kinds] })));
  expect(list.some(x => x.id === 'c3') && list.every(x => !(x.k.length === 1 && x.k[0] === 'tratt')), 'criterio trattative: ' + JSON.stringify(list));
  // Excel
  await page.evaluate(() => renderMain());
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#giftXlsBtn')]);
  expect(dl.suggestedFilename() === `Regali di Natale ${y}.xlsx`, 'file: ' + dl.suggestedFilename());
  await page.evaluate(y => db.collection('regali').doc(y).delete(), y);
});

await test('rotellina o Ctrl+clic: cliente e progetto in una nuova scheda', async () => {
  // la scheda nuova parte dai dati iniziali del Firebase finto: si usano cliente e progetto di partenza
  const fake = fs.readFileSync(path.join(here, 'fake-firebase.js'), 'utf8');
  await ctx.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: r.request().url().includes('firebase-app-compat') ? fake : '' }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await show_(page, 'projects');
  const before = await page.evaluate(() => view);
  const row = page.locator(seedData().projects.map(p => `#main [data-project-id="${p.id}"], #main [data-open-project="${p.id}"]`).join(', ')).first();
  const pid = await row.evaluate(el => el.dataset.projectId || el.dataset.openProject);
  const [tabP] = await Promise.all([ctx.waitForEvent('page'), row.click({ button: 'middle' })]);
  await tabP.waitForFunction(id => typeof view !== 'undefined' && view === 'projectDetail' && selectedProjectId === id && !location.hash, pid);
  expect(await page.evaluate(() => view) === before, 'la scheda di partenza ha cambiato schermata');
  await tabP.close();
  await show_(page, 'contactsList');
  const card = page.locator(seedData().contacts.map(c => `#main [data-contact-id="${c.id}"]`).join(', ')).first();
  const cid = await card.getAttribute('data-contact-id');
  const [tabC] = await Promise.all([ctx.waitForEvent('page'), card.click({ modifiers: ['Control'], position: { x: 5, y: 5 } })]);
  await tabC.waitForFunction(id => typeof view !== 'undefined' && view === 'detail' && selectedId === id && document.getElementById('main').innerText.includes(fullName(contacts.find(c => c.id === id))), cid);
  expect(await page.evaluate(() => view) === 'contactsList', 'Ctrl+clic ha aperto il cliente anche qui');
  await tabC.close();
});

await test('cantieri segnalati: nuovo dal cliente, ricontatto in Oggi, sentito, diventato progetto', async () => {
  const seg = id => page.evaluate(id => window.__fake.docs('segnalazioni').find(d => d.id === id), id);
  // nuovo: il ricontatto si propone dall'inizio del mese del progetto pronto
  await page.evaluate(d => window.__fake.put('calls', 'mseg', { tipo: 'incontro', contactId: 'c4', data: d, ora: '10:00', note: 'Accenna una palazzina a Chieri', createdAt: 1 }), daysAgo(5));
  await page.waitForFunction(() => calls.some(k => k.id === 'mseg'));
  await show_(page, 'segnalati', 'segEdit=null; segAct=null');
  await page.click('#segNewBtn');
  await page.fill('#segWho', 'Verdi Paolo');
  // data e note dell'ultimo incontro proposte
  const lastM = await page.evaluate(() => segMeetInfo('c4'));
  expect(lastM && await page.inputValue('#segIl') === lastM.date && (await page.textContent('#segMeetBox')).includes(lastM.note.slice(0, 20)), 'ultimo incontro non proposto: ' + await page.inputValue('#segIl') + ' ' + await page.textContent('#segMeetBox'));
  await page.fill('#segTitolo', 'Palazzina 8 alloggi');
  await page.fill('#segCitta', 'Chieri');
  const pronto = await page.evaluate(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 3); return isoDay(d).slice(0, 7); });
  await page.fill('#segPronto', pronto); await page.dispatchEvent('#segPronto', 'change');
  expect(await page.inputValue('#segNext') === pronto + '-01', 'ricontatto proposto: ' + await page.inputValue('#segNext'));
  await page.fill('#segNote', 'parte in primavera');
  await page.click('#segSaveBtn');
  await page.waitForFunction(() => window.__fake.docs('segnalazioni').some(d => d.contactId === 'c4'));
  const nid = await page.evaluate(() => window.__fake.docs('segnalazioni').find(d => d.contactId === 'c4').id);
  expect((await seg(nid)).ricontattaIl === pronto + '-01' && (await seg(nid)).stato === 'aperta' && !!(await seg(nid)).incontroId, 'salvato male: ' + JSON.stringify(await seg(nid)));
  // dalla registrazione dell'incontro
  await show_(page, 'detail', "selectedId='c3'; actPrefill=null; actFormFor='c3'; actFormType='incontro'");
  await page.click('[data-seg-meet-add="call"]');
  await page.fill('#callSegRows .sm-titolo', 'Capannone con uffici');
  await page.fill('#callSegRows .sm-citta', 'Rivoli');
  await page.fill('#callMeetNote', 'incontro in studio');
  await page.click('#saveCallBtn');
  await page.waitForFunction(() => window.__fake.docs('segnalazioni').some(d => d.titolo === 'Capannone con uffici' && d.contactId === 'c3' && d.incontroId));
  const fromMeet = await page.evaluate(() => window.__fake.docs('segnalazioni').find(d => d.titolo === 'Capannone con uffici'));
  expect(fromMeet.il === daysAgo(0) && fromMeet.ricontattaIl > daysAgo(-20) && (await page.evaluate(id => (window.__fake.docs('calls').find(k => k.id === id) || {}).tipo, fromMeet.incontroId)) === 'incontro', 'segnalazione dall\'incontro: ' + JSON.stringify(fromMeet));
  await show_(page, 'detail', `tableDetailCallId='${fromMeet.incontroId}'`);
  expect(/Capannone con uffici/.test(await page.textContent('#segMeetCard')), 'manca nella scheda dell\'incontro');
  await page.evaluate(([id, mid]) => { tableDetailCallId = null; return Promise.all([db.collection('segnalazioni').doc(id).delete(), db.collection('calls').doc(mid).delete(), db.collection('calls').doc('mseg').delete()]); }, [fromMeet.id, fromMeet.incontroId]);
  // nella scheda del contatto
  await show_(page, 'detail', "selectedId='c4'");
  expect(/Palazzina 8 alloggi/.test(await page.textContent('#segCard')), 'manca nella scheda del contatto');
  // in Oggi quando arriva la data: "Sentito" sposta il ricontatto
  await page.evaluate(d => window.__fake.put('segnalazioni', 'sdue', { contactId: 'c3', il: d, titolo: 'Villetta con balconi', citta: 'Torino', stato: 'aperta', storia: [], ricontattaIl: d, createdAt: 1 }), daysAgo(1));
  await page.waitForFunction(() => segnalazioni.some(s => s.id === 'sdue'));
  let txt = await show_(page, 'agenda', 'segAct=null');
  expect(/Cantieri segnalati da risentire \(1\)[\s\S]*Villetta con balconi/.test(txt), 'non compare in Oggi:\n' + txt.slice(0, 1500));
  await page.click('[data-seg-act="sdue|sentito"]');
  await page.fill('[data-seg-form="sdue"] .seg-nota', 'progetto a febbraio');
  await page.click('[data-seg-form="sdue"] [data-seg-plus="2"]');
  await page.click('[data-seg-save-act="sdue"]');
  await page.waitForFunction(() => ((window.__fake.docs('segnalazioni').find(d => d.id === 'sdue') || {}).storia || []).length === 1);
  expect((await seg('sdue')).ricontattaIl > daysAgo(-50), 'ricontatto non spostato di due mesi: ' + (await seg('sdue')).ricontattaIl);
  await page.evaluate(() => renderMain());
  expect(!/Cantieri segnalati da risentire/.test(await page.evaluate(() => document.getElementById('main').innerText)), 'dopo "Sentito" deve uscire da Oggi');
  // diventato progetto: il modulo del progetto si apre precompilato e chiude la segnalazione
  await show_(page, 'segnalati', 'segAct=null; segFilter="aperta"');
  await page.click(`[data-seg-act="${nid}|progetto"]`);
  await page.click(`[data-seg-newproj="${nid}"]`);
  expect(await page.inputValue('#fPCitta') === 'Chieri' && await page.inputValue('#fPNome') === 'Palazzina 8 alloggi', 'modulo del progetto non precompilato');
  await page.fill('#fPCodice', '4999001');
  await page.selectOption('#fPParts .part-role', 'Impresa esecutrice');
  await page.click('#saveProjectBtn');
  await page.waitForFunction(id => (window.__fake.docs('segnalazioni').find(d => d.id === id) || {}).stato === 'progetto', nid);
  const pid = (await seg(nid)).projectId;
  expect(await page.evaluate(pid => !!window.__fake.docs('projects').find(p => p.id === pid && p.codice === '4999001'), pid), 'progetto non creato o non collegato');
  // Excel dell'elenco mostrato
  await show_(page, 'segnalati', "segAct=null; segEdit=null; segFilter='tutti'; segQ=''");
  const [sdl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#segXlsBtn')]);
  expect(/^Cantieri segnalati \d{4}-\d{2}-\d{2}\.xlsx$/.test(sdl.suggestedFilename()), 'file: ' + sdl.suggestedFilename());
  await page.evaluate(([nid, pid]) => Promise.all([db.collection('segnalazioni').doc(nid).delete(), db.collection('segnalazioni').doc('sdue').delete(), db.collection('projects').doc(pid).delete()]), [nid, pid]);
});

await test('rete di collaborazioni: commesse, portale, collegamento a mano, opportunità', async () => {
  await page.evaluate(() => window.__fake.put('portale', 'psnet', { pid: '9000077', stato: 'seguito', seguitoIl: 1, aggiornatoIl: 1, dati: {
    id: '9000077', titolo: 'Residenza Collina', comune: 'Pino Torinese', nuovaCostruzione: true, fase: 'Progettazione', unita: 12, soggetti: [
      { ruolo: 'Progettazione architettonica', nome: 'Studio Rossi', altro: [], tel: [], email: ['mario@studiorossi.it'], via: '', citta: 'Torino', web: '' },
      { ruolo: 'Progettazione strutturale', nome: 'Studio Nuovo Srl', altro: [], tel: ['011 9999999'], email: ['info@studionuovo.it'], via: '', citta: 'Chieri', web: '' },
      { ruolo: 'Committente', nome: 'Immobiliare Collina Spa', altro: [], tel: [], email: [], via: '', citta: '', web: '' } ] } }));
  await page.waitForFunction(() => portalSaved.has('9000077'));
  // scheda contatto: collaborazioni dalla commessa e collegamento a mano
  await show_(page, 'detail', "selectedId='c1'; collabAdd=null");
  let card = await page.textContent('#collabCard');
  expect(/Collaborazioni/.test(card) && card.includes('Studio Nuovo Srl') && /1 cantiere del portale/.test(card), 'collaborazioni dalla scheda del portale mancanti:\n' + card);
  await page.click('#collabAddBtn');
  await page.fill('#collabWho', 'Verdi Paolo');
  await page.fill('#collabNote', 'impresa di fiducia');
  await page.click('#collabSaveBtn');
  await page.waitForFunction(() => window.__fake.docs('collegamenti').some(l => l.a === 'c1' && l.b === 'c4' && l.nota === 'impresa di fiducia'));
  await page.waitForFunction(() => /impresa di fiducia/.test((document.getElementById('collabCard') || {}).textContent || ''));
  // pagina Rete: Studio Nuovo e' un'opportunita' tramite Studio Rossi; il committente non conta
  let txt = await show_(page, 'rete', 'reteFocus=null; reteQ=""');
  expect(/Opportunità[\s\S]*Studio Nuovo Srl[\s\S]*tramite Studio Rossi/.test(txt), 'opportunità mancante:\n' + txt.slice(0, 1200));
  expect(!txt.includes('Immobiliare Collina'), 'i committenti non devono entrare nella rete');
  await page.click('#main .card:not(#reteGraphCard) [data-net-focus="x:studio nuovo"]');
  txt = await page.evaluate(() => document.getElementById('main').innerText);
  expect(/Studio Nuovo Srl[\s\S]*nuovo[\s\S]*Chieri[\s\S]*Collegato con[\s\S]*Studio Rossi/.test(txt), 'scheda del punto nella rete:\n' + txt.slice(0, 1500));
  // nome di chi non e' in rubrica -> cantieri del portale in cui compare
  await page.click('.net-focus h3 [data-net-node="x:studio nuovo"]');
  let st = await page.evaluate(() => ({ view, portalTab, q: portalFilters.q, txt: document.getElementById('main').innerText }));
  expect(st.view === 'portal' && st.portalTab === 'seguiti' && st.q === 'Studio Nuovo Srl' && st.txt.includes('Residenza Collina'), 'dal nome al portale: ' + JSON.stringify({ ...st, txt: st.txt.slice(0, 300) }));
  // nome in rubrica -> anagrafica
  await show_(page, 'rete', "reteFocus='x:studio nuovo'");
  await page.click('.net-focus .net-row [data-net-node^="s:studio rossi"]');
  st = await page.evaluate(() => ({ view, selectedId }));
  expect(st.view === 'detail' && ['c1', 'c3'].includes(st.selectedId), 'dal nome all\'anagrafica: ' + JSON.stringify(st));
  await show_(page, 'rete', "reteFocus=null");
  // mappa: disegnata, un clic su un punto lo apre
  expect(await page.evaluate(() => netName('Amato Costruzioni S.r.l.') === netName('amato costruzioni') && netName('Edil Srl') === 'edil'), 'forma societaria nei nomi della rete');
  await page.evaluate(() => { reteFocus = null; renderMain(); });
  await page.waitForFunction(() => document.querySelector('#reteGraph canvas') && reteSim, null, { timeout: 20000 });
  await page.waitForFunction(() => reteSim.alpha() < 0.02, null, { timeout: 20000 }).catch(() => {});
  const pt = await page.evaluate(() => { const d = reteSim.nodes().find(n => n.key === 'x:studio nuovo') || reteSim.nodes()[0]; document.getElementById('reteGraph').scrollIntoView({ block: 'center' }); const r = document.querySelector('#reteGraph canvas').getBoundingClientRect(); return { key: d.key, x: r.left + d.x, y: r.top + d.y, n: reteSim.nodes().length }; });
  expect(pt.n >= 2, 'mappa vuota');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(k => reteFocus === k, pt.key, { timeout: 5000 }).catch(() => {});
  expect(await page.evaluate(() => reteFocus) === pt.key, 'clic sul punto della mappa: ' + await page.evaluate(() => reteFocus) + ' invece di ' + pt.key);
  if (shotsDir) { await page.waitForTimeout(1500); await (await page.$('#reteGraphCard')).screenshot({ path: path.join(shotsDir, 'rete-mappa.png') }); }
  // punto in rubrica sulla mappa -> anagrafica con le collaborazioni
  await page.waitForFunction(() => document.querySelector('#reteGraph canvas') && reteSim && reteSim.nodes().some(n => n.n.members.length), null, { timeout: 20000 });
  await page.waitForFunction(() => reteSim.alpha() < 0.02, null, { timeout: 20000 }).catch(() => {});
  const pm = await page.evaluate(() => { const d = reteSim.nodes().find(n => n.n.members.length); document.getElementById('reteGraph').scrollIntoView({ block: 'center' }); const r = document.querySelector('#reteGraph canvas').getBoundingClientRect(); return { x: r.left + d.x, y: r.top + d.y, ids: d.n.members.map(m => m.id) }; });
  await page.mouse.click(pm.x, pm.y);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => view) === 'rete', 'il primo tocco deve solo aprire il punto nella rete');
  await page.waitForFunction(() => document.querySelector('#reteGraph canvas') && reteSim, null, { timeout: 20000 });
  await page.waitForFunction(() => reteSim.alpha() < 0.02, null, { timeout: 20000 }).catch(() => {});
  const pm2 = await page.evaluate(() => { const d = reteSim.nodes().find(n => n.key === reteFocus); document.getElementById('reteGraph').scrollIntoView({ block: 'center' }); const r = document.querySelector('#reteGraph canvas').getBoundingClientRect(); return { x: r.left + d.x, y: r.top + d.y }; });
  await page.mouse.click(pm2.x, pm2.y);
  await page.waitForFunction(() => view === 'detail', null, { timeout: 5000 }).catch(() => {});
  const sd = await page.evaluate(() => ({ view, selectedId, card: !!document.getElementById('collabCard') }));
  expect(sd.view === 'detail' && pm.ids.includes(sd.selectedId) && sd.card, 'clic su un punto in rubrica: ' + JSON.stringify(sd));
  await show_(page, 'rete', "reteFocus=null");
  // ricerca
  await page.fill('#reteQ', 'verdi');
  await page.waitForTimeout(400);
  expect(/Verdi Paolo/.test(await page.evaluate(() => document.getElementById('main').innerText)), 'ricerca nella rete');
  // togli il collegamento a mano
  await show_(page, 'detail', "selectedId='c1'");
  await page.click('#collabCard [data-collab-del]');
  await page.click('#collabCard [data-collab-del-yes]');
  await page.waitForFunction(() => !window.__fake.docs('collegamenti').length);
});

await ctx.close();
await browser.close();
server.close();
const failed = results.filter(r => !r[0]);
console.log(failed.length ? `\n${failed.length} controlli NON superati su ${results.length}.` : `\nTutti i ${results.length} controlli superati.`);
process.exit(failed.length ? 1 : 0);
