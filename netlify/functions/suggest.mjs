// Suggerimenti di Claude su chi ricontattare. Dall'app, con il token di accesso Firebase
// dell'utente (Authorization: Bearer <idToken>):
//   GET  -> i suggerimenti di oggi gia' calcolati (nessun costo), o { items: null }
//   POST -> nuova analisi con Claude (costa qualche centesimo), salvata per oggi
// A Claude vanno SOLO dati anonimi: professione, date ed esiti delle chiamate, numero di
// incontri e progetti. Niente nomi, note, telefoni, email o indirizzi; gli ID dei contatti
// sono sostituiti da sigle (c1, c2...) e rimappati qui.
// Chiave: variabile d'ambiente Netlify ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { auth, firestore, romeDate } from '../lib/backup.mjs';

const MODEL = 'claude-sonnet-5-5';
const MAX_RUNS_PER_DAY = 5;
const MIN_DAYS = 14;          // sentiti negli ultimi 14 giorni: non si propongono
const MAX_CANDIDATES = 300;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const days = (from, to) => Math.round((new Date(to) - new Date(from)) / 864e5);
const phaseDone = (p, k, today) => !!(p.fasi && p.fasi[k] && p.fasi[k] <= today);
const isLost = (p) => p.esito === 'persa';
const isWon = (p, today) => !isLost(p) && phaseDone(p, 'confermaOrdine', today);

// Candidati e dati anonimi per Claude (stesse esclusioni della lista "Da ricontattare").
function buildCandidates(contacts, calls, projects, today) {
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * 864e5).toISOString().slice(0, 10);
  const byContact = new Map();
  calls.forEach((k) => { if (k.contactId) (byContact.get(k.contactId) || byContact.set(k.contactId, []).get(k.contactId)).push(k); });
  const out = [];
  contacts.forEach((c) => {
    const list = byContact.get(c.id);
    if (!list || !list.length) return;
    if (c.rimandaAl && c.rimandaAl > today) return;
    if (c.followUp && new Date(c.followUp) > now) return;
    if (list.some((k) => k.appuntamento && new Date(k.appuntamento) > now)) return;
    const projs = projects.filter((p) => (p.partecipanti || []).some((x) => x.contactId === c.id));
    if (projs.some((p) => !isLost(p) && !isWon(p, today))) return;   // progetto in corso: lo segue il progetto
    const sorted = list.slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    if (sorted.some((k) => k.esito === 'Non interessato' && (k.data || '') >= yearAgo)) return;
    const meetings = list.filter((k) => k.appuntamento && new Date(k.appuntamento) <= now).map((k) => k.appuntamento.slice(0, 10));
    const last = [sorted[0].data || '', ...meetings].sort().pop();
    if (!last || days(last, today) < MIN_DAYS) return;
    out.push({
      id: c.id,
      data: {
        professione: c.professione || 'non indicata',
        giorni_dall_ultimo_contatto: days(last, today),
        chiamate: sorted.slice(0, 6).map((k) => ({ giorni_fa: days(k.data, today), esito: k.esito || 'non indicato', incontro_fissato: !!k.appuntamento })),
        incontri_svolti: meetings.length,
        commesse_confermate: projs.filter((p) => isWon(p, today)).length,
        commesse_perse: projs.filter(isLost).length,
      },
    });
  });
  return out.sort((a, b) => a.data.giorni_dall_ultimo_contatto - b.data.giorni_dall_ultimo_contatto).slice(0, MAX_CANDIDATES);
}

