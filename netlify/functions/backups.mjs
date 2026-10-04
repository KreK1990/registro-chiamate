// Backup del proprio archivio, dall'app (Impostazioni). Richiede il token di accesso
// Firebase dell'utente (header Authorization: Bearer <idToken>): ognuno vede e scarica
// solo le copie del proprio archivio.
//   GET                  -> { backups: ['YYYY-MM-DD', ...] } (dal piu' recente)
//   GET ?date=YYYY-MM-DD -> il file JSON di quel giorno
//   POST                 -> esegue subito la copia di oggi -> { date, counts }
import { auth, firestore, backupStore, backupUser, listBackups } from '../lib/backup.mjs';

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
      const saved = await backupUser(firestore(), store, uid);
      return saved ? json(200, saved) : json(200, { date: null, counts: null });
    }
    if (req.method !== 'GET') return json(405, { error: 'Metodo non consentito.' });
    const date = new URL(req.url).searchParams.get('date');
    if (!date) return json(200, { backups: await listBackups(store, uid) });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { error: 'Data non valida.' });
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
