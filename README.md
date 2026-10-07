# Codekart

Un kart racer pseudo-3D dentro VS Code: 4 piste, rampe, superfici scivolose, gemme turbo, malus e suoni. Puoi correre da solo contro 4 piloti CPU oppure sfidare fino a 7 colleghi sulla stessa rete.

## Le piste

Nel menu (o nella lobby, se ospiti una gara in LAN) scegli la pista con ← →.

| Pista | Com'è |
|---|---|
| Valle dei Commit | Colline verdi e curve morbide, tre rampe: la più adatta per iniziare |
| Deserto del Deploy | Dune altissime e cinque rampe per salti lunghi |
| Ghiacciaio Legacy | Tutto l'asfalto è ghiacciato: il kart risponde in ritardo e i tornanti sono stretti |
| Notte del Debug | Al buio, con curve strette e molte più cacche sull'asfalto |

In gara, la minimappa in alto a destra mostra la forma della pista e la posizione di tutti i kart.

## Cosa trovi sull'asfalto

- **Gemme gialle**: aggiungono un turbo, ne tieni al massimo 3. Si usa con Spazio.
- **Cacche**: ti rallentano e invertono i colori dello schermo per 5 secondi. Le CPU cercano di evitarle.
- **Rampe a strisce gialle e nere**: ti fanno saltare, più veloce vai più lontano arrivi. Premi Shift mentre sei in volo per fare un trick: se atterri dopo un trick ottieni una spinta.
- **Chiazze d'olio e lastre di ghiaccio**: fanno sbandare il kart per un attimo.

## Suoni

Motore, derapate, salti, turbo, gemme, cacche, giri e arrivo hanno tutti un suono, generato al momento senza file audio. Premi **M** per spegnere o riaccendere l'audio. L'audio si zittisce da solo quando la scheda del gioco non è visibile.

## Il pannello Codekart

Dopo l'installazione compare l'icona del kart nella barra delle attività, a sinistra. Cliccala per aprire il pannello **Gare**, da cui fai tutto:

- **Il tuo nome da pilota**: è il nome che vedono gli altri.
- **Crea gara in LAN**: apre la gara e mostra il codice invito. Clicca il codice o "Copia invito" per copiare un messaggio pronto da mandare su Slack o Teams, con un link che apre VS Code ed entra direttamente in gara.
- **Gioca da solo**: una gara contro le CPU.
- **Entra con un codice**: incolla il codice ricevuto. Se incolli un codice completo, entri subito.
- **Colleghi in rete**: elenca chi ha Codekart aperto sulla tua stessa rete.
  - "Entra" ti porta nelle gare che altri stanno ospitando.
  - "Invita" manda un invito a un collega: se non hai ancora una gara aperta, la crea per te. Al collega arriva una notifica con il pulsante "Entra".
- **Fatti trovare dai colleghi**: se togli la spunta, il tuo nome non viene più annunciato in rete. Puoi comunque vedere gli altri ed entrare con un codice.

Chiudere la scheda del gioco chiude anche la gara (o ti fa uscire, se non sei l'host).

## Requisiti di rete

- Dovete essere sulla stessa rete: stessa Wi-Fi o stessa rete aziendale.
- La prima volta, Windows o macOS possono chiedere di consentire le connessioni in entrata a VS Code: accetta.
- Porte usate: UDP 47819 per trovare i colleghi; per la gara TCP 47820–47829, oppure una porta libera scelta dal sistema se quelle sono occupate o riservate (succede su Windows con Hyper-V, WSL o Docker).
- Alcune reti, come le Wi-Fi ospiti o le reti con isolamento dei client, impediscono ai computer di vedersi. Lì non funzionano né la ricerca né le gare.

## Comandi di gioco

| Tasto | Azione |
|---|---|
| ↑ / W | Accelera |
| ↓ / S | Frena |
| ← → / A D | Sterza |
| Shift | Derapata: tienila in curva, rilasciala per la spinta. In volo: trick |
| Spazio | Usa una cella turbo (massimo 3) |
| C | Copia l'invito (lobby e risultati in LAN) |
| P | Pausa (solo in partita singola) |
| M | Audio acceso o spento |
| ← → nel menu | Cambia pista |

## Installazione

Estensioni → menu `…` → **Installa da VSIX…** → `codekart-0.4.0.vsix`. Tutti i giocatori devono installarla.
