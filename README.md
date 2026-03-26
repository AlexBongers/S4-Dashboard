# S4-Dashboard

Een studentvoortgang dashboard voor HBO-docenten, gekoppeld aan de Canvas leeromgeving.

## Functies

- **Overzichtstabel**: Alle studenten in één oogopslag met status, inleverstatus en cijfer
- **Statusoordeel per student**: *Loopt voor* 🚀 / *Op schema* ✅ / *Let op* ⚠️ / *Achterloopt* 🔴
- **Detailweergave**: Klik op een student voor een compleet opdrachtenlogboek
- **Filteren & sorteren**: Op naam, status, cijfer of inleverpercentage
- **Live data**: Realtime ophalen uit Canvas via de API

---

## 🚀 Deployen op Render.com

### Optie A — Automatisch via Blueprint (aanbevolen)

1. **Fork / push** deze repository naar jouw GitHub-account
2. Ga naar <https://dashboard.render.com> → **New** → **Blueprint**
3. Selecteer jouw repository — Render detecteert `render.yaml` automatisch
4. Render vraagt je de drie geheime omgevingsvariabelen in te vullen:

   | Variabele | Waarde |
   |-----------|--------|
   | `CANVAS_API_TOKEN` | Jouw Canvas API-token (zie hieronder) |
   | `CANVAS_BASE_URL` | bv. `https://canvas.hu.nl` |
   | `CANVAS_COURSE_ID` | bv. `50289` |

5. Klik **Apply** → Render bouwt en start de app automatisch
6. Jouw dashboard is bereikbaar op `https://<naam>.onrender.com`

### Optie B — Handmatig als Web Service

1. Ga naar <https://dashboard.render.com> → **New** → **Web Service**
2. Verbind jouw GitHub-repository
3. Instellingen:
   - **Runtime**: Node
   - **Build Command**: `npm ci --omit=dev`
   - **Start Command**: `npm start`
4. Voeg onder **Environment** de drie variabelen toe (zie tabel hierboven)
5. Klik **Create Web Service**

> **Canvas API-token aanmaken**: Canvas → Account → Instellingen → scroll naar beneden → **Nieuw toegangstoken**  
> **Let op**: Zet `CANVAS_BASE_URL` op de basis-URL zonder `/courses/...`,  
> bijv. `https://canvas.hu.nl` (niet `https://canvas.hu.nl/courses/50289`).

---

## Lokaal draaien

### Vereisten

- Node.js ≥ 18

### Installatie

```bash
npm install
```

### Configuratie

Kopieer het voorbeeld-bestand en vul jouw gegevens in:

```bash
cp canvas.env.example canvas.env
# Bewerk canvas.env met jouw API-token, URL en cursus-ID
```

> `canvas.env` staat in `.gitignore` en wordt **nooit** meegecommit.

### Starten

```bash
npm start
```

Open vervolgens [http://localhost:3000](http://localhost:3000) in de browser.

---

## Hoe werkt het statusoordeel?

| Status | Criteria |
|--------|----------|
| 🚀 Loopt voor | ≥90% ingeleverd én cijfer ≥85% |
| ✅ Op schema | ≥90% van verlopen opdrachten ingeleverd |
| ⚠️ Let op | 70-89% ingeleverd |
| 🔴 Achterloopt | <70% ingeleverd |
