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
  `users/<uid>/{contacts,calls,projects,settings,portale,forecastStorico,sopralluoghi,report,collegamenti,fatture,regali,segnalazioni}` (version 2; restano fuori
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
  Le date dei test sono locali (`iso`), come nell'app: con toISOString tra mezzanotte e le 2 fallivano.
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
  **Follow-up come azione** (blocco omonimo, 2026-10-22): non piu' nel modulo "Modifica contatto" (salvando si
  conserva quello esistente) ma con "+ Follow-up" / "Modifica follow-up" nella scheda del contatto e "+ Aggiungi
  follow-up" (contatto da datalist) e "Sposta" nella pagina Follow-up; modulo comune `fuFormHtml` (data, ora,
  scorciatoie domani/+1 sett/+2 sett/+1 mese, "Togli il follow-up"), stato `fuEdit`, scrive followUp e followUpSetAt.
  Restano i campi follow-up nella registrazione di un'attivita'.
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
  **Salva nella rubrica del telefono** (scheda contatto, blocco omonimo): `vcardText` (vCard 3.0: N, FN,
  ORG, TITLE, TEL cell/lavoro, EMAIL, ADR; niente note) scaricato come .vcf (`downloadVCard`); su
  iPhone apre "Nuovo contatto". Una tantum, scelta dell'utente 2026-10-12 (no export di massa, no CardDAV).
  Su iOS 27 la scheda "Nuovo contatto" si chiude senza salvare (anche da Safari e con account iCloud, 2026-10-15). Provato e
  TOLTO lo stesso giorno l'invio via function con POST in Safari: la pagina si bloccava e Safari chiedeva il login;
  l'utente preferisce il download del file.
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
- **calls** = ATTIVITA' (dal 2026-10-13, voce di menu "Attivita'", ex "Chiamata"; blocco "Attivita'"), campo
  `tipo`: 'telefonata' (o assente: dati vecchi), 'incontro', 'mail' (`actType`, `isPhone`/`isMeet`/`isMailAct`).
  Telefonata: contactId, data (YYYY-MM-DD), esito, progetto, note, appuntamento (= incontro FISSATO, datetime
  ISO), incontroId (incontro svolto che lo chiude), noteIncontro (solo dati vecchi), createdAt, mailDaInviare
  (bool), mailInviataIl (YYYY-MM-DD). Incontro (SVOLTO, evento a se' con la sua data): data, ora, note,
  progetti, consegnaOfferta, daAppuntamento (telefonata che l'aveva fissato). Mail: data, ora, oggetto, note,
  testo (mail incollata), sottotipo 'presentazione'. Modulo con selettore del tipo (scheda contatto e
  "Attivita'": `actTypePills`, sezioni `[data-act-sec]`, `bindActForm`/`saveActivity`; la telefonata usa
  ancora `saveCall`/`saveQuickCall`); mail incollata letta da `parsePastedMail` (righe Oggetto/Inviato/A,
  date italiane o inglesi). Trascinamento della mail (riquadro `[data-mail-drop]` o "Scegli il file", blocco
  "Mail trascinata"): .msg di Outlook letto con `@kenjiuno/msgreader` 1.28.0 (Apache-2.0) importato al bisogno
  da jsDelivr (+esm), .eml letto da `parseEml` (intestazioni, parole codificate, multipart, QP/base64, html ->
  testo); compila oggetto, data, ora e testo (`applyMailData`). Tutto sul dispositivo. Test: .eml completo;
  .msg solo l'oggetto (il file di prova `../test-fixtures/prova.msg` e' generato con il Burner della
  libreria, che scrive male i flussi piccoli). Un appuntamento passato senza incontro e' "da registrare" (`apptToRegister`,
  `meetingOf`): riquadro "Incontri da registrare" in Oggi (ultimi 60 giorni) e Appuntamenti -> Svolti con
  "Registra l'incontro" (`actPrefill`: incontro precompilato con data, ora, progetti, daAppuntamento).
  Clic su un appuntamento (Oggi, riepilogo, calendari, Appuntamenti; ascoltatore in cattura su document):
  incontro gia' registrato -> si apre l'incontro; appuntamento di oggi o passato -> `openMeetRegister`;
  futuro -> la telefonata. Le righe di storico e liste di attivita' hanno `data-appt-raw` e aprono la riga.
  Conversione una tantum `migrateActivities` (settings.attivitaV2; parte solo dopo aver letto calls e dopo
  una copia di sicurezza POST): ogni appuntamento passato ottiene un incontro `inc_<id telefonata>` (id fisso:
  sicuro se due dispositivi convertono insieme) con le note dell'incontro; le righe importate da Excel
  diventano direttamente incontri. Dashboard: "Telefonate" (bucket senza filtro = solo telefonate), "Appuntamenti
  fissati", "Incontri svolti" e "Mail inviate" (`meetMailCards`, colori `MEET_COLOR`/`MAIL_COLOR` come i segni;
  dettaglio per tipo `DRILL` in `dashboardDrilldownView`); Tabella attivita' con filtro Tipo (`tableFilters.tipo`); Clienti: incontro = attivita' Incontro o appuntamento; Tabella "attivita'" con il
  tipo; Excel foglio "Attivita'" con colonna Tipo; l'import da Excel crea incontri per gli appuntamenti
  passati. `suggest.mjs` legge i tipi (esiti solo dalle telefonate).
  Promemoria "mail informativa" aperto = mailDaInviare && !mailInviataIl: compare in
  Oggi (una riga per cliente, `pendingMailGroups`), nel riepilogo laterale, nel badge di
  "Oggi"/menu e come notifica dalle 17:30. L'email inserita registrando una chiamata
  aggiorna `contacts.email`.
  **Follow-up chiuso registrando** (2026-10-14): i moduli di registrazione (scheda contatto e Attivita') non
  ripropongono un follow-up scaduto o di oggi (`fuToKeep`), quindi salvando qualunque attivita' senza toccarlo il
  follow-up si chiude come con "Follow-up effettuato"; quelli dei giorni seguenti restano.
  **Follow-up chiusi da un'attivita'** (blocco omonimo, 2026-10-14): controllo incrociato a ogni aggiornamento di
  contatti/attivita' (`scheduleFollowUpCheck`): un follow-up di oggi o scaduto si chiude (followUp '') se c'e' un'attivita'
  del cliente con data >= giorno del follow-up, esclusa quella durante cui e' stato fissato: `contacts.followUpSetAt`
  (ms) scritto da ogni modulo che imposta il follow-up; l'attivita' conta se createdAt > followUpSetAt + 5 s.
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
  copie automatiche notturne. (Una prima mail da modello fu tolta su richiesta dell'utente: `mailOggetto`/
  `mailTesto` in settings sono inutilizzati.) **Mail di presentazione** (2026-10-12, testo dato dall'utente;
  blocco omonimo): "Mail di presentazione" nella scheda contatto e nelle mail informative da inviare
  (`data-mail-pres`) apre Outlook web (`outlook.office.com/mail/deeplink/compose`, to/subject/body),
  "con l'app di posta" usa mailto:. Testo `MAIL_PRES_DEFAULT` con `{firma}`; `settings.mailPres` {firma,
  oggetto, testo} in Impostazioni; la firma (nome dell'utente) MAI nel codice, il repo e' pubblico.
  Senza firma chiede di impostarla. Aprendo la mail la registra come attivita' Mail in `calls` {tipo:'mail',
  sottotipo:'presentazione', data, ora, oggetto} (`logPresentationMail`; chiude anche la "mail informativa"
  in sospeso del cliente); le vecchie `contacts.mailPresentazioneIl` valgono come una mail (`contactMails`).
  **Ultimi contatti** (blocco "Mail inviate e ultimi contatti"): riquadro nella scheda contatto
  (`lastContactsHtml`: ultima telefonata con esito, ultima mail, ultimo incontro; elenco "Mail inviate" con
  Elimina e conferma inline) e riga "Ultimo contatto" nella registrazione chiamata; `lastActivities(cid)`.
  "Da ricontattare" conta l'ultima attivita' su ogni canale: se l'ultima e' una mail, richiamo dopo
  `promemoria.dopoMail` (7) giorni ("mail di presentazione inviata N giorni fa"); anche contatti con sole
  mail. `lastContactDays` (mappa) e `suggest.mjs` (legge `mails`, passa a Claude solo i giorni) idem. Provata e tolta
  (2026-10-12, non funzionava per l'utente) l'opzione "modello personale di Outlook" con mail aperta vuota;
  un eventuale `mailPres.modello` rimasto in settings e' ignorato. Il deeplink accetta solo testo semplice, quindi il
  GRASSETTO passa dagli appunti: il testo usa `**...**`; al clic `copyMailPres` copia HTML (`mailPresHtml`:
  <b>, <br>) + testo semplice con ClipboardItem (dentro il clic, per Safari) e Outlook/mailto si aprono con
  destinatario e oggetto senza corpo; l'utente incolla. Senza ClipboardItem: corpo in testo semplice nel link.
  Oggetto predefinito e grassetti presi dalla mail reale dell'utente (2026-10-12).
- **Oggi → "Da fare"** (blocco "Da fare (in Oggi)", prima del Forecast): calcolato dai dati.
  Offerte da sollecitare (offertaPresentata raggiunta, non confermata ne' persa, da
  `promemoria.sollecito` giorni contati dall'ultimo `projects.sollecitatoIl` o dall'ultima telefonata/incontro collegati al progetto in `calls.progetti` (`linkedActivityDate`); per ogni offerta l'ultima telefonata e l'ultimo incontro con i partecipanti (`projectContactActivity`), con pulsante "Riguardava questa commessa" che aggiunge il progetto a `calls.progetti`); commesse ferme
  (prima dell'offerta, nessuna fase da `promemoria.ferma` giorni); **in attesa di Michael / Claudia**
  (`waitingProjects`, `promemoria.attesa` = 7 giorni: richiesta/elaborati senza proposta tecnica, o
  proposta tecnica senza offerta economica; una data futura conta come prevista e non segnala;
  pulsanti "Arrivata: allega file", "Arrivata oggi" `data-phase-mark`, "Rimanda"; queste commesse non
  si ripetono tra le ferme). Le attese sono in un riquadro a se' sopra "Da fare" (`waitingCardHtml`,
  `<details>`): aperto se ci sono commesse in attesa, chiuso se non ce ne sono; `waitingOpen` ricorda
  solo i clic dell'utente sul titolo (non l'evento toggle, che scatta anche all'apertura automatica); da ricontattare (clienti con
  chiamate, senza progetti in corso o acquisiti, senza follow-up o appuntamenti futuri, senza
  "Non interessato" nell'ultimo anno, fermi da `promemoria.ricontatto` giorni o
  `promemoria.nonRaggiunto` se l'ultimo esito e' in `ESITI_NON_RAGGIUNTO`; prima Interessato/Da
  richiamare). "Rimanda" scrive `rimandaAl` (YYYY-MM-DD) su progetto o contatto. Intervalli in
  Impostazioni (`settings.promemoria`, default `TODO_DEFAULTS`). Sotto, "Dati da completare"
  (commesse aperte senza importo/chiusura prevista, confermate senza deliberato ne' offerta,
  contatti dei progetti senza email/telefono).
  **Revisione del forecast** (blocco omonimo, 2026-10-21): riquadro in Oggi dal lunedi' (non sabato e domenica) finche'
  non si preme "Revisione fatta" (`settings.revisioneForecast`, si riapre il lunedi' dopo): commesse aperte con
  chiusura prevista superata o mancante, probabilita' non indicata, o senza aggiornamenti (updatedAt, fasi, attivita'
  collegate) da `REV_DAYS` (30) giorni (`forecastReviewItems`, per importo); probabilita' e chiusura modificabili li',
  "Ancora valida" aggiorna updatedAt. `forecastReviewHtml(now)` accetta la data per i test.
- **Consegne** (voce di menu dopo Progetti, blocco "Consegne", `view='deliveries'`): tutti gli ordini
  dei progetti non persi per data di consegna: In ritardo, Oggi, Prossimi 7 giorni, poi per mese,
  Senza data, Consegnate (chiuse in un `<details>`, ultime 60). "Posticipa" (data, +1 giorno, +1
  settimana) aggiorna `consegna`, conta `rinvii` e al primo rinvio salva `consegnaIniziale`;
  "Consegnato" scrive `consegnatoIl` (non nel futuro) e compila `fasi.merceCantiere` se vuota;
  "Annulla consegna" la toglie (e svuota merceCantiere se era quella data e nessun altro ordine).
  Badge `delBadge` (e nel menu) = consegne di oggi o in ritardo non segnate (`deliveriesDue`).
  `delEdit` = modulo aperto (blocca i ridisegni automatici in `canAutoRender`).
- **Fatturazione provvigioni** (Consegne -> scheda "Fatturazione", `delTab`, blocco omonimo, 2026-10-21; modello: il
  file Excel mensile dell'utente, fuori dal repo): un mese = ordini consegnati nel mese (`consegnatoIl`) o spostati a
  mano (`ordini[].meseFattura` 'YYYY-MM', es. merce uscita dal magazzino a fine mese), sommati per commessa.
  Compenso = merce x quota (25%) se il margine DB e' >= quota ("SI", default), altrimenti merce x DB (`fattFee`, come
  la formula IF(D>=0.25,C*$F$1,C*D) del file). Ordini con prodotti non Isokorb (Bole, Tronsole...) segnalati "margine
  da verificare con l'azienda" (scelta dell'utente). Voci: auto 1.000 e compenso mensile 2.500 (`settings.fatturazione`
  {quota, auto, fisso}, `FATT_DEF`) + voci libere (spese tecniche assistenze in cantiere). Collection `fatture` (id
  'YYYY-MM', nei backup): {mese, stato bozza|emessa, db {projectId: num|null}, voci, righe (fotografia all'emissione),
  totale, emessaIl, importato}. "Segna come emessa" fotografa righe e totale; "Riapri" ricalcola. Avviso: ordini con
  consegna prevista nel mese non segnati.
  "Scarica Excel" (`fattExportXlsx`, SheetJS): un foglio per mese "YYYY_MM" con le colonne del file dell'utente
  (N° project, Project name, sales amount, DB > 25 ?, fee + F1 = quota), formula del compenso, "spese tecniche
  assistenze in cantiere", voci e "invoice total" = SUM. "Importa dal mio Excel" (`fattImportXlsx`): i fogli dei
  mesi passati diventano fatture emesse (importato); il mese in corso lo calcola l'app.
  2026-10-21: per ogni commessa "Fattura in" (mese prima/dopo o "Non fatturare" = `meseFattura` 'no') e indirizzo del
  cantiere (`fattAddr`, anche dalla scheda NII); "+ Aggiungi una commessa" (ricerca ID/nome/indirizzo, `fattAddPid`):
  suoi ordini con "Fattura in <mese>" o riga a mano con importo (`fatture.extra` [{id, pid, codice, nome, importo}]).
  **Abbinamento dei mesi importati** (`fattReconcile`, dopo l'importazione e all'avvio): per ogni riga importata,
  ordini della stessa commessa non assegnati e consegnati nel mese o in quello dopo (o non segnati) la cui somma da'
  l'importo (al centesimo, `fattMatchOrders`) -> `meseFattura` = quel mese e riga.ordini; cosi' una fornitura uscita a
  fine mese, fatturata allora e consegnata il mese dopo, non ricompare (caso reale: Villetta, agosto/settembre).
  **Riepilogo dell'anno** (`fattSummaryHtml`, anno solare `fattYear`): totale (emesso / da emettere), provvigioni e merce
  fatturata, auto e compenso fisso, commesse fatturate, media al mese; grafico a colonne per mese (provvigioni + voci
  fisse impilate, mesi da emettere attenuati, clic = apre il mese) e tabella "Mese per mese". Un mese passato senza
  fattura emessa conta come da emettere (auto e fisso si fatturano ogni mese). **Forniture non fatturate**
  (`fattNeglected`): ordini di mesi passati con fattura non emessa, fuori da una fattura emessa (per i mesi importati
  senza abbinamento vale la commessa), consegne previste da oltre 7 giorni mai segnate, e (a parte) quelli tolti a mano;
  pulsante "Fattura in <mese corrente>".
  **Provvigioni in arrivo e obiettivo** (2026-10-21, `fattIncoming`, alla quota piena): commesse confermate = ordini
  registrati non consegnati nel mese della consegna prevista (date passate e senza data: mese in corso) + resto da
  spedire (`toShip`) diviso per anno con `yearShares` e sui mesi che restano; commesse aperte = `forecastWeighted` nel
  mese di `chiusuraPrevista` (o sui mesi che restano). Nel grafico: in arrivo grigio trasparente (scelta dell'utente:
  colore neutro), forecast solo contorno tratteggiato, auto e fisso dei mesi futuri attenuati. Riquadro "Obiettivo":
  provvigioni maturate + in arrivo + forecast contro auto e fisso dell'anno ((auto+fisso) x 12), merce che manca
  (/ quota) e al mese fino a dicembre, anno successivo con confermati e forecast.
- **Torna indietro** (blocco "Torna indietro: cronologia delle schermate visitate", 2026-10-14): `navTrack` (all'inizio di
  `renderMain` e `renderCallFlow`) confronta la posizione (`navKey`: vista, contatto, attivita', progetto, passo e
  sotto-viste) con l'attuale; se cambia mette la precedente (con scorrimento di #main e voce di menu) in `navStack`
  (max 40). `navBack` la ripristina. Pulsante `[data-nav-back]`: su PC barra `#navBackBar` sopra #main ("← Oggi",
  `navLabel`: nome del cliente, del progetto...), sul telefono freccia nella barra in alto. Un modulo Attivita'
  appena salvato (entry -> pick) non entra nella pila. #main ora sta dentro `.main-col` (min-height:0 serve al telefono).
