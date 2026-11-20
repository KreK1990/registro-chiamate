// Studi sul territorio: Claude cerca sul web studi di architettura, ingegneria e termotecnica di una
// provincia (o di un comune) e li salva in users/<uid>/prospetti. Function "background" di Netlify
// (nome con -background: risponde subito 202 e lavora fino a 15 minuti). Dall'app, con il token di
// accesso Firebase (Authorization: Bearer <idToken>) e JSON { runId, provincia, comune, tipi }: la
// ricerca users/<uid>/prospezioni/<runId> e' creata dall'app (stato 'avviata'); qui passa a 'in corso',
// poi 'finita' o 'errore', con numero di studi, ricerche web e costo stimato.
// A Claude NON va la rubrica dell'utente: solo provincia, comune, tipi e i nomi degli studi gia' trovati
// dalle ricerche precedenti (dati pubblici del web), per non ripeterli. Il confronto con i contatti lo fa
// l'app. Chiave: variabile d'ambiente Netlify ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { auth, firestore, romeDate } from '../lib/backup.mjs';

const MODEL = 'claude-opus-5-5';
const MAX_RUNS_PER_DAY = 10;
const MAX_SEARCHES = 25;        // ricerche web per ricerca (0,01 $ l'una)
const MAX_TURNS = 30;
const MAX_KNOWN = 400;          // nomi gia' trovati passati a Claude per non ripeterli
// Prezzi di Claude Opus 5.5 per milione di token, in dollari, per la stima del costo (cache: lettura 0,20, scrittura 5).
const PRICE_IN = 4, PRICE_OUT = 20, PRICE_CACHE_READ = 0.2, PRICE_CACHE_WRITE = 5, PRICE_SEARCH = 0.01;
const TIPI = { architettura: 'studi di architettura', ingegneria: 'studi di ingegneria (strutture, edilizia)', termotecnica: 'studi di termotecnica e progettazione energetica degli edifici' };

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// id stabile: stesso studio nello stesso comune = stesso documento (le ricerche successive lo completano)
function prospectId(nome, comune) {
  const s = norm(nome) + '|' + norm(comune);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'p' + (h >>> 0).toString(36) + norm(nome).replace(/ /g, '-').slice(0, 30);
}

const SAVE_TOOL = {
  name: 'registra_studi',
  description: 'Registra gli studi professionali trovati. Chiamala ogni volta che hai verificato alcuni studi (anche pochi alla volta), poi continua a cercare.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      studi: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nome: { type: 'string', description: 'Nome dello studio o del professionista, come compare nella fonte' },
            titolare_nome: { type: 'string', description: 'Se lo studio è di un solo professionista (es. "Emanuela Casotti Architetto"), il suo nome di battesimo; vuoto per studi associati o società' },
            titolare_cognome: { type: 'string', description: 'Cognome di quel professionista; vuoto se titolare_nome è vuoto' },
            tipo: { type: 'string', enum: ['architettura', 'ingegneria', 'termotecnica'] },
            via: { type: 'string', description: 'Via e numero civico della sede, vuoto se non indicato' },
            comune: { type: 'string' },
            provincia: { type: 'string', description: 'Sigla della provincia, es. TO' },
            telefono: { type: 'string', description: 'Telefono della sede come scritto nella fonte, vuoto se non indicato' },
            email: { type: 'string', description: 'Vuoto se non indicata' },
            sito: { type: 'string', description: 'Sito web dello studio, vuoto se non ne ha' },
            fonte: { type: 'string', description: 'Indirizzo della pagina da cui hai preso i dati' },
          },
          required: ['nome', 'titolare_nome', 'titolare_cognome', 'tipo', 'via', 'comune', 'provincia', 'telefono', 'email', 'sito', 'fonte'],
          additionalProperties: false,
        },
      },
    },
    required: ['studi'],
    additionalProperties: false,
  },
};

const SYSTEM = `Lavori per un agente commerciale di Schöck Italia (sistemi per l'isolamento dei ponti termici dei balconi, Isokorb) che vuole conoscere i progettisti del suo territorio per proporre un incontro.
Cerca sul web studi professionali con sede nella zona indicata: siti degli studi, elenchi di categoria, pagine di attività su mappe e directory. Per ogni studio servono nome, tipo, indirizzo della sede, telefono, email e sito, presi dalle fonti: non inventare mai un dato, lascia vuoto quello che non trovi. Tieni solo chi ha la sede nella zona indicata e lavora davvero nella progettazione di edifici; salta imprese edili, agenzie immobiliari, negozi e studi chiusi.
Registra gli studi con lo strumento registra_studi man mano che li verifichi, a gruppi. Non registrare quelli nell'elenco "già trovati". Quando hai esaurito le ricerche utili rispondi solo con una riga di riepilogo.`;

async function failRun(ref, msg) { try { await ref.update({ stato: 'errore', errore: msg, finitaIl: Date.now() }); } catch (e) { /* nulla */ } }

