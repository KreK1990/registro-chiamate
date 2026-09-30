const crypto = require('crypto');
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

// Gli appuntamenti sono salvati come ora locale italiana ("YYYY-MM-DDTHH:MM"),
// quindi il feed li dichiara esplicitamente in Europe/Rome: senza TZID Google
// Calendar tende a interpretarli come UTC e li sposta di 1-2 ore.
const TZID = 'Europe/Rome';
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Rome',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n') + '\r\n';

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
// Legge "YYYY-MM-DDTHH:MM" come ora "da muro" (indipendente dal fuso del server).
function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
}
function toICS(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
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
function tokenOk(given) {
  const expected = process.env.CALENDAR_TOKEN || '';
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async function (event) {
  // Il feed contiene dati personali dei clienti: accesso solo con il token
  // segreto (?token=...) impostato nella variabile d'ambiente CALENDAR_TOKEN.
  if (!process.env.CALENDAR_TOKEN) {
    return { statusCode: 500, body: 'CALENDAR_TOKEN non configurato su Netlify.' };
  }
  const token = event && event.queryStringParameters && event.queryStringParameters.token;
  if (!tokenOk(token)) {
    return { statusCode: 403, body: 'Accesso negato.' };
  }

  try {
    if (event && event.httpMethod === 'HEAD') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
        body: '',
      };
    }
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

    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Registro Chiamate//IT\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Appuntamenti Registro\r\nX-WR-TIMEZONE:Europe/Rome\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n';
    ics += VTIMEZONE;

    events.forEach((k) => {
      const start = parseLocal(k.appuntamento);
      if (!start) return;
      const c = contactsById[k.contactId] || {};
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const summary = icsEsc(fullName(c) + (k.progetto ? ' - ' + k.progetto : ''));
      const desc = icsEsc([k.progetto, k.note].filter(Boolean).join('\n'));
      const loc = icsEsc(fullAddress(c));

      ics += 'BEGIN:VEVENT\r\n';
      ics += foldLine(`UID:${k.id}@registro-chiamate`) + '\r\n';
      ics += foldLine(`DTSTAMP:${dtstamp}`) + '\r\n';
      ics += foldLine(`DTSTART;TZID=${TZID}:${toICS(start)}`) + '\r\n';
      ics += foldLine(`DTEND;TZID=${TZID}:${toICS(end)}`) + '\r\n';
      ics += foldLine(`SUMMARY:${summary}`) + '\r\n';
      if (desc) ics += foldLine(`DESCRIPTION:${desc}`) + '\r\n';
      if (loc) ics += foldLine(`LOCATION:${loc}`) + '\r\n';
      ics += 'END:VEVENT\r\n';
    });

    ics += 'END:VCALENDAR\r\n';

    const headers = {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="appuntamenti.ics"',
      'Content-Length': String(Buffer.byteLength(ics, 'utf8')),
      'Cache-Control': 'no-cache, max-age=0',
    };

    return {
      statusCode: 200,
      headers,
      body: ics,
    };
  } catch (err) {
    return { statusCode: 500, body: 'Errore generazione calendario: ' + err.message };
  }
};