- **Schede dentro l'app** (blocco omonimo dopo "Torna indietro", 2026-10-30): clic con la rotellina (`auxclick`) o
  Ctrl/Cmd+clic, ascoltati in cattura su document, su un elemento con un id di cliente (`TAB_CONTACT_ATTRS`:
  data-contact-id, -contact-open, -open-contact, -mail-contact-id, -map-contact, -seg-contact) o di progetto
  (`TAB_PROJECT_ATTRS`: data-open-project, -project-id, -map-project) apre una scheda nella barra `#appTabBar`
  (in cima a .main-col, schede blu `.app-tab`, attiva con bordo giallo) invece del clic normale. `appTabs[i]` =
  `tabSnap()`: navCur, navStack, scorrimento e voce di menu; `tabSwitch`/`tabRestore` li rimettono (via `navApply`,
  condiviso con navBack). × o rotellina sulla scheda la chiude (`tabClose`); con una scheda sola `appTabs=[]` e la
  barra sparisce. Etichette da `navLabel`, ridisegnate da `updateNavBack`. Cambiare scheda ridisegna: un modulo
  aperto non salvato si perde (come con Torna indietro). Un nuovo attributo che apre un cliente/progetto va
  aggiunto a quelle liste. Link e pulsanti dentro la riga restano loro.
