// Backup degli archivi personali (users/<uid>/...) su Netlify Blobs, store "backups".
// Chiavi: "<uid>/<YYYY-MM-DD>.json" per la copia notturna (data italiana) e
// "<uid>/<YYYY-MM-DD>_<HHMMSS>.json" per le copie manuali ("Fai una copia adesso" e la copia di
// sicurezza prima di un ripristino), che cosi' non sovrascrivono mai le altre.
// Si tengono le copie degli ultimi RETAIN_DAYS giorni e, per sempre, la notturna del primo
// giorno di ogni mese. Usato dalla function pianificata "backup-daily" e da "backups"
// (elenco, download e copia immediata dall'app; il ripristino lo fa l'app).
import admin from 'firebase-admin';
import { getStore } from '@netlify/blobs';

// portaleImport (rileggibile dal PDF) e suggerimenti (ricalcolabili) restano fuori.
export const COLLECTIONS = ['contacts', 'calls', 'projects', 'settings', 'portale', 'forecastStorico'];
export const RETAIN_DAYS = 30;
export const KEY_RE = /^\d{4}-\d{2}-\d{2}(_\d{6})?$/;

export function firestore() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return admin.firestore();
}
export function auth() { firestore(); return admin.auth(); }

export function backupStore() { return getStore({ name: 'backups', consistency: 'strong' }); }

// Data di oggi in Italia, "YYYY-MM-DD".
export function romeDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
// Ora italiana "HHMMSS".
export function romeTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d).replace(/\D/g, '');
}

// I Timestamp di Firestore diventano stringhe ISO; il resto resta com'e'.
function plain(v) {
  if (v instanceof admin.firestore.Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

export async function snapshotUser(db, uid) {
  const base = db.collection('users').doc(uid);
  const out = { version: 2, uid, createdAt: new Date().toISOString(), collections: {} };
  for (const name of COLLECTIONS) {
    const snap = await base.collection(name).get();
    out.collections[name] = snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
  }
  return out;
}
export function isEmptyBackup(data) { return COLLECTIONS.every((c) => !data.collections[c].length); }

export async function saveBackup(store, uid, data, key = romeDate()) {
  const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, data.collections[c].length]));
  await store.setJSON(`${uid}/${key}.json`, data, { metadata: counts });
  return { date: key, counts };
}

export async function listBackups(store, uid) {
  const { blobs } = await store.list({ prefix: `${uid}/` });
  return blobs
    .map((b) => (/\/([^/]+)\.json$/.exec(b.key) || [])[1])
    .filter((k) => k && KEY_RE.test(k))
    .sort()
    .reverse();
}

// Copie da eliminare: piu' vecchie di RETAIN_DAYS giorni, tranne la notturna del primo del mese.
export function datesToPrune(keys, today = romeDate()) {
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() - RETAIN_DAYS);
  const min = limit.toISOString().slice(0, 10);
  return keys.filter((k) => k.slice(0, 10) < min && !(k.length === 10 && k.endsWith('-01')));
}

// manual = true: chiave con l'ora, non sostituisce la copia del giorno.
export async function backupUser(db, store, uid, { manual = false } = {}) {
  const data = await snapshotUser(db, uid);
  if (isEmptyBackup(data)) return null;
  const now = new Date();
  const saved = await saveBackup(store, uid, data, manual ? `${romeDate(now)}_${romeTime(now)}` : romeDate(now));
  for (const k of datesToPrune(await listBackups(store, uid))) await store.delete(`${uid}/${k}.json`);
  return saved;
}