const SCHEMA = {
  type: 'object',
  properties: {
    suggerimenti: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sigla: { type: 'string' },
          priorita: { type: 'string', enum: ['alta', 'media'] },
          azione: { type: 'string', enum: ['richiamare', 'proporre un incontro', 'riproporsi dopo una commessa persa', 'cercare nuove commesse'] },
          motivo: { type: 'string' },
        },
        required: ['sigla', 'priorita', 'azione', 'motivo'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggerimenti'],
  additionalProperties: false,
};

const SYSTEM = `Aiuti un agente commerciale di Schöck Italia (sistemi per l'isolamento dei ponti termici, Isokorb) che telefona e incontra progettisti (architetti, ingegneri, geometri), imprese e committenti per farsi prescrivere i prodotti nei progetti.
Ricevi un elenco di clienti già contattati, senza progetti in corso, con dati anonimi: professione, giorni dall'ultimo contatto, ultime chiamate (quanti giorni fa, esito, se è stato fissato un incontro), incontri svolti, commesse confermate e perse.
Scegli i 10 clienti più promettenti da ricontattare questa settimana. Privilegia chi aveva mostrato interesse ("Interessato", "Da richiamare") e non è stato più sentito, chi è stato incontrato ma non ha ancora un progetto, i clienti che hanno già confermato commesse (possono averne di nuove) e chi ha perso una commessa da abbastanza tempo da riproporsi. Dai meno peso a chi non risponde mai.
Per ciascuno indica la sigla, la priorità, l'azione e un motivo breve in italiano (massimo 20 parole) basato solo sui dati ricevuti, per esempio "Interessato 75 giorni fa, mai incontrato: proporre un incontro".`;

export default async function handler(req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('authorization') || '');
  let uid;
  try { uid = (await auth().verifyIdToken(m ? m[1] : '')).uid; }
  catch (err) { return json(401, { error: 'Accesso negato.' }); }

  const db = firestore();
  const today = romeDate();
  const ref = db.collection('users').doc(uid).collection('suggerimenti').doc(today);
  try {
    const saved = await ref.get();
    if (req.method === 'GET') return json(200, saved.exists ? saved.data() : { items: null });
    if (req.method !== 'POST') return json(405, { error: 'Metodo non consentito.' });
    if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'La chiave di Claude non è ancora configurata su Netlify (ANTHROPIC_API_KEY).' });
    const runs = saved.exists ? saved.data().analisi || 0 : 0;
    if (runs >= MAX_RUNS_PER_DAY) return json(429, { error: `Oggi hai già chiesto ${runs} analisi: riprova domani.` });

    const base = db.collection('users').doc(uid);
    const [cs, ks, ps] = await Promise.all(['contacts', 'calls', 'projects'].map((n) => base.collection(n).get()));
    const docs = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const candidates = buildCandidates(docs(cs), docs(ks), docs(ps), today);
    if (!candidates.length) {
      const empty = { items: [], data: today, analisi: runs + 1, candidati: 0, creatoIl: Date.now() };
      await ref.set(empty);
      return json(200, empty);
    }
    const alias = new Map(candidates.map((c, i) => [`c${i + 1}`, c.id]));
    const payload = candidates.map((c, i) => ({ sigla: `c${i + 1}`, ...c.data }));

    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Oggi è il ${today}. Clienti (${payload.length}):\n${JSON.stringify(payload)}` }],
    });
    if (response.stop_reason === 'refusal') return json(502, { error: 'Claude non ha completato l\'analisi: riprova più tardi.' });
    if (response.stop_reason === 'max_tokens') return json(502, { error: 'Risposta di Claude incompleta: riprova.' });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text);
    const seen = new Set();
    const items = (parsed.suggerimenti || []).filter((s) => alias.has(s.sigla) && !seen.has(s.sigla) && seen.add(s.sigla))
      .map((s) => ({ contactId: alias.get(s.sigla), priorita: s.priorita, azione: s.azione, motivo: s.motivo }));
    const result = { items, data: today, analisi: runs + 1, candidati: payload.length, modello: response.model, creatoIl: Date.now(),
      token: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
    await ref.set(result);
    return json(200, result);
  } catch (err) {
    console.error(`suggest ${uid}: ${err.message}`);
    if (err instanceof Anthropic.AuthenticationError) return json(502, { error: 'La chiave di Claude non è valida: controllala su Netlify.' });
    if (err instanceof Anthropic.RateLimitError) return json(502, { error: 'Claude è occupato: riprova tra qualche minuto.' });
    if (err instanceof Anthropic.BadRequestError) return json(502, { error: 'Claude ha rifiutato la richiesta: controlla il credito su console.anthropic.com.' });
    if (err instanceof Anthropic.APIError) return json(502, { error: `Errore di Claude (${err.status}).` });
    return json(500, { error: 'Errore dei suggerimenti: ' + err.message });
  }
}
