// Backup del proprio archivio, dall'app (Impostazioni). Richiede il token di accesso
// Firebase dell'utente (header Authorization: Bearer <idToken>): ognuno vede e scarica
// solo le copie del proprio archivio.
//   GET                  -> { backups: ['YYYY-MM-DD' | 'YYYY-MM-DD_HHMMSS', ...] } (dal piu' recente)
//   GET ?date=<chiave>   -> il file JSON di quella copia
//   POST                 -> copia manuale adesso (chiave con l'ora, non sovrascrive) -> { date, counts }
import { auth, firestore, backupStore, backupUser, listBackups, KEY_RE } from '../lib/backup.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export default async function handler(req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('authorization') || '');
  let uid;
  try {
    uid = (await auth().verifyIdToken(m ? m[1] : '')).uid;
  } catch (err) {
    return json(401, { error: 'Accesso negato.' });
  }
  const store = backupStore();
  try {
    if (req.method === 'POST') {
      const saved = await backupUser(firestore(), store, uid, { manual: true });
      return saved ? json(200, saved) : json(200, { date: null, counts: null });
    }
    if (req.method !== 'GET') return json(405, { error: 'Metodo non consentito.' });
    const date = new URL(req.url).searchParams.get('date');
    if (!date) return json(200, { backups: await listBackups(store, uid) });
    if (!KEY_RE.test(date)) return json(400, { error: 'Copia non valida.' });
    const body = await store.get(`${uid}/${date}.json`);
    if (body == null) return json(404, { error: 'Copia non trovata.' });
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="registro-chiamate-backup-${date}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error(`backups ${uid}: ${err.message}`);
    return json(500, { error: 'Errore del backup: ' + err.message });
  }
}
