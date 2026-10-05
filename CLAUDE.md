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
- `netlify/functions/backup-daily.mjs` (pianificata, ogni notte alle 02:30 UTC) e
  `netlify/functions/backups.mjs` (dall'app, con l'ID token Firebase dell'utente: elenco,
  download, "Fai una copia adesso"): backup JSON di `users/<uid>/{contacts,calls,projects,settings}`
  su **Netlify Blobs** (store `backups`, chiave `<uid>/<YYYY-MM-DD>.json`). Si tengono gli
  ultimi 30 giorni e per sempre la copia del primo del mese. Logica comune in
  `netlify/lib/backup.mjs` (fuori da `functions/` per non diventare una function).
  Il service worker non mette in cache nulla sotto `/.netlify/`.
- `package.json` (dipendenze: `firebase-admin`, `@netlify/blobs`, `@anthropic-ai/sdk`) e `netlify.toml` (build minimale,
  `functions = "netlify/functions"`, redirect della radice verso l'app e blocco dei file
  che non devono essere serviti: `CLAUDE.md`, `package.json`, `netlify.toml`, `netlify/*`).

Le due HTML (`crm-chiamate.html` e `crm-chiamate-standalone.html`) devono restare
allineate in termini di funzionalità applicativa: l'unica differenza voluta tra loro è il
livello di inizializzazione del database (Claude `db` capability vs Firebase). Quando si
aggiunge una funzionalità, va replicata in entrambe (a meno che riguardi solo
l'autenticazione/hosting, che è specifica della versione standalone).

## Persistenza dati

Due collection: `contacts` e `calls` (stesso schema logico sia nella versione Claude sia
in quella Firebase).

**Versione Firebase = multi-utente** (dal 2026-10-01): ogni account ha un archivio
personale in `users/<uid>/contacts` e `users/<uid>/calls`; il documento `users/<uid>`
contiene `calendarToken` ed `email`. Tutto l'accesso ai dati passa da
`firestoreAdapter(uid)`, che applica il prefisso `users/<uid>/`: il resto del codice usa
`db.collection('contacts'|'calls')` come prima e non va modificato per questo. L'isolamento
tra utenti è garantito dalle regole Firestore (`firestore.rules`, da pubblicare a mano
nella console Firebase), non dall'app. Le collection `contacts`/`calls` alla radice sono
l'archivio della vecchia versione mono-utente: l'app propone una volta di copiarle
nell'archivio personale (stessi ID documento), senza modificarle. Account creati a mano
dall'utente nella console Firebase (niente registrazione libera); nell'app ci sono login,
"Password dimenticata?" ed "Esci". `FIREBASE_CONFIG` in testa allo script, se valorizzato,
evita ai colleghi di incollare la configurazione al primo accesso.

Campi principali:
- **contacts**: nome, cognome, professione, cellulare, azienda (studio/attività), via,
  citta, telefono (= telefono dello studio/attività; nei contatti salvati prima del campo
  cellulare può essere anche un cellulare, per questo da solo è etichettato "Tel"),
  email, followUp (datetime ISO "YYYY-MM-DDTHH:MM"), tag, note.
  Lo studio/attività è un'entità "derivata", senza collection propria: contatti con lo
  stesso `azienda` normalizzato (`normStudio`: minuscole, spazi e punteggiatura) sono
  lo stesso studio; via/citta/telefono dello studio si ricavano dai membri
  (`studioIndex`). Il modulo suggerisce gli studi esistenti, al salvataggio usa la
  grafia prevalente (`bestStudioName`) e può propagare via/città/telefono agli altri
  membri. I doppioni di contatto si riconoscono dal cellulare, non dal telefono studio.
- **calls**: contactId, data (YYYY-MM-DD), esito, progetto, note, appuntamento (datetime
  ISO), noteIncontro, createdAt, mailDaInviare (bool), mailInviataIl (YYYY-MM-DD).
  Promemoria "mail informativa" aperto = mailDaInviare && !mailInviataIl: compare in
  Oggi (una riga per cliente, `pendingMailGroups`), nel riepilogo laterale, nel badge di
  "Oggi"/menu e come notifica dalle 17:30. L'email inserita registrando una chiamata
  aggiorna `contacts.email`.
  Esiti: Interessato, Da richiamare, Appuntamento fissato, Non interessato, Nessuna
  risposta, Filtrato dalla segreteria, Altro (liste nei moduli, `ESITO_OPTS` e
  `callEditView`). Dashboard → "Clienti" (`clientStatuses`): conta clienti, non chiamate;
  "non raggiunto" = solo esiti in `ESITI_NON_RAGGIUNTO`; chiamate senza esito contano
  come raggiunto; un appuntamento implica raggiunto.
- **projects** (sezione tecnica, voce di menu "Progetti"): codice (ID progetto, 7 cifre,
  unico), nome, via, citta, partecipanti [{contactId, ruolo}] (ruoli in `PROJECT_ROLES`, compreso Termotecnico),
  importoOfferta, importoDeliberato (chiesto alla conferma d'ordine, precompilato con
  l'offerta), offertaUrl (link al PDF; i file veri vanno in "Documenti", vedi sotto), ordini [{id, data, numero, importo, consegna, note}] (consegne
  parziali; dati del DDT, consegna = data indicativa: il primo ordine segna confermaOrdine se
  vuota, mentre merceCantiere si indica solo a mano nella timeline con la data confermata dal cliente; `projectAmount` per le confermate = max(deliberato o offerta, totale ordinato)); `supplyInfo` = % merce spedita (ordinato su deliberato, o offerta se manca) mostrata nella riga dell'elenco e nella scheda ordini delle confermate: oltre il 100% diventa rossa e propone "Adegua il deliberato" (importoDeliberato = totale ordinato),
  note, fasi {chiave: 'YYYY-MM-DD'} secondo `PROJECT_PHASES`
  (propostaTecnica a cura di Michael, offertaEconomica di Claudia), createdAt, updatedAt.
  Fase attuale = ultima fase con data <= oggi (`phaseDone`); le date future sono
  "previste". L'elenco si apre filtrato su "In corso" (`projectsPhaseFilter = 'open'`). Commessa persa: esito 'persa', persaIl, motivoPerdita (`LOSS_REASONS`),
  notePerdita; "Riapri commessa" li svuota. `isLost` / `isWon` (= non persa e conferma
  d'ordine raggiunta) guidano stile (`.proj-lost` grigio e sbiadito, `.proj-won` banda e
  sfondo giallo), filtri, totali ed esclusione dalla scelta del progetto negli incontri. Nelle chiamate: `progetti` [projectId] e `consegnaOfferta` (scelti con
  la ricerca "Progetti dell'incontro" registrando o modificando un appuntamento: tutti i
  progetti non persi, a campo vuoto quelli del cliente) → `markOfferPresented` segna
  offertaPresentata con la data dell'incontro. `canAutoRender()` evita che gli
  aggiornamenti in tempo reale ridisegnino i moduli mentre si scrive.
- **Dashboard → "Progetti"** (`dashboardProjectsView`, blocco prima del Forecast): eventi delle
  commesse per data di fase nel periodo (`dashProjPeriod`, predefinito anno in corso):
  richieste, offerte presentate, conferme (valore `projectAmount`), perse; tasso di
  successo; tempi medi richiesta→offerta e offerta→conferma; ordinato (ordini per data);
  grafici mensili e motivi di perdita. Riquadri e colonne aprono elenchi
  (`projEventsListView`, drill kind projEvents / ordersMonth).
- Progetti di cui si e' parlato: indicabili per ogni chiamata (non solo appuntamenti);
  `consegnaOfferta` vale solo con appuntamento. Scheda progetto: mappa del cantiere in alto a
  destra (`.proj-head`), "Chiamate e incontri collegati".
- **Forecast** (voce di menu): solo commesse aperte (`!isLost && !isWon`). Campi sul
  progetto: `probabilita` (0-100; se assente si usa `FORECAST_DEFAULT_PROB` per fase,
  mostrata come "suggerita") e `chiusuraPrevista` ('YYYY-MM'). Ponderato = importoOfferta
  × probabilità. Riepilogo: aperte, forecast ponderato, conferme d'ordine e fatturato stimato
  dell'anno (vedi sotto); tabella "Forecast ponderato per anno" (`forecastQuartersHtml`): ponderato diviso per anno con la
  ripartizione, dentro l'anno per trimestre di chiusura prevista (o "ripartito sull'anno").
  I campi si salvano all'uscita e aggiornano le cifre senza ridisegnare la pagina.
  Nel codice il blocco "Forecast" sta subito prima del blocco "Progetti".
  Fatturato per anno: `ripartizione {'YYYY': %}` sul progetto (3 campi: anno in corso e i due
  successivi; modificando un anno il resto fino a 100 passa al successivo, `rebalanceSplit`).
  Si applica al ponderato delle aperte e al "da spedire" delle confermate (deliberato, o
  offerta, meno ordinato; sezione "Confermate ancora da spedire"). Senza ripartizione: anno di
  chiusura prevista (aperte) o anno in corso (confermate); quote di anni passati -> anno in
  corso. Fatturato reale = ordini (DDT) per data. Card "Budget di fatturato"
  (`settings.budget`): fatturato reale + confermato da spedire + forecast dell'anno.
  Tile "Conferme d'ordine" (commesse confermate nell'anno) e "Fatturato stimato".
  "⬇ Scarica PDF" (`exportForecastPdf`): report A4 orizzontale con html2pdf.js (cdnjs, caricato al
  bisogno; il PDF e' un'immagine, testo non selezionabile): riepilogo, budget e tabella per anno
  come a video, poi tabelle "Commesse aperte" e "Confermate ancora da spedire". Le tabelle sono
  righe a blocco `.rep-row` (html2pdf non sa evitare i salti dentro i <tr>); `.rep-keep` tiene
  insieme titolo, intestazione e prima riga. Il report forza l'impaginazione desktop
  (`.fc-report ...` batte le regole del telefono) perche' i salti pagina si calcolano sulla
  finestra reale.
- **Impostazioni** (voce di menu, blocco "Impostazioni" prima del Forecast): collection
  `settings` con un solo documento (creato al primo salvataggio con `add`, poi `update`):
  `budget {'YYYY': euro}`. Backup: "Scarica tutto in Excel" (`exportAllExcel`: fogli
  Contatti, Chiamate, Progetti, Ordini; sostituisce il vecchio export CSV) e, solo online, le
  copie automatiche notturne. (La mail di presentazione da modello e' stata provata e tolta
  su richiesta dell'utente: eventuali `mailOggetto`/`mailTesto` in settings sono inutilizzati.)
- **Oggi → "Da fare"** (blocco "Da fare (in Oggi)", prima del Forecast): calcolato dai dati.
  Offerte da sollecitare (offertaPresentata raggiunta, non confermata ne' persa, da
  `promemoria.sollecito` giorni contati dall'ultimo `projects.sollecitatoIl` o dall'ultima telefonata/incontro collegati al progetto in `calls.progetti` (`linkedActivityDate`); per ogni offerta l'ultima telefonata e l'ultimo incontro con i partecipanti (`projectContactActivity`), con pulsante "Riguardava questa commessa" che aggiunge il progetto a `calls.progetti`); commesse ferme
  (prima dell'offerta, nessuna fase da `promemoria.ferma` giorni); da ricontattare (clienti con
  chiamate, senza progetti in corso o acquisiti, senza follow-up o appuntamenti futuri, senza
  "Non interessato" nell'ultimo anno, fermi da `promemoria.ricontatto` giorni o
  `promemoria.nonRaggiunto` se l'ultimo esito e' in `ESITI_NON_RAGGIUNTO`; prima Interessato/Da
  richiamare). "Rimanda" scrive `rimandaAl` (YYYY-MM-DD) su progetto o contatto. Intervalli in
  Impostazioni (`settings.promemoria`, default `TODO_DEFAULTS`). Sotto, "Dati da completare"
  (commesse aperte senza importo/chiusura prevista, confermate senza deliberato ne' offerta,
  contatti dei progetti senza email/telefono).
- **Offline** (solo versione online): `enablePersistence` all'avvio; `firestoreAdapter` avvolge
  le scritture con `settleWrite` (non si aspetta il server oltre 2,5 s, `add` crea l'ID sul
  dispositivo) cosi' l'app non resta bloccata senza rete. Il service worker tiene in cache anche
  gli script Firebase/cdnjs e i font (`CDN_CACHED`). I dati restano sul dispositivo anche dopo
  "Esci" (pensato per dispositivi personali).
- **Storico del forecast**: collection `forecastStorico`, un documento per mese (`mese`,
  ponderato, offerte, aperte, `anni{YYYY:{stima, fatturato, daSpedire, forecast, conferme,
  budget}}`), aggiornato da solo (`recordForecastSnapshot`, 3 s dopo i cambi di progetti o
  impostazioni, solo se i valori cambiano). Grafico "Andamento nel tempo" nel Forecast: HTML +
  SVG a linee (`--trend-1`/`--trend-2`, colori validati per daltonismo, chiaro e scuro), linea
  del budget tratteggiata, finestrella al passaggio, tabella "Vedi i valori".
- **Ordini da PDF** (blocco "Ordini da PDF", prima del Forecast): "Ordine da PDF" nell'elenco
  Progetti (trova la commessa dal "Progetto nr." del PDF) e "Leggi da PDF" negli ordini della
  scheda. pdf.js 3.11.174 da cdnjs (build UMD, caricato al bisogno); `pdfItemsToLines` ricompone
  le righe, `parseOrderConfirmation` legge la conferma d'ordine Schöck: Ordine nr., Data,
  Progetto nr., Data di consegna, N° ordine (riferimento), cliente, luogo di consegna, Totale
  merce / Spese di trasporto / Imponibile. Il modulo si apre precompilato (`orderEdit.prefill`,
  `orderEdit.info`), importo = solo Totale merce (senza trasporto e IVA; se manca resta vuoto, mai l'Imponibile); se il n° ordine e'
  gia' registrato si modifica quello. Si salva sempre a mano. Formato provato su una conferma
  d'ordine reale del 2026-10 (PDF con testo; le scansioni non sono leggibili).
- **Invito Outlook** (blocco "Invito Outlook"): pulsante "Invia invito Outlook" sugli
  appuntamenti futuri (elenco Appuntamenti, dettaglio della chiamata) e proposta nella barra in
  alto dopo aver fissato un appuntamento (solo versione online, `offerOutlookInvite`). Apre il
  deeplink di Outlook web (`outlook.office.com/calendar/0/deeplink/compose`) con oggetto fisso
  `INVITE_SUBJECT` e il testo del promemoria che l'utente manda di solito (saluto per professione
  `inviteSalutation`, "Come da intese telefoniche... di mercoledì 09 alle ore 15 presso i vostri uffici"),
  luogo (indirizzo del cliente), invitato (`to` = email del cliente), inizio/fine (1 ora,
  `INVITE_MINUTES`) con il fuso del dispositivo (`isoWithOffset`); l'utente preme "Invia".
  Il clic passa da un ascoltatore in cattura su #main (`onInviteClick`).
- **Documenti del progetto** (blocco "Documenti del progetto", solo versione online): Firebase
  Storage (piano Blaze; script `firebase-storage-compat.js`), file in
  `users/<uid>/projects/<projectId>/<timestamp>-<nome>`, elenco in `projects.allegati`
  [{id, nome, path, tipo, size, caricatoIl, tag?}], max 20 MB. Regole in `storage.rules` (da
  pubblicare a mano in Console Firebase -> Storage -> Regole). "Ordine da PDF" propone di
  allegare il PDF (tag 'ordine'). I file non sono nei backup notturni (solo l'elenco).
- **Mappa** (voce di menu, blocco "Mappa"): Leaflet 1.9.4 (cdnjs) + tile OpenStreetMap; clienti
  raggruppati per indirizzo (cerchi blu), cantieri in corso / confermati / persi (quadrati
  ambra / viola / vuoti; colori validati per daltonismo). Coordinate da Nominatim (1 richiesta
  al secondo, solo l'indirizzo), salvate in `contacts.geo` / `projects.geo` = {lat, lng, a}
  (`a` = indirizzo cercato: se cambia si ricerca; `nf` = non trovato). "Vicino a…" (località o
  posizione del telefono) elenca cosa c'è entro 20 km. `canAutoRender` esclude la mappa.
- **Suggeriti da Claude** (in Oggi, blocco "Suggeriti da Claude", solo versione online):
  function `netlify/functions/suggest.mjs` (GET = analisi di oggi gia' salvata, gratis; POST =
  nuova analisi, max 5 al giorno) con `@anthropic-ai/sdk`, modello `claude-sonnet-5-5` (scelto
  dall'utente per il costo), effort `medium`, uscita JSON con schema, `fallbacks: "default"`
  (beta `server-side-fallback-2026-07-01`). Chiave nella variabile Netlify `ANTHROPIC_API_KEY`.
  A Claude vanno SOLO dati anonimi (professione, giorni ed esiti delle ultime chiamate, incontri,
  commesse confermate/perse; ID sostituiti da sigle c1, c2...): niente nomi, note, telefoni,
  email o indirizzi (scelta concordata con l'utente, 2026-10-05). Candidati con le stesse
  esclusioni di "Da ricontattare" e non sentiti da almeno 14 giorni. Risultato salvato in
  `users/<uid>/suggerimenti/<YYYY-MM-DD>`. Costo stimato ~2 $/mese con un'analisi al giorno.
- **Cantieri dal portale** (Progetti -> "Cantieri dal portale", blocco omonimo): legge nel
  browser con pdf.js il PDF esportato dal portale NII Progetti (niiprogetti.it; ~1000 pagine,
  ~4 s), senza inviarlo a servizi esterni (il PDF e' coperto da copyright). `parsePortalPages`
  divide le colonne per coordinata x (soggetti a sinistra, stato/categorie/dettagli a destra),
  riconosce le intestazioni dal testo (`PORTAL_ROLE`, il grassetto non e' affidabile) e unisce
  le pagine con lo stesso "ID Progetto". Volume = unita' abitative x `settings.portaleMl` (10 m)
  x `settings.portaleEuro` (80 €/m); priorita' pesata per fase (Progettazione 1,2,
  Programmazione 1, Esecuzione 0,6), ristrutturazione 0,5, clienti noti 1,5; stelle da 8.000 e
  25.000. Di default solo nuove costruzioni (l'utente non segue le ristrutturazioni). Soggetti
  confrontati con la rubrica per email, telefono (ultime 9 cifre), cognome+nome, studio. Stato
  "seguito"/"scartato" in collection `portale` {pid, stato, dati (scheda ridotta)}; ID visti in
  `settings.portaleVisti` per marcare i nuovi. "Crea contatto" / "Crea progetto" aprono i moduli
  precompilati (`__returnToPortal`, `projects.portaleId`).
- `importBatch` (contatti e chiamate): presente sui record creati da "Importa incontri
  (Excel)" (Appuntamenti), serve ad annullare quell'importazione. L'importazione legge
  .xlsx con SheetJS (caricato da cdnjs solo al bisogno), associa le colonne per titolo,
  riconosce i clienti esistenti per nome+cognome (anche invertiti, titoli come "Arch."
  diventano professione), salta incontri già presenti (stesso cliente e giorno) e crea
  ogni incontro come chiamata con esito "Appuntamento fissato" e appuntamento alla
  data/ora indicata (09:00 se manca l'ora).

## Deploy & hosting

- **GitHub**: repo `KreK1990/registro-chiamate` — root del repo = contenuto di
  `netlify-site/` (i file vanno caricati/committati alla radice del repo, non dentro una
  sottocartella "netlify-site").
- **Netlify**: collegato al repo GitHub, auto-deploy su ogni push a `main`. Variabili
  d'ambiente impostate su Netlify (Site configuration → Environment variables):
  `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (credenziali di
  un service account Firebase, usate dalla function `calendar.js`) e `CALENDAR_TOKEN`
  (token storico del feed calendario sull'archivio mono-utente; facoltativo).
- **Firebase**: Firestore (modalità produzione, regole in `firestore.rules`) +
  Authentication Email/Password (account creati dall'utente per sé e per i colleghi).
- **PWA su iPhone**: installata via Safari → "Aggiungi a Home". Service worker con
  strategia network-first per l'HTML (cache solo di fallback offline) così gli
  aggiornamenti si vedono subito al prossimo avvio, senza bisogno di reinstallare l'icona.

## Sottoscrizione calendario (.ics)

URL della function: `https://<sito>.netlify.app/.netlify/functions/calendar?token=<token>`.
Ogni utente ottiene il proprio link dal pulsante "Link calendario" nell'app: il token
(48 caratteri esadecimali) è salvato in `users/<uid>.calendarToken` e la function cerca
l'utente con quel token e legge solo il suo archivio. Il vecchio `CALENDAR_TOKEN` punta
ancora all'archivio mono-utente alla radice. Senza token valido risponde 403: il feed
contiene nomi, indirizzi e note dei clienti, e la function usa l'Admin SDK che scavalca
le regole Firestore. Gli orari sono emessi con
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
Ogni evento del feed ha un `VALARM` un'ora prima: su iPhone suona solo se nel calendario
in abbonamento "Rimuovi avvisi" è disattivato.

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