export default async function handler(req) {
  if (req.method !== 'POST') return;
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('authorization') || '');
  let uid;
  try { uid = (await auth().verifyIdToken(m ? m[1] : '')).uid; } catch (err) { return; }
  let body = {};
  try { body = await req.json(); } catch (e) { return; }
  const provincia = String(body.provincia || '').toUpperCase().slice(0, 2), comune = String(body.comune || '').trim().slice(0, 80);
  const tipi = (Array.isArray(body.tipi) ? body.tipi : []).filter((t) => TIPI[t]);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(String(body.runId || ''))) return;

  const db = firestore(), base = db.collection('users').doc(uid);
  const runRef = base.collection('prospezioni').doc(body.runId);
  const run = await runRef.get();
  if (!run.exists || run.data().stato !== 'avviata') return;
  if (!process.env.ANTHROPIC_API_KEY) return failRun(runRef, 'La chiave di Claude non è configurata su Netlify (ANTHROPIC_API_KEY).');
  if (!/^[A-Z]{2}$/.test(provincia) || !tipi.length) return failRun(runRef, 'Provincia o tipi di studio non validi.');
  const today = romeDate();
  const todays = await base.collection('prospezioni').where('data', '==', today).get();
  if (todays.size > MAX_RUNS_PER_DAY) return failRun(runRef, `Oggi hai già fatto ${MAX_RUNS_PER_DAY} ricerche: riprova domani.`);
  await runRef.update({ stato: 'in corso', iniziataIl: Date.now() });

  // studi gia' trovati in questa provincia (dalle ricerche precedenti), per non farli ripetere a Claude
  const known = (await base.collection('prospetti').where('provincia', '==', provincia).get()).docs.map((d) => d.data());
  const knownNames = known.filter((p) => !comune || norm(p.comune) === norm(comune)).map((p) => `${p.nome} (${p.comune})`).slice(0, MAX_KNOWN);

  const zona = comune ? `il comune di ${comune} (provincia di ${provincia}) e i comuni vicini` : `la provincia di ${provincia}, capoluogo e altri comuni`;
  const messages = [{ role: 'user', content: `Zona: ${zona}.\nCerca: ${tipi.map((t) => TIPI[t]).join('; ')}.\nGià trovati (${knownNames.length}): ${knownNames.join('; ') || 'nessuno'}.` }];
  const client = new Anthropic();
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ricerche: 0 };
  let saved = 0, nuovi = 0;
  const cost = () => Math.round((usage.input * PRICE_IN + usage.cacheRead * PRICE_CACHE_READ + usage.cacheWrite * PRICE_CACHE_WRITE + usage.output * PRICE_OUT) / 1e4 + usage.ricerche * PRICE_SEARCH * 100) / 100;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },   // ogni giro rimanda tutta la conversazione: la parte gia' letta costa 1/20
        system: SYSTEM,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES, user_location: { type: 'approximate', country: 'IT', timezone: 'Europe/Rome' } }, SAVE_TOOL],
        messages,
      });
      usage.input += response.usage.input_tokens || 0;
      usage.cacheRead += response.usage.cache_read_input_tokens || 0;
      usage.cacheWrite += response.usage.cache_creation_input_tokens || 0;
      usage.output += response.usage.output_tokens || 0;
      usage.ricerche += (response.usage.server_tool_use && response.usage.server_tool_use.web_search_requests) || 0;
      if (response.stop_reason === 'refusal') break;
      messages.push({ role: 'assistant', content: response.content });
      if (response.stop_reason === 'pause_turn') continue;
      const uses = response.content.filter((b) => b.type === 'tool_use' && b.name === SAVE_TOOL.name);
      if (!uses.length || response.stop_reason === 'max_tokens') break;
      const results = [];
      for (const u of uses) {
        const list = Array.isArray(u.input && u.input.studi) ? u.input.studi : [];
        const batch = db.batch();
        let n = 0;
        for (const s of list) {
          if (!s || !s.nome || !s.comune || !TIPI[s.tipo]) continue;
          const id = prospectId(s.nome, s.comune), ref = base.collection('prospetti').doc(id);
          const old = known.find((p) => p.id === id);
          const rec = { nome: s.nome.trim(), titolareNome: (s.titolare_nome || '').trim(), titolareCognome: (s.titolare_cognome || '').trim(), tipo: s.tipo, via: (s.via || '').trim(), comune: s.comune.trim(), provincia: (s.provincia || provincia).toUpperCase().slice(0, 2),
            telefono: (s.telefono || '').trim(), email: (s.email || '').trim().toLowerCase(), sito: (s.sito || '').trim(), fonte: (s.fonte || '').trim(), runId: body.runId, aggiornatoIl: Date.now() };
          if (old) Object.keys(rec).forEach((k) => { if (!rec[k] && old[k]) delete rec[k]; });   // non si perde un dato gia' trovato
          else { rec.id = id; rec.stato = 'nuovo'; rec.trovatoIl = Date.now(); known.push(rec); nuovi++; }
          batch.set(ref, rec, { merge: true }); n++;
        }
        if (n) await batch.commit();
        saved += n;
        results.push({ type: 'tool_result', tool_use_id: u.id, content: `Registrati ${n} studi. Continua a cercare nella zona, oppure rispondi con il riepilogo se hai finito.` });
      }
      messages.push({ role: 'user', content: results });
      await runRef.update({ trovati: saved, nuovi, ricerche: usage.ricerche, costo: cost() });
    }
    await runRef.update({ stato: 'finita', trovati: saved, nuovi, ricerche: usage.ricerche, costo: cost(), token: usage, modello: MODEL, finitaIl: Date.now() });
  } catch (err) {
    console.error(`prospect ${uid}: ${err.message}`);
    const msg = err instanceof Anthropic.AuthenticationError ? 'La chiave di Claude non è valida: controllala su Netlify.'
      : err instanceof Anthropic.RateLimitError ? 'Claude è occupato: riprova tra qualche minuto.'
      : err instanceof Anthropic.BadRequestError ? 'Claude ha rifiutato la richiesta: controlla il credito su console.anthropic.com.'
      : err instanceof Anthropic.APIError ? `Errore di Claude (${err.status}).` : 'Errore della ricerca: ' + err.message;
    await runRef.update({ trovati: saved, nuovi, ricerche: usage.ricerche, costo: cost() }).catch(() => {});
    await failRun(runRef, msg);
  }
}
