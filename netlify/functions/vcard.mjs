// Contatto per la rubrica dell'iPhone. Su iPhone un .vcf scaricato come file si apre dai Download e
// la scheda "Nuovo contatto" si chiude senza salvare (verificato dall'utente su iOS 27, 2026-10-15).
// L'app invia qui il vCard gia' composto con un modulo POST (i dati non finiscono nell'indirizzo) e
// la function lo restituisce come pagina text/vcard: Safari mostra la scheda con "Aggiungi ai contatti".
// Non salva nulla e accetta solo un vCard (BEGIN:VCARD ... END:VCARD) di dimensioni ridotte.
const MAX = 8000;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Metodo non consentito.', { status: 405 });
  let v = '', name = 'contatto';
  try {
    const form = await req.formData();
    v = String(form.get('v') || '');
    name = String(form.get('n') || 'contatto');
  } catch (err) {
    return new Response('Richiesta non valida.', { status: 400 });
  }
  v = v.replace(/\r?\n/g, '\r\n');
  if (v.length > MAX || !/^BEGIN:VCARD\r\n[\s\S]*\r\nEND:VCARD\r\n?$/.test(v) || (v.match(/BEGIN:VCARD/g) || []).length !== 1) {
    return new Response('Contatto non valido.', { status: 400 });
  }
  const file = name.replace(/[^\w\- àèéìòùÀÈÉÌÒÙ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'contatto';
  return new Response(v.endsWith('\r\n') ? v : v + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `inline; filename="${file.replace(/[^\x20-\x7e]/g, '_')}.vcf"; filename*=UTF-8''${encodeURIComponent(file)}.vcf`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
