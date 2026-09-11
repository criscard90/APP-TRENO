# 🚆 Treno App

App che cerca treni **Roma Tiburtina → Ponte Di Nona** sulla data/ora corrente
(arrotondata all'ora successiva) e mostra un **countdown realtime all'arrivo**
dei treni diretti. Tre modi per usarla, senza dipendenze reciproche:

| Modalità | Serve il PC acceso? | Setup |
|----------|--------------------|-------|
| 📦 **APK Android** (consigliata) | ❌ No | Build automatica su GitHub, installi l'APK |
| 📱 PWA via tunnel | ✅ Sì | cloudflared + server locale |
| 🖥️ PWA desktop | ✅ Sì | solo server locale |

> Nota API: lefrecce.it è protetta da Akamai che blocca gli IP datacenter
> (Cloudflare Workers → 403, testato). L'APK risolve tutto: chiamata **HTTP
> nativa** dal telefono → IP residenziale/mobile → nessun blocco, nessun CORS.

## 📁 File

| File | Scopo |
|------|-------|
| `index.html` | UI |
| `app.js` | Logica (data/ora auto, filtro treni diretti, countdown, dual-mode API) |
| `styles.css` | Stile dark moderno |
| `manifest.webmanifest` | Manifest PWA |
| `service-worker.js` | Service worker (solo per le modalità web) |
| `local-proxy.mjs` | Server unico web: app + API proxy su porta 8787 (Node) |
| `capacitor.config.json` | Config Capacitor per l'APK |
| `.github/workflows/build-apk.yml` | ⭐ Compila l'APK su GitHub Actions (gratis) |
| `worker.js` | Riferimento proxy Cloudflare (⚠️ bloccato da Akamai) |

## 📦 APK Android (senza PC acceso — consigliata)

1. Crea un repo su GitHub e pusha **tutta la cartella** (il file
   `.github/workflows/build-apk.yml` parte automaticamente al push)
2. GitHub → tab **Actions** → workflow **"Build APK"** → attendi (~5-8 min)
3. Apri il run → in basso scarica l'artifact **`treno-app-debug-apk`** →
   estrai il file `.apk`
4. Copia l'APK sul telefono e apri: consenti "Installa app sconosciute" →
   Installa
5. Fine: l'app è autonoma, chiama lefrecce.it direttamente via HTTP nativa
   (niente CORS, niente server, niente tunnel, funziona col PC spento)

> Rebuild dopo una modifica: fai push → Actions ricompila automaticamente
> (oppure Actions → "Build APK" → "Run workflow" a mano).

## 🖥️ Desktop (immediato)

```powershell
cd "c:\Users\ccardillo\Desktop\Repo\APP TRENO"
node local-proxy.mjs
```

Apri **http://localhost:8787** — app e API stessa origine.

## 📱 PWA mobile via tunnel

```powershell
winget install Cloudflare.cloudflared
node local-proxy.mjs                                  # finestra 1
cloudflared tunnel --url http://localhost:8787        # finestra 2
```

Dal telefono apri l'URL `https://xxx.trycloudflare.com` → ⋮ → "Installa app".
Il server serve app + API same-origin (zero CORS). Il tunnel quick cambia URL
a ogni riavvio; alternativa con dominio fisso gratuito: **ngrok** (l'app invia
già l'header `ngrok-skip-browser-warning`).

## ⚙️ Limiti

- Il **countdown gira solo con l'app aperta** (si ricalcola correttamente
  dall'ora corrente alla riapertura).
- Modalità web (tunnel/desktop): il PC deve restare acceso con il server attivo.

## ✅ Test effettuati

- POST residenziale → **200**, 10 soluzioni, treno diretto trovato
- Server unico end-to-end → GET statici **200**, preflight **204**, POST **200**
- Cloudflare Worker → **403 Akamai Access Denied** (bloccato, motivo per cui
  l'APK usa l'HTTP nativa)
