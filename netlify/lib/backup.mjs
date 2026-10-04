// Backup degli archivi personali (users/<uid>/...) su Netlify Blobs, store "backups":
// una copia JSON al giorno per utente, chiave "<uid>/<YYYY-MM-DD>.json" (data italiana).
// Si tengono le copie degli ultimi RETAIN_DAYS giorni e, per sempre, quella del primo
// giorno di ogni mese. Usato dalla function pianificata "backup-daily" e da "backups"
// (elenco, download e copia immediata dall'app).
import admin from 'firebase-admin';
import { getStore } from '@netlify/blobs';

export const COLLECTIONS = ['contacts', 'calls', 'projects', 'settings'];
export const RETAIN_DAYS = 30;

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

// I Timestamp di Firestore diventano stringhe ISO; il resto resta com'e'.
function plain(v) {
  if (v instanceof admin.firestore.Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

export async function snapshotUser(db, uid) {
  const base = db.collection('users').doc(uid);
  const out = { version: 1, uid, createdAt: new Date().toISOString(), collections: {} };
  for (const name of COLLECTIONS) {
    const snap = await base.collection(name).get();
    out.collections[name] = snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
  }
  return out;
}
export function isEmptyBackup(data) { return COLLECTIONS.every((c) => !data.collections[c].length); }

export async function saveBackup(store, uid, data, date = romeDate()) {
  const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, data.collections[c].length]));
  await store.setJSON(`${uid}/${date}.json`, data, { metadata: counts });
  return { date, counts };
}

export async function listBackups(store, uid) {
  const { blobs } = await store.list({ prefix: `${uid}/` });
  return blobs
    .map((b) => (/\/(\d{4}-\d{2}-\d{2})\.json$/.exec(b.key) || [])[1])
    .filter(Boolean)
    .sort()
    .reverse();
}

// Copie da eliminare: piu' vecchie di RETAIN_DAYS giorni e non del primo del mese.
export function datesToPrune(dates, today = romeDate()) {
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() - RETAIN_DAYS);
  const min = limit.toISOString().slice(0, 10);
  return dates.filter((d) => d < min && !d.endsWith('-01'));
}

export async function backupUser(db, store, uid) {
  const data = await snapshotUser(db, uid);
  if (isEmptyBackup(data)) return null;
  const saved = await saveBackup(store, uid, data);
  for (const d of datesToPrune(await listBackups(store, uid))) await store.delete(`${uid}/${d}.json`);
  return saved;
}
