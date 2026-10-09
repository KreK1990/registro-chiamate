# Registro Chiamate

App CRM per un agente di commercio: anagrafica contatti, registrazione chiamate, follow-up,
appuntamenti con integrazione calendario, dashboard attività. Sviluppata inizialmente in chat
con Claude (claude.ai), poi esportata qui per continuare lo sviluppo con Claude Code.

## Struttura del progetto

Tutti i file stanno in `netlify-site/`, che corrisponde alla radice del repo GitHub ed è
la cartella pubblicata su Netlify (deploy automatico a ogni push).

- **`crm-chiamate-standalone.html`** — l'app (unico file, Firebase Auth + Firestore). La vecchia
  copia `crm-chiamate.html` per Claude Artifact e' stata eliminata il 2026-10-06 (resta nella
  cronologia git); `/crm-chiamate.html` su Netlify rimanda alla radice.

- `manifest.json`, `service-worker.js`, le icone — il "app shell" PWA installabile su
  iPhone (Aggiungi a Home Screen).
- `netlify/functions/calendar.js` — funzione serverless che legge Firestore (via
  Firebase Admin SDK) e genera al volo un feed **.ics** per l'abbonamento calendario
  (così gli appuntamenti si sincronizzano da soli sul Calendario di iPhone/Google
  Calendar, senza export/import manuali).
- `netlify/functions/backup-daily.mjs` (pianificata, ogni notte alle 02:30 UTC) e
  `netlify/functions/backups.mjs` (dall'app, con l'ID token Firebase dell'utente: elenco,
  download, "Fai una copia adesso"): backup JSON di
  `users/<uid>/{contacts,calls,projects,settings,portale,forecastStorico,sopralluoghi}` (version 2; restano fuori
  `portaleImport`, rileggibile dal PDF, e `suggerimenti`) su **Netlify Blobs** (store `backups`,
  chiave `<uid>/<YYYY-MM-DD>.json` per la notturna, `<uid>/<YYYY-MM-DD>_<HHMMSS>.json` per le
  manuali, che non sovrascrivono mai; `KEY_RE`). Si tengono gli ultimi 30 giorni e per sempre la
  notturna del primo del mese. **Ripristino** dall'app (Impostazioni, "Ripristina" con conferma
  inline, `restoreBackup`): prima una copia manuale di sicurezza dei dati attuali (POST), poi per
  ogni collection della copia elimina i documenti che non c'erano e riscrive gli altri (batch da
  400); il messaggio indica la copia di sicurezza da ripristinare per annullare. Logica comune in
  `netlify/lib/backup.mjs` (fuori da `functions/` per non diventare una function).
  Il service worker non mette in cache nulla sotto `/.netlify/`.
- `tests/` — **controlli automatici da lanciare prima di ogni pubblicazione**: `cd tests`,
  `npm install` (la prima volta), `npm test` (`node run.mjs`; `--show` apre il browser, `--shots`
  salva le schermate del telefono in una cartella temporanea). playwright-core usa Chrome/Edge
  installato; `fake-firebase.js` sostituisce gli script Firebase (stessa interfaccia compat, dati
  in memoria da `window.__seed`, accesso dai test con `window.__fake`); functions, Nominatim,
  mappe e font sono simulati. Controlla: tutte le pagine senza errori, cifre di forecast e budget,
  Da fare, registrazione chiamata, doppioni e unione, ripristino, conferma d'ordine e PDF del
  portale, schede del portale "Mostra tutto", nessuna pagina piu' larga dello schermo a 390 px. I
  PDF di prova (dati di clienti, testo coperto da copyright) stanno FUORI dal repo in
  `../test-fixtures/` (`conferma-ordine.pdf`, `portale.pdf`): se mancano quei test si saltano. Mai
  committarli. `/tests/*` non e' servito da Netlify; `node_modules/` e' ignorato da git.
