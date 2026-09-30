# Registro Chiamate

App CRM per un agente di commercio: anagrafica contatti, registrazione chiamate, follow-up,
appuntamenti con integrazione calendario, dashboard attività. Sviluppata inizialmente in chat
con Claude (claude.ai), poi esportata qui per continuare lo sviluppo con Claude Code.

## Struttura del progetto

Tutti i file stanno in `netlify-site/`, che corrisponde alla radice del repo GitHub ed è
la cartella pubblicata su Netlify (deploy automatico a ogni push).

- **`crm-chiamate.html`** — versione ospitata come Claude Artifact (claude.ai). Usa
  `window.claude.use("db")`, un'API disponibile SOLO dentro l'ambiente Artifact di Claude.
  Non è eseguibile/deployabile altrove così com'è: è tenuta come riferimento/cronologia
  (su Netlify l'URL viene rediretto alla radice, vedi `netlify.toml`).
  Link pubblico: https://claude.ai/artifact/Kiz9xzgpJCmLcgXFKRvhef (se ancora valido).

- **`crm-chiamate-standalone.html`** — versione "vera", pensata per essere ospitata fuori da
  Claude. Usa Firebase (Auth + Firestore) al posto di `window.claude.use("db")`. È il file
  che va effettivamente in produzione. **Questa è la versione da mantenere aggiornata.**

- `manifest.json`, `service-worker.js`, le icone — il "app shell" PWA installabile su
  iPhone (Aggiungi a Home Screen).
- `netlify/functions/calendar.js` — funzione serverless che legge Firestore (via
  Firebase Admin SDK) e genera al volo un feed **.ics** per l'abbonamento calendario
  (così gli appuntamenti si sincronizzano da soli sul Calendario di iPhone/Google
  Calendar, senza export/import manuali).
- `package.json` (dipendenza: `firebase-admin`) e `netlify.toml` (build minimale,
  `functions = "netlify/functions"`, redirect della radice verso l'app e blocco dei file
  che non devono essere serviti: `CLAUDE.md`, `package.json`, `netlify.toml`, `netlify/*`).

Le due HTML (`crm-chiamate.html` e `crm-chiamate-standalone.html`) devono restare
allineate in termini di funzionalità applicativa: l'unica differenza voluta tra loro è il
livello di inizializzazione del database (Claude `db` capability vs Firebase). Quando si
aggiunge una funzionalità, va replicata in entrambe (a meno che riguardi solo
l'autenticazione/hosting, che è specifica della versione standalone).

## Persistenza dati

Due collection Firestore: `contacts` e `calls` (stesso schema logico sia nella versione
Claude sia in quella Firebase). Campi principali:
- **contacts**: nome, cognome, professione, azienda, via, citta, telefono, email,
  followUp (datetime ISO "YYYY-MM-DDTHH:MM"), tag, note.
- **calls**: contactId, data (YYYY-MM-DD), esito, progetto, note, appuntamento (datetime
  ISO), noteIncontro, createdAt.

## Deploy & hosting

- **GitHub**: repo `KreK1990/registro-chiamate` — root del repo = contenuto di
  `netlify-site/` (i file vanno caricati/committati alla radice del repo, non dentro una
  sottocartella "netlify-site").
- **Netlify**: collegato al repo GitHub, auto-deploy su ogni push a `main`. Variabili
  d'ambiente impostate su Netlify (Site configuration → Environment variables):
  `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (credenziali di
  un service account Firebase, usate dalla function `calendar.js`) e `CALENDAR_TOKEN`
  (segreto richiesto come `?token=` per leggere il feed calendario).
- **Firebase**: Firestore (modalità produzione, regole che richiedono
  `request.auth != null`) + Authentication Email/Password (un solo utente).
- **PWA su iPhone**: installata via Safari → "Aggiungi a Home". Service worker con
  strategia network-first per l'HTML (cache solo di fallback offline) così gli
  aggiornamenti si vedono subito al prossimo avvio, senza bisogno di reinstallare l'icona.

## Sottoscrizione calendario (.ics)

URL della function: `https://<sito>.netlify.app/.netlify/functions/calendar?token=<CALENDAR_TOKEN>`
(senza token valido risponde 403: il feed contiene nomi, indirizzi e note dei clienti, e
la function usa l'Admin SDK che scavalca le regole Firestore). Gli orari sono emessi con
`TZID=Europe/Rome` + `VTIMEZONE`, sia nel feed sia nell'export manuale. È pensato
per essere aggiunto come "calendario in abbonamento" (webcal) su iPhone/Google
Calendar/iCloud, così il Calendario si aggiorna da solo periodicamente. La sottoscrizione
nativa su iPhone funziona (verificata il 2026-10-01). I problemi iniziali erano dovuti al
"Visitor access" di Netlify impostato su Private per la produzione (ogni richiesta
riceveva il login Netlify): ora è Private solo per le Deploy Previews, e la produzione è
pubblica — la protezione dei dati è affidata al login Firebase e al token del feed.
"Accesso negato" dal feed = token nell'URL diverso da `CALENDAR_TOKEN`; dopo aver
cambiato la variabile su Netlify serve un nuovo deploy perché la function la legga.
Il file `.ics` esportabile manualmente (sezione Appuntamenti) resta un fallback.

## Note di stile/architettura da preservare

- Identità grafica Schöck Italia (l'utente lavora per Schöck; riferimento
  https://www.schoeck.com/it): blu istituzionale `--accent:#00487E`, fondo grigio chiaro
  `#EEEEEE`, riquadri bianchi con bordi azzurro-grigi (`--border`, `--border-strong`), accento
  giallo `--brand-yellow:#DC9D00` usato solo per indicatori (voce di menu attiva, quadratino
  accanto a "Registro"), mai per testo. Angoli squadrati (2px), titoli in "Fira Sans
  Condensed" grassetto non corsivo (`--serif`, il nome della variabile è storico), testo in
  "Fira Sans": sostituti liberi del font aziendale Corpid, che è a licenza e non va usato.
  Tema scuro con le stesse variabili. Niente emoji nell'interfaccia; non riprodurre il logo
  aziendale. Le regole di stile Schöck sono raccolte in un blocco commentato subito prima
  del `@media (max-width:720px)`. Icone PWA: "R" bianca su blu con quadratino giallo.
- Niente `confirm()`/`alert()` nativi per conferme critiche (bloccati nell'ambiente
  Claude Artifact): le conferme di eliminazione sono implementate come UI inline nella
  pagina stessa (pattern già presente per contatti e chiamate — riusarlo per nuove
  funzionalità di eliminazione).
- Ogni vista/tab (Oggi, Contatti, Chiamata, Follow-up, Appuntamenti, Tabella chiamate,
  Dashboard) è una funzione JS che ritorna una stringa HTML, iniettata in `#main` da
  `renderMain()`. Il click-binding avviene subito dopo l'iniezione, dentro lo stesso
  `if(view===...)` block.
