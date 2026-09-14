# 🚆 Treno App

App che cerca treni **Roma Tiburtina ⇄ Ponte Di Nona** con dati **real-time**
da **viaggiatreno.it** (ritardi, binari, stato treno aggiornati in tempo reale).

Tre modi per usarla:

| Modalità | Serve il PC acceso? | Setup |
|----------|--------------------|-------|
| 📦 **APK Android** (consigliata) | ❌ No | Build automatica su GitHub, installi l'APK |
| 📱 PWA via tunnel | ✅ Sì | cloudflared + server locale |
| 🖥️ PWA desktop | ✅ Sì | solo server locale |

## Fonte dati

L'app usa l'API pubblica **viaggiatreno.it** (no chiave, no CORS con il proxy):

- `GET /partenze/{stazione}/{data}` → partenze real-time (con ritardo, binario)
- `GET /arrivi/{stazione}/{data}` → arrivi real-time

L'app incrocia partenze e arrivi per numero treno per trovare i **treni diretti**
tra le due stazioni, con orario di partenza, arrivo, durata e ritardo.

Stazioni: `S08217` (Roma Tiburtina), `S08529` (Ponte Di Nona).

## 📁 File

| File | Scopo |
|------|-------|
| `index.html` | UI |
| `app.js` | Logica (data/ora, direzione, ricerca viaggiatreno, countdown, dettagli) |
| `styles.css` | Stile dark moderno |
| `manifest.webmanifest` | Manifest PWA |
| `service-worker.js` | Service worker (solo modalità web) |
| `local-proxy.mjs` | **Server unico**: app + proxy viaggiatreno su porta 8787 (Node) |
| `capacitor.config.json` | Config Capacitor per l'APK |
| `.github/workflows/build-apk.yml` | Compila l'APK su GitHub Actions (gratis) |

## 📦 APK Android (senza PC acceso — consigliata)

1. Push del repo su GitHub (il workflow parte al push)
2. GitHub → tab **Actions** → workflow **"Build APK"** → attendi (~5-8 min)
3. Scarica l'artifact **`treno-app-debug-apk`** → estrai il `.apk`
4. Installa sul telefono (consenti "app sconosciute")

L'APK chiama viaggiatreno direttamente via HTTP nativo (niente CORS, niente proxy).

## 🖥️ Desktop (immediato)

```powershell
cd "c:\Users\ccardillo\Desktop\Repo\APP TRENO"
node local-proxy.mjs
```

Apri **http://localhost:8787** — un solo comando.

## 📱 PWA mobile via tunnel

```powershell
winget install Cloudflare.cloudflared
node local-proxy.mjs                                  # finestra 1
cloudflared tunnel --url http://localhost:8787        # finestra 2
```

Dal telefono apri l'URL `https://xxx.trycloudflare.com` → ⋮ → "Installa app".

## ⚙️ Limiti

- Mostra solo treni **regionali** (REG) diretti tra le due stazioni.
- Il **countdown gira solo con l'app aperta** (si ricalcola alla riapertura).
- Modalità web (tunnel/desktop): il PC deve restare acceso con il server attivo.

## ✅ Test effettuati

- Proxy viaggiatreno → partenze/arrivi **200 OK**
- Incrocio dati → **4 treni diretti** trovati con partenza, arrivo, durata, ritardo, binario
- APK → build **success** su GitHub Actions