- `package.json` (dipendenze: `firebase-admin`, `@netlify/blobs`, `@anthropic-ai/sdk`) e `netlify.toml` (build minimale,
  `functions = "netlify/functions"`, redirect della radice verso l'app e blocco dei file
  che non devono essere serviti: `CLAUDE.md`, `package.json`, `netlify.toml`, `netlify/*`).

## Persistenza dati

Due collection: `contacts` e `calls` (piu' quelle aggiunte nel tempo, descritte sotto).

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
  email, followUp (datetime ISO "YYYY-MM-DDTHH:MM"), tag, note, spento ({motivo, il, nota} o null).
  **Contatto spento** (blocco "Contatti spenti e nuovo tentativo con chi non ha risposto"):
  "Spegni contatto" nella scheda (motivi `SPENTO_MOTIVI`: attivita' cessata, pensione, deceduto,
  si occupa d'altro, altro) toglie anche il follow-up; resta in rubrica in grigio (`isOff`,
  `offTag`, `.contact-off`) ma esce da follow-up (Oggi, riepilogo, pagina Follow-up, badge,
  notifiche), Da ricontattare, Suggeriti da Claude (anche in `suggest.mjs`), mail da inviare e
  mappa. "Riattiva" = spento null. **Chi non ha risposto**: nei moduli chiamata (scheda contatto e
  Chiamata) un esito di `ESITI_NON_RAGGIUNTO` propone il follow-up dopo `promemoria.richiamo`
  giorni (7) alle 09:00 se vuoto (`bindAutoFollowUp`, segnato `data-auto`, tolto se l'esito
  cambia e la data non e' stata toccata). `TODO_DEFAULTS.nonRaggiunto` portato da 30 a 7 (richiesta
  dell'utente 2026-10-08: chi non risponde va riprovato dopo circa una settimana).
  Lo studio/attività è un'entità "derivata", senza collection propria: contatti con lo
  stesso `azienda` normalizzato (`normStudio`: minuscole, spazi e punteggiatura) sono
  lo stesso studio; via/citta/telefono dello studio si ricavano dai membri
  (`studioIndex`). Il modulo suggerisce gli studi esistenti, al salvataggio usa la
  grafia prevalente (`bestStudioName`) e può propagare via/città/telefono agli altri
  membri. I doppioni di contatto si riconoscono dal cellulare, non dal telefono studio.
  **Possibili doppioni** (Contatti -> "Possibili doppioni (N)", blocco omonimo, `view='dups'`):
  gruppi (union-find) per stesso cellulare (`digits9`), stessa email (se generica tipo info@,
  `GENERIC_MAIL`, solo con lo stesso cognome) o stesso nome+cognome anche invertiti. Si sceglie il
  contatto da tenere (proposto quello con piu' chiamate/progetti/dati, `dupScore`); "Unisci"
  (`mergeContacts`) riempie i campi vuoti, unisce tag e note, prende il follow-up piu' vicino,
  sposta le chiamate e le partecipazioni ai progetti (senza duplicati) ed elimina gli altri. "Non
  sono doppioni" salva le coppie in `settings.nonDoppioni` ("idA|idB" ordinati).
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
  l'offerta), offertaUrl (link al PDF; i file veri vanno in "Documenti", vedi sotto), ordini [{id, data, numero, importo, consegna, note, consegnatoIl?, consegnaIniziale?, rinvii?}] (consegne
  parziali; dati del DDT, consegna = data prevista: il primo ordine segna confermaOrdine se
  vuota; merceCantiere si compila segnando "Consegnato" il primo ordine nella pagina Consegne, o a
  mano nella timeline; la modifica dell'ordine dalla scheda conserva consegnatoIl/rinvii; `projectAmount` per le confermate = max(deliberato o offerta, totale ordinato)); `supplyInfo` = % merce spedita (ordinato su deliberato, o offerta se manca) mostrata nella riga dell'elenco e nella scheda ordini delle confermate: oltre il 100% diventa rossa e propone "Adegua il deliberato" (importoDeliberato = totale ordinato),
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
  I campi si salvano all'uscita e aggiornano le cifre senza ridisegnare la pagina. Sul telefono
  (<=720px) la riga e' compatta: etichette accanto ai valori, offerta/ponderato, probabilita'/
  chiusura, ripartizione (classi `fc-c-*`, `.fc-long` nascosto).
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
- **Consegne** (voce di menu dopo Progetti, blocco "Consegne", `view='deliveries'`): tutti gli ordini
  dei progetti non persi per data di consegna: In ritardo, Oggi, Prossimi 7 giorni, poi per mese,
  Senza data, Consegnate (chiuse in un `<details>`, ultime 60). "Posticipa" (data, +1 giorno, +1
  settimana) aggiorna `consegna`, conta `rinvii` e al primo rinvio salva `consegnaIniziale`;
  "Consegnato" scrive `consegnatoIl` (non nel futuro) e compila `fasi.merceCantiere` se vuota;
  "Annulla consegna" la toglie (e svuota merceCantiere se era quella data e nessun altro ordine).
  Badge `delBadge` (e nel menu) = consegne di oggi o in ritardo non segnate (`deliveriesDue`).
  `delEdit` = modulo aperto (blocca i ridisegni automatici in `canAutoRender`).
- **Ritorno alla mappa** (blocco "Ritorno alla mappa"): aprendo dalla mappa un progetto, un contatto
  o un cantiere del portale (`noteMapReturn` salva centro e zoom in `mapReturn`) compare il pulsante
  fisso `#mapReturnBtn` "Torna alla mappa" (in basso a destra, appeso a body, gestito da
  `updateMapReturnBtn` all'inizio di `renderMain`); resta nelle viste `MAP_RETURN_VIEWS` e nel
  dettaglio chiamata, sparisce scegliendo un'altra sezione; `bindMap` ripristina centro e zoom.
- **Sopralluoghi** (blocco "Sopralluoghi", `view='sop'`): collection `sopralluoghi` {quando
  'YYYY-MM-DDTHH:MM', durata (min), projectId o vuoto, pid (cantiere del portale d'origine),
  titolo/via/citta (cantieri non a sistema), note, noteDopo (esito), geo, createdAt}. Si
  pianificano da Appuntamenti ("+ Sopralluogo", `data-sop-new`), dalla scheda progetto
  (`projectSopsHtml`, `data-sop-project`) o da un cantiere del portale (`data-sop-portal`: se
  collegato a un progetto usa quello, altrimenti titolo e indirizzo del portale). Un ascoltatore
  globale su document apre il modulo da ogni `[data-sop-id]`; `sopEdit.back` riporta alla vista di
  partenza. Compaiono negli Appuntamenti (elenco/svolti mescolati per data con `mergeTimed`,
  calendario settimanale `.appt-chip.sop`, ricerca `sopMatches`), in Oggi e nel riepilogo
  laterale, nel calendario del mese, nelle notifiche (15 min prima), nel file .ics e nel feed
  `calendar.js` (con VALARM e durata), sulla mappa (filtro "Sopralluoghi in programma", cerchi
  grigio scuro con "S"; posizione del progetto o geocodifica di via/citta' salvata in `geo`).
- **Agenda per pianificare** (blocco omonimo): sotto data/ora di appuntamenti (scheda contatto,
  Chiamata, modifica chiamata) e sopralluoghi, `<div class="planner" data-planner="idData|idOra|
  chiave">` mostra la settimana lun-dom, ore 7-21 (`PLAN_H0/H1`, mezz'ora = `PLAN_ROW` px) con
  appuntamenti e sopralluoghi gia' fissati (con durata; `chiave` 'call:id'/'sop:id' esclude
  l'impegno che si sta modificando); clic su uno spazio = compila data e ora (+ evento change),
  il nuovo impegno appare tratteggiato. Segue la settimana della data scelta e scorre da solo fino
  al giorno scelto/oggi (sul telefono si vedono circa 4 giorni, colonna delle ore fissa). Montata da
  `mountPlanners` (queueMicrotask all'inizio di `renderMain` e `renderCallFlow`). Ogni impegno mostra
  l'indirizzo sotto il nome; toccandolo si apre `.plan-info` in cima all'agenda (data, orario, studio,
  indirizzo con Indicazioni, telefono, progetto e note) senza uscire dal modulo. Trascinamento (pointer
  events; sul telefono dopo una pressione di 350 ms, un trascinamento veloce resta scorrimento):
  "questo" cambia data/ora del modulo, un impegno fissato si sposta solo dopo "Sposta" nella
  `.plan-info` (aggiorna `calls.appuntamento` o `sopralluoghi.quando`, aggancio alla mezz'ora);
  `plannerHold` blocca per 4 s i ridisegni automatici in `canAutoRender` per non svuotare il modulo.
- **Suggerisci quando** (blocco omonimo, `.trip-box data-trip="idData|idOra|esclusa|origine"`, sopra
  l'agenda nei moduli di sopralluogo e appuntamento): per i prossimi `TRIP_DAYS` (10) giorni
  lavorativi costruisce il giro casa -> impegni fissati -> casa e cerca dove ci stanno viaggio +
  durata + viaggio verso il successivo + margine; prima dell'impegno successivo propone l'ora piu'
  tardi, altrimenti la prima utile; ordina per minuti di strada in piu'. Impostazioni ->
  "Spostamenti": `settings.viaggi` {casa, inizio, fine, margine, geo} (default `VIAGGI_DEFAULT`:
  Collegno, 08:30-18:30, 10 min). L'indirizzo preciso di casa va SOLO in Impostazioni (dati
  dell'utente in Firestore), mai nel codice: il repository e' pubblico. Tempi in auto da OSRM
  (`router.project-osrm.org/table`, gratuito, solo coordinate, senza traffico), altrimenti linea
  d'aria x1,3 a 60 km/h. Coordinate gia' salvate o cercate e salvate (`docPoint`). Sopralluogo
  nuovo: durata predefinita 10 min (opzioni da 10 a 240). `timeOptions` accetta orari fuori dalla
  mezz'ora (es. 14:35 suggerito).
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
- **Foto del cantiere** (scheda progetto, sopra i Documenti; blocco omonimo, solo versione online):
  ridotte sul dispositivo prima del caricamento (canvas -> JPEG; `FOTO_QUALITA`: normale 2560 px
  q 0,85 ~1 MB, predefinita, o alta 4000 px q 0,9, scelta dall'utente il 2026-10-06; in Impostazioni,
  `settings.fotoQualita`) piu' anteprima da 480 px. La nuova codifica toglie l'EXIF (anche il GPS);
  la data di scatto viene dall'EXIF (`exifDate`) o dalla data del file. File in
  `users/<uid>/projects/<projectId>/foto/<id>.jpg` e `<id>-anteprima.jpg`, elenco in `projects.foto`
  [{id, path, thumb, data, nota, w, h, size, caricatoIl}], salvato dopo ogni foto. Visore a schermo
  intero `#fotoViewer` appeso a body (fuori da #main, cosi' i ridisegni non lo chiudono): frecce,
  scorrimento col dito, Esc, data e nota modificabili, "Apri a piena dimensione", Elimina con
  conferma inline. In Impostazioni anche lo spazio occupato da foto e documenti (dalle `size`).
  Come i documenti, i file non sono nei backup (solo l'elenco). Le regole di Storage esistenti
  (`users/<uid>/**`, < 20 MB) coprono gia' le foto.
- **Mappa** (voce di menu, blocco "Mappa"): Leaflet 1.9.4 (cdnjs) + tile OpenStreetMap; clienti
  raggruppati per indirizzo (cerchi blu), cantieri in corso / confermati / persi (quadrati
  ambra / viola / vuoti; colori validati per daltonismo). Coordinate da Nominatim (1 richiesta
  al secondo, solo l'indirizzo), salvate in `contacts.geo` / `projects.geo` = {lat, lng, a}
  (`a` = indirizzo cercato: se cambia si ricerca; `nf` = non trovato; `v` = `GEO_V`, i "non trovati"
  con regole precedenti si ritentano). `geocodeSmart`: indirizzo intero, prima via (prima di "-", "/",
  " e "), senza civico, infine solo comune (`approx`, bordo tratteggiato). Progetti senza indirizzo:
  quello della scheda del portale collegata (`projectGeoAddr`). Riquadro "Non sulla mappa"
  (`mapMissingHtml`) con progetti/clienti mancanti e motivo. "Correggi posizione" nelle schede cliente e
  progetto (blocco "Posizione corretta a mano"): editor Leaflet con segnaposto trascinabile, salva
  `geo.manual` (vale per Mappa, mappa incorporata e "Indicazioni" via `manualGeo` in `mapsUrl`/
  `mapEmbedUrl`; per i clienti anche ai colleghi con lo stesso indirizzo; si azzera se l'indirizzo
  cambia o con "Torna alla posizione dell'indirizzo"). "Vicino a…" (località o
  posizione del telefono) elenca cosa c'è entro 20 km. `canAutoRender` esclude la mappa.
  Cantieri del portale (filtri "Portale: seguiti", acceso di default, e "Portale: da valutare", spento:
  sono centinaia): rombi rosa `#d1495b` (pieno = seguito, vuoto = da valutare; colore validato per
  daltonismo contro blu/ambra/viola). Da valutare = stessi criteri di "Da esaminare" (non scartati,
  non collegati a progetti, solo nuove costruzioni salvo `portalFilters.ristrutturazioni`), cercati in
  ordine di priorita'. Indirizzo `portalGeoAddr` (via + comune, o solo comune), coordinate in `geo` sul
  documento di `portale` / `portaleImport` (conservate dai nuovi PDF perche' l'importazione scrive in merge;
  "Da seguire" copia il geo nel cantiere seguito). Fumetto con fase, unita', volume, clienti in
  rubrica, nota e "Apri scheda" (`data-portal-goto`). `geoTried` evita ricerche ripetute nella
  sessione; `runMapGeocoding` riparte da solo se nel frattempo si accende un filtro.
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
  le pagine con lo stesso "ID Progetto". Riquadro in alto (y > `PORTAL_HEAD_Y`): titolo e indirizzo
  del cantiere (anche su due righe; fascia "PNRR" saltata), indirizzo mostrato nella scheda con
  "Indicazioni" (`portalViaCitta`, anche senza CAP). Volume = unita' abitative x `settings.portaleMl` (10 m)
  x `settings.portaleEuro` (80 €/m); priorita' pesata per fase (Progettazione 1,2,
  Programmazione 1, Esecuzione 0,6), ristrutturazione 0,5, clienti noti 1,5; stelle da 8.000 e
  25.000. Di default solo nuove costruzioni (l'utente non segue le ristrutturazioni). Soggetti
  confrontati con la rubrica per email, telefono (ultime 9 cifre), cognome+nome, studio. Importazione salvata
  in collection `portaleImport` (un documento per cantiere, ID = ID portale: {pid, dati, scartato,
  nuovo, importatoIl}; scritta a batch da 400, letta solo aprendo la sezione) con i metadati in
  `settings.portaleImport` {file, caricatoIl, letti, totale, nuovi, files[ultimi 20]}. Dal 2026-10-09
  un nuovo PDF si AGGIUNGE (l'utente carica piu' regioni: Piemonte, Liguria, Valle d'Aosta): i
  cantieri gia' presenti (stesso ID portale) aggiornano solo `dati`, con scrittura in merge che
  conserva scartato e `geo`; i nuovi entrano con `nuovo` e `primaImportazione`; nessuno viene tolto;
  "nuovo" vale solo per l'ultimo PDF (agli altri si toglie). Prima di unire aspetta che
  `portalImport` sia letto. Filtro "Regione" (`REGIONI_PROV`/`PROV_REGIONE`, `portalRegion`, dalla
  sigla della provincia; `portalFilters.regione`), che restringe anche l'elenco delle province. Descrizione salvata fino a 4000 caratteri (600 nelle importazioni prima del
  2026-10-06: per il testo intero si ricarica il PDF). Le schede mostrano 3 righe di descrizione e il
  primo telefono/email dei soggetti; "Mostra tutto" (o il titolo) apre testo completo e tutti i
  recapiti (`portalOpen`, solo classe CSS `.open`, niente ridisegno). Pagine "Da esaminare" (si ripulisce con Da seguire / Scarta) e "Cantieri
  seguiti": collection `portale` {pid, stato:'seguito', dati, nota, seguitoIl, aggiornatoIl},
  mai toccata dalle importazioni (solo `dati` aggiornati con la scheda piu' recente). Registrando
  una chiamata con un contatto presente in un cantiere seguito, "Progetto / argomento" si compila
  con l'indirizzo del cantiere (uno solo, o quello da cui si e' aperto il contatto:
  `portalCallCtx` = {pid, contactId}, vale sempre per quel contatto); legame contatto-cantiere con
  `contactInSoggetto` (email, telefono, cognome+nome o stesso studio: valgono anche i colleghi) e sotto ci sono i pulsanti dei cantieri seguiti del contatto
  (blocco "Cantieri seguiti nelle chiamate"). Nella scheda contatto il riquadro "Cantieri dal portale"
  (`contactPortalHtml`) elenca i cantieri seguiti (con nota) e quelli ancora da esaminare in cui
  compare il contatto; il clic apre la pagina giusta della sezione ed evidenzia il cantiere
  (`portalFocus`). Aprire la scheda avvia la lettura di `portaleImport` se non ancora fatta.
  Collegamento cantiere-progetto (blocco "Cantieri del portale collegati ai propri progetti"):
  `projects.portaleIds` [ID portale] (+ vecchio `portaleId`, `projectPortalIds`); `portalCandidates`
  propone i progetti simili (stesso comune obbligatorio, poi stessa via +3, parola del nome nella
  descrizione +2, stesso professionista +3; soglia 4, "molto probabilmente" da 8); "Collega a un
  progetto…" cerca per ID/nome/via; i collegati escono da "Da esaminare" (casella per vederli);
  nella scheda progetto il riquadro "NII Progetti" (`projectPortalCardHtml`) elenca le schede
  collegate con dati, "Apri scheda", "Scollega" e avviso se collegate anche ad altri progetti; sul
  cantiere compaiono tutti i progetti collegati (`portalProjectsOf`), ognuno con Apri/Scollega. "Crea contatto" / "Crea progetto" aprono i moduli
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
- Niente `confirm()`/`alert()` nativi per conferme critiche (scelta storica, nata quando l'app
  girava come Claude Artifact): le conferme di eliminazione sono implementate come UI inline nella
  pagina stessa (pattern già presente per contatti e chiamate — riusarlo per nuove
  funzionalità di eliminazione).
- Ogni vista/tab (Oggi, Contatti, Chiamata, Follow-up, Appuntamenti, Tabella chiamate,
  Dashboard) è una funzione JS che ritorna una stringa HTML, iniettata in `#main` da
  `renderMain()`. Il click-binding avviene subito dopo l'iniezione, dentro lo stesso
  `if(view===...)` block.
- Telefono: i campi data/ora/mese sotto i 720px non hanno l'aspetto nativo (`appearance:none`,
  `min-width:0`), perche' Safari su iPhone da' loro una larghezza minima che esce dallo schermo.
