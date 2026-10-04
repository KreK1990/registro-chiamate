// Backup automatico notturno di tutti gli archivi personali (vedi netlify/lib/backup.mjs).
// Netlify la esegue da sola ogni giorno alle 02:30 UTC (03:30/04:30 in Italia).
import { firestore, backupStore, backupUser } from '../lib/backup.mjs';

export default async function handler() {
  const db = firestore();
  const store = backupStore();
  const users = await db.collection('users').listDocuments();
  let done = 0;
  for (const ref of users) {
    try {
      if (await backupUser(db, store, ref.id)) done++;
    } catch (err) {
      console.error(`backup ${ref.id}: ${err.message}`);
    }
  }
  console.log(`backup completati: ${done} su ${users.length} archivi`);
}

export const config = { schedule: '30 2 * * *' };
