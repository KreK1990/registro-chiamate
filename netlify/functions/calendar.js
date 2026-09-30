const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

function fullName(c) {
  if (c.cognome) return `${c.cognome} ${c.nome || ''}`.trim();
  if (c.nome) return c.nome;
  return c.azienda || c.telefono || c.email || '(senza nome)';
}
function fullAddress(c) {
  if (c.via || c.citta) return [c.via, c.citta].filter(Boolean).join(', ');
  return c.indirizzo || '';
}
function pad(n) { return String(n).padStart(2, '0'); }
function toICS(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
function icsEsc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function foldLine(line) {
  const max = 73;
  if (line.length <= max) return line;
  let out = line.slice(0, max);
  let rest = line.slice(max);
  while (rest.length > 0) {
    out += '\r\n ' + rest.slice(0, max - 1);
    rest = rest.slice(max - 1);
  }
  return out;
}

exports.handler = async function () {
  try {
    const [contactsSnap, callsSnap] = await Promise.all([
      db.collection('contacts').get(),
      db.collection('calls').get(),
    ]);

    const contactsById = {};
    contactsSnap.forEach((doc) => { contactsById[doc.id] = doc.data(); });

    const events = [];
    callsSnap.forEach((doc) => {
      const k = doc.data();
      if (k.appuntamento) events.push({ id: doc.id, ...k });
    });

    const now = new Date();
    const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Registro Chiamate//IT\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Appuntamenti Registro\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n';

    events.forEach((k) => {
      const c = contactsById[k.contactId] || {};
      const start = new Date(k.appuntamento);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const summary = icsEsc(fullName(c) + (k.progetto ? ' - ' + k.progetto : ''));
      const desc = icsEsc([k.progetto, k.note].filter(Boolean).join('\n'));
      const loc = icsEsc(fullAddress(c));

      ics += 'BEGIN:VEVENT\r\n';
      ics += foldLine(`UID:${k.id}@registro-chiamate`) + '\r\n';
      ics += foldLine(`DTSTAMP:${dtstamp}`) + '\r\n';
      ics += foldLine(`DTSTART:${toICS(start)}`) + '\r\n';
      ics += foldLine(`DTEND:${toICS(end)}`) + '\r\n';
      ics += foldLine(`SUMMARY:${summary}`) + '\r\n';
      if (desc) ics += foldLine(`DESCRIPTION:${desc}`) + '\r\n';
      if (loc) ics += foldLine(`LOCATION:${loc}`) + '\r\n';
      ics += 'END:VEVENT\r\n';
    });

    ics += 'END:VCALENDAR\r\n';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-cache, max-age=0',
      },
      body: ics,
    };
  } catch (err) {
    return { statusCode: 500, body: 'Errore generazione calendario: ' + err.message };
  }
};
