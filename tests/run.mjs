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
const iso = d => d.toISOString().slice(0, 10);
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
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', locale: 'it-IT', timezoneId: 'Europe/Rome' });
  await ctx.addInitScript(seed => { window.__seed = seed; window.alert = m => { (window.__alerts = window.__alerts || []).push(String(m)); }; }, seedData());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const fake = fs.readFileSync(path.join(here, 'fake-firebase.js'), 'utf8');
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: r.request().url().includes('firebase-app-compat') ? fake : '' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route(/tile\.openstreetmap\.org/, r => r.fulfill({ status: 204, body: '' }));
  await page.route(/nominatim\.openstreetmap\.org/, r => r.fulfill({ contentType: 'application/json', body: '[{"lat":"44.70","lon":"8.03"}]' }));
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
  const views = ['agenda', 'contactsList', 'call', 'followup', 'appt', 'projects', 'map', 'forecast', 'table', 'dashboard', 'settings', 'portal', 'dups', 'new', 'import', 'projectForm'];
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
  st = await page.evaluate(() => ({ n: window.__fake.docs('projects').find(p => p.id === 'p1').foto.length, files: window.__fake.files.size }));
  expect(st.n === 0 && st.files === 0, 'foto non eliminata: ' + JSON.stringify(st));
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
  expect(st.n === 894, `cantieri importati: ${st.n} (attesi 894)`);
  expect(st.via >= 700, `cantieri con indirizzo: ${st.via} (attesi ~740)`);
});

// telefono: niente deve uscire dalla larghezza dello schermo
await ctx.close();
({ ctx, page } = await openApp({ width: 390, height: 844 }));
await test('telefono: nessuna pagina piu\' larga dello schermo', async () => {
  const bad = [];
  const pages = [['agenda'], ['contactsList'], ['call'], ['detail', "selectedId='c1'"], ['projects'], ['projectDetail', "selectedProjectId='p1'"], ['forecast'], ['dashboard'], ['settings'], ['portal'], ['table'], ['appt'], ['followup'], ['map'], ['deliveries'], ['sop', "sopEdit={ id:'new', prefill:{}, back:{ view:'appt', tab:'navAppt' } }"]];
  for (const [v, extra] of pages) {
    await show_(page, v, extra || '');
    await settle(page);
    const w = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth, out = [];
      document.querySelectorAll('#main *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > vw + 1 && !el.closest('.table-wrap, .map-embed, [style*="overflow"]')) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} (destra ${Math.round(r.right)} > ${vw})`);
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
  expect(s.projectId === 'p1' && s.quando === daysAgo(-1) + 'T10:00' && s.durata === 60, 'sopralluogo salvato male: ' + JSON.stringify(s));
  expect((await page.textContent('#main')).includes('verificare i balconi'), 'non compare nella scheda progetto');
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
  await page.click('#main [data-sop-id="sx"]');
  await page.waitForSelector('#sopNoteDopo');
  await page.fill('#sopNoteDopo', 'getto previsto a novembre');
  await page.click('#sopSaveBtn');
  await page.waitForFunction(() => (window.__fake.docs('sopralluoghi').find(s => s.id === 'sx') || {}).noteDopo === 'getto previsto a novembre');
  await page.waitForFunction(() => view === 'appt');
  await page.click('#main [data-sop-id="sx"]');
  await page.click('#sopDelBtn');
  await page.click('#sopDelYes');
  await page.waitForFunction(() => !window.__fake.docs('sopralluoghi').some(s => s.id === 'sx'));
  await page.evaluate(() => { mapFilters.portaleSeguiti = true; });
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

await ctx.close();
await browser.close();
server.close();
const failed = results.filter(r => !r[0]);
console.log(failed.length ? `\n${failed.length} controlli NON superati su ${results.length}.` : `\nTutti i ${results.length} controlli superati.`);
process.exit(failed.length ? 1 : 0);