- **Riquadri di Oggi richiudibili** (blocco "Riquadri di Oggi richiudibili e barra del portale che ricompare
  risalendo", 2026-10-14): `foldTodayCards` dopo il disegno di Oggi rende ogni `.card` figlia di #main con un h3
  apribile/chiudibile toccando il titolo (freccia `.fold-head`, `.folded` nasconde tutto tranne il primo figlio);
  i chiusi si ricordano su questo dispositivo in localStorage `oggiChiusi`, per titolo senza numeri
  (`foldKey`). I riquadri `<details>` (attese, dati da completare) restano come prima.
  **Barra del portale**: in "Cantieri dal portale" la riga in alto (`.page-bar`: "← Progetti", "Torna su")
  diventa fissa in cima (`.stuck`, sticky con top = -padding di #main) quando si risale oltre 150 px e
  sparisce scendendo (`bindPageBar`, un solo ascoltatore di scroll su #main).
- **Regali di Natale** (Contatti -> "Regali di Natale", `view='regali'`, blocco omonimo, 2026-10-23): lista proposta
  (`giftCandidates`) = partecipanti di commesse acquisite negli ultimi 2 anni (conferma o forniture), di commesse in
  trattativa, incontrati negli ultimi 6 mesi (incontri o appuntamenti); criteri accendibili; contatti spenti esclusi.
  Raggruppata per studio, prima le collaborazioni in corso; motivo, indirizzo ("Vedi su Maps"), telefono, nota del
  regalo, spunta "consegnato" (data). Togli / Rimetti, "+ Aggiungi un contatto". Collection `regali` (id anno, nei
  backup): {anno, esclusi, aggiunti, consegnati {id: data}, note {id: testo}, criteri}. "Scarica Excel".
  Quantita' per persona (2026-10-23): ceste di alimenti e bottiglie combinabili (`regali.qta {id: {cesta, vino}}`, contatori
  − / +). Proposta: 1 cesta a chi ha una fornitura (commessa acquisita) o un preventivo aperto (commessa aperta con offerta
  presentata, tipo 'off'), 1 bottiglia a chi ha solo accennato a lavori (trattativa senza offerta, incontri); il vecchio
  `regali.tipo` vale come proposta. Sezioni "Con cesta di alimenti" / "Solo bottiglie", totali da comprare, colonne in Excel.
- **Cantieri segnalati** (Progetti -> "Cantieri segnalati (N)", `view='segnalati'`, blocco omonimo, 2026-10-29): lavori
  accennati dai clienti negli incontri, non ancora progetti, da non perdere. Collection `segnalazioni` (nei backup):
  {contactId (chi l'ha segnalato), il, titolo, via, citta, avvio e pronto 'YYYY-MM' (avvio del cantiere, progetto da
  mandare per il preventivo), note, ricontattaIl, storia [{il, nota}], stato aperta|progetto|chiusa, projectId, chiusaIl,
  motivo}. Ricontatto proposto da `segNextDate` (1° del mese "pronto", o 2 mesi prima dell'avvio, o +30 giorni; minimo
  +7, +30 dopo "Sentito") finche' non si sceglie a mano (`data-auto`); scorciatoie +1/2/3/6 mesi. Alla data compare in
  Oggi -> Da fare, "Cantieri segnalati da risentire" (`segDue`; quei clienti escono da "Da ricontattare"): Richiama,
  Sentito (nota, nuove previsioni, prossima data), Rimanda 30 gg, Diventato progetto. "Diventato progetto" crea il
  progetto (`segToProject`: modulo precompilato, il cliente tra le figure con il ruolo da scegliere; al salvataggio la
  segnalazione passa a 'progetto') o collega uno esistente; "Non si fa" la chiude con motivo; Riapri, Elimina con
  conferma inline. Scheda del contatto: riquadro "Cantieri segnalati" (`segContactHtml`, "+ Cantiere segnalato").
  Stato dei moduli `segEdit` / `segAct` (bloccano i ridisegni dello snapshot). Elenco ordinato per data dell'incontro, dalla piu' recente
  (`segByMeet`, 2026-10-30); Oggi e la scheda del contatto restano per data di ricontatto. "Scarica Excel" (`segExportXlsx`):
  l'elenco mostrato (`segFiltered`: scheda e ricerca) con recapiti del cliente, previsioni, note, storia dei "Sentito", stato.
  **Dagli incontri** (2026-10-29): nella registrazione dell'incontro (`actMeetHtml`) "+ Cantiere segnalato" aggiunge righe
  (`segMeetFormHtml`/`segMeetRowHtml`, ascoltatore su document) salvate con l'incontro (`segSaveFromMeet`: cliente, data,
  `incontroId`, ricontatto da `segNextDate`); la scheda dell'incontro/appuntamento ha il riquadro "Cantieri segnalati"
  (`segMeetCardHtml`, "+ Cantiere segnalato" apre il modulo con cliente, data e incontro, poi torna li'). Nel modulo nuovo
  la data "Il" si propone dall'ultimo incontro del cliente (`segMeetInfo`, finche' non la si cambia) e sotto compaiono le
  sue note (`segMeetBoxHtml`); salvando si collega l'incontro di quella data. Nelle righe "all'incontro del ..." lo apre.
- **Rete di collaborazioni** (blocco omonimo, 2026-10-20, passo 1 di 2; il passo 2 sara' la mappa interattiva):
  punti = STUDI (`contactNodeKey`: 's:'+studio normalizzato, o 'c:'+id per chi non ha studio) e soggetti del portale
  non in rubrica ('x:'+nome, uniti per email); abbinamento alla rubrica con `portalMatch`. Legami (`buildNetwork`,
  memo `netCache` sull'identita' degli array): stessa commessa (partecipanti + soggetti delle schede NII collegate,
  la scheda non conta due volte), stesso cantiere del portale (importati e seguiti; esclusi i Committenti, scelta
  2026-10-20) e collegamenti a mano (collection `collegamenti` {a, b: contactId, nota, il, createdAt}, nei backup).
  Forza = numero di lavori + 2 se indicato a mano (`netWeight`). Stato (`NET_STATUS`): acquisito (membro di una
  commessa vinta), trattativa (commessa aperta), contattato (attivita'), rubrica, nuovo. Scheda contatto: riquadro
  "Collaborazioni" (`collabCardHtml`, "+ Collabora con…" con datalist della rubrica, "Togli" con conferma inline).
  Contatti -> "Rete di collaborazioni" (`view='rete'`, `reteView`): ricerca, punto aperto (`reteFocus`, anche nel
  Torna indietro) e "Opportunita'" (`netOpportunities`: punti nuovo/rubrica collegati a clienti/trattative/contattati,
  punteggio = somma peso stato x forza, con "tramite ..."). Clic su un punto (`data-net-node`, ascoltatore su
  document) -> `netOpen` (richiesta 2026-10-20): in rubrica apre l'anagrafica, altrimenti "Cantieri dal portale" con
  ricerca per nome (Seguiti se tutti i suoi cantieri sono seguiti); `data-net-focus` ("collegamenti", "Vedi nella
  rete", clic sulla mappa) apre il punto nella Rete. Nomi della rete senza forma societaria (`netName`: Srl, Spa,
  Snc, Sas...; "Amato Costruzioni" = "Amato Costruzioni Srl"); un soggetto del portale con lo stesso nome di uno
  studio in rubrica diventa quello studio.
  **Mappa della rete** (passo 2, blocco omonimo): canvas con d3 7.9.0 da cdnjs (`loadD3`), forze + zoom/pan
  (`mountReteGraph`, `reteSim`, posizioni conservate in `reteGraphPos`); `reteSubgraph`: "I miei" (studi con
  stato > rubrica e i loro 6 legami piu' forti, max 220), "Tutta la rete" (350 piu' collegati) o, con un punto
  aperto, i suoi legami fino al secondo livello (max 140); filtro forza minima `reteMinW`. Raggio secondo i lavori,
  colore = stato in una sola tinta (`--net-acq/-tratt/-cont/-rub`, chiaro e scuro; nuovi tratteggiati), linee
  spesse = forza, tratteggiate = a mano; etichette per i punti grandi o ingrandendo; finestrella al passaggio.
  Clic su un punto della mappa (2026-10-21): il primo tocco apre il punto nella Rete (nome e sua rete), un secondo
  tocco sullo stesso punto (`reteFocus`) chiama `netOpen` (anagrafica con riquadro Collaborazioni, o portale).
  Nel test del telefono la pagina 'rete' sta in fondo: con --shots, prima della Mappa falsava le tessere Leaflet.
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
  indirizzo con "Vedi su Maps", telefono, progetto e note) senza uscire dal modulo. Trascinamento (pointer
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
- **Cosa fare in zona** (riquadro in Oggi, blocco omonimo, stato `zone`): un GIRO ottimizzato (richiesta
  dell'utente 2026-10-12: non un elenco ma partenza -> tappa 1 -> tappa 2 con i tempi tra una e
  l'altra, su mappa). Origine = "Dove sono ora" (GPS, o `myPos` della Mappa negli ultimi 2 minuti), un
  impegno di oggi con posizione o una localita' cercata; raggio 5/10/20 km (linea d'aria); tappe 5/8/12
  (`zone.max`). Candidati (`zoneCandidates`): cantieri del portale seguiti e da valutare (criteri di
  "Da esaminare") e progetti in corso gia' posizionati; si tengono i piu' vicini in auto (OSRM table
  dalla partenza) piu' quelli aggiunti (`zone.included`) e meno i tolti (`zone.excluded`); ordine di
  visita su matrice OSRM tra tutte le tappe (`zoneOrder`: vicino piu' prossimo + 2-opt, percorso
  aperto); tracciato da OSRM route (geojson). Per tappa: minuti e km dalla precedente, "Vedi
  itinerario" (Google Maps dalla tappa precedente), "Sulla mappa" (`mapFocus`), "Togli dal giro";
  sotto "Altri cantieri nel raggio" con "Aggiungi al giro"; totale di guida e "Apri il giro in Google
  Maps" (fino a 9 tappe intermedie). Mappa Leaflet `#zoneMap` (`mountZoneMap`, ricreata a ogni
  ridisegno, linea blu e tappe numerate). Senza OSRM: linea d'aria. `zoneRefresh` toglie il fuoco dal
  campo di ricerca (in Oggi `canAutoRender` non ridisegna mentre  si scrive). **La mia posizione sulla Mappa** (blocco omonimo): `watchPosition` mentre la Mappa e'
  aperta (`startMyPosition`/`stopMyPosition`), puntino blu pulsante con cerchio di precisione e
  freccia della direzione quando ci si muove; pulsante "La mia posizione".
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
- **Articoli venduti** (blocco omonimo, 2026-10-14): `parseOrderLines` legge le righe della conferma d'ordine (dopo
  "Pos. Codice articolo": riga "pos codice", descrizione su piu' righe, riga con qta, U.m., prezzo, totale; fino a
  "Totale merce") -> `ordini[].righe` [{codice, descrizione, qta, um, prezzo, totale}], salvate con "Salva ordine".
  `articleCategory` ("Isokorb XT tipo K" dalla sigla), `articleMeters` (1 m a pezzo, scelta dell'utente; -L500- =
  0,5 m; U.m. M/ML = metri). Riquadro "Articoli venduti" in Dashboard -> Progetti (periodo della pagina): metri,
  pezzi, valore per categoria e serie; gli ordini senza righe si completano rileggendo il PDF (stesso numero = aggiorna).
  **Bole** (2026-10-15): kg di ferro invece dei metri. `boleGeometry` dalla sigla (BOLE O/U|U|F d-h-n/L, anche "/A 720";
  HDB/PSB-d/h-n/L; JDA-n/d/h-L); `boleElementKg` = n x (gambo pi d²/4 x h + 2 teste di diametro 3d e spessore 0,5d) x
  7850 + listello 0,444 kg/m x L (Bole F: listello in plastica 0). Ipotesi modificabili nel riquadro (`settings.pesoBole`,
  `BOLE_DEF`); verificato con i conti dell'utente (BOLE O/U 12-330-2/450 = 0,978 kg).
  **Dettaglio e prezzi** (2026-10-15): ogni categoria e' un `<details>` (`soldOpen` ricorda le aperte) con le varianti
  (`articleVariant`: classe M1...M14 per gli Isokorb, le altezze no, scelta dell'utente; geometria per le Bole;
  ordinate con `variantOrder`): pezzi, metri/kg, valore, prezzo medio = valore/pezzi (e €/kg per le Bole), min-max
  del prezzo unitario; sotto "Prezzi per ordine" (ultime 40 righe, data, progetto, variante, prezzo netto).
  Le Bole (e HDB/PSB/JDA) sono raccolte in un gruppo per famiglia (`groupHtml`, chiave `gruppo:<famiglia>` in
  `soldOpen`) con totali, kg e prezzo medio; dentro le categorie per diametro.
  Isokorb tipo S e SK (`ISOKORB_PUNTUALI`, `articleUnit` = 'pz'): elementi puntuali, contati a pezzi e fuori dai
  "Metri lineari" e dai metri delle serie; riquadro "Isokorb S / SK" in pezzi. La sigla "Isokorb T_S-N-R0-D16-2.0"
  (tipo dopo il trattino basso) e' riconosciuta; variante = resto della sigla senza altezze. Riquadri per ogni serie.
  Tronsole (`articleUnit` = 'none', scelta dell'utente 2026-10-15): solo nel valore merce, niente metri, riquadri o
  dettaglio; una riga di nota con il loro importo.
- **Report del periodo** (Dashboard -> "Report", blocco "Report del periodo", 2026-10-14): periodo (questa
  settimana, scorsa, mese, mese scorso, date a scelta; `rep`, `repSetPeriod`); attivita' (telefonate, clienti
  raggiunti, appuntamenti fissati, incontri, sopralluoghi, mail; richieste/offerte/conferme/perse con `projEvents`);
  note salienti di telefonate e incontri divise in Trattative aperte / Commesse acquisite / Altri contatti
  (`repActProject`: progetti indicati o unica commessa del cliente), ognuna da includere o no e modificabile;
  venduto dell'anno (scelta dell'utente: ENTRAMBI conferme d'ordine e fatturato/ordinato) rispetto a `budgetOf`,
  % e proiezione sui 12 mesi (valore / frazione d'anno trascorsa); cicli aperti, offerte fuori, commesse con
  chiusura prevista entro 2 mesi dopo la fine del periodo (anche superate); commento. Bozza in localStorage
  `reportBozza`. "Salva PDF": html2pdf A4 verticale (`reportPdfHtml`, classi `.wr-*` sempre chiare) -> Storage
  `users/<uid>/report/<id>.pdf` + collection `report` {titolo, dal, al, creatoIl, path, size, commento} (nei backup).
  Nelle liste "Offerte fuori" e "In chiusura entro" (a video e nel PDF) ogni commessa ha la riga `repProjInfo`: indirizzo,
  figure (studio o nome, con il ruolo, max 3) e fase attuale (2026-10-30: codice e nome non bastavano a riconoscerla).
  Sopra "In chiusura entro" i totali (`repClosingTot`: commesse, offerte, ponderato) e, se i mesi sono piu' di uno, il
  totale per mese di chiusura prevista (le superate a parte).
  Condividi: Web Share con il file appena creato, altrimenti link (getDownloadURL) via share o appunti. In Oggi
  venerdi'-domenica il promemoria `reportReminderHtml` se la settimana non ha un report salvato.
- **Cestino di foto e documenti** (blocco omonimo, 2026-10-14): eliminare sposta la voce in `projects.cestino`
  [{tipo:'foto'|'allegato', dati, eliminatoIl}] senza cancellare il file; "Ripristina" nella scheda progetto
  (riquadro Cestino) per `TRASH_DAYS` (30) giorni; poi `purgeTrash` (una volta per sessione) cancella i file.
- **Nessun ridisegno mentre si scrive** (2026-10-14): `canAutoRender` blocca i ridisegni automatici in tutte le
  pagine quando il fuoco e' in un campo di testo/elenco di #main (prima solo Forecast, portale, Oggi).
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
  **File nelle fasi** (blocco "File nelle fasi del progetto e attese da Michael / Claudia"): sulle fasi
  `PHASE_FILES` (elaborati, propostaTecnica, offertaEconomica) della timeline "Allega file"
  (`data-phase-attach="pid|fase"`) o trascinamento sulla fase (`data-phase-drop`) carica nei Documenti
  con `tag` = chiave della fase (`attachToPhase`) e, se la fase e' vuota, la segna con oggi; i file
  compaiono sotto la fase e nei Documenti con il nome della fase. Esito nella barra in alto (showNotice).
  Alla fine aspetta che l'aggiornamento in tempo reale porti file e fase prima di ridisegnare
  (prima la timeline poteva restare quella vecchia: emerso da un test intermittente).
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
  `geo.manual` (vale per Mappa, mappa incorporata e "Vedi su Maps" via `manualGeo` in `mapsUrl`/
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
- **Indirizzi su Maps** (2026-10-22): `mapsUrl` apre la POSIZIONE su Google Maps (`maps/search/?api=1&query=`), non le
  indicazioni (scelta dell'utente: esplora la mappa e chiede il percorso da Maps); etichette "Vedi su Maps" / "Su Maps".
  Solo il giro di "Cosa fare in zona" apre ancora il percorso (`maps/dir`).
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
  sigla della provincia; `portalFilters.regione`), che restringe anche l'elenco delle province. "Ordina per" (`portalFilters.ordine`):
  priorita' (predefinito) o importo materiale stimato (`vol`, decrescente, senza unita' in fondo). Descrizione salvata fino a 4000 caratteri (600 nelle importazioni prima del
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
