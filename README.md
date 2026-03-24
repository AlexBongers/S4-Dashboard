# S4-Dashboard

Een studentvoortgang dashboard voor HBO-docenten, gekoppeld aan de Canvas leeromgeving.

## Functies

- **Overzichtstabel**: Alle studenten in één oogopslag met status, inleverstatus en cijfer
- **Statusoordeel per student**: *Loopt voor* 🚀 / *Op schema* ✅ / *Let op* ⚠️ / *Achterloopt* 🔴
- **Detailweergave**: Klik op een student voor een compleet opdrachtenlogboek
- **Filteren & sorteren**: Op naam, status, cijfer of inleverpercentage
- **Live data**: Realtime ophalen uit Canvas via de API

## Vereisten

- Node.js ≥ 18
- Een Canvas-omgeving met API-toegang

## Installatie

```bash
npm install
```

## Configuratie

Vul `canvas.env` in met jouw Canvas-gegevens:

```env
CANVAS_API_TOKEN=jouw_api_token
CANVAS_BASE_URL=https://canvas.hu.nl
CANVAS_COURSE_ID=50289
```

> **Canvas API token aanmaken**: Ga naar Canvas → Account → Instellingen → Nieuw toegangstoken

## Starten

```bash
npm start
```

Open vervolgens [http://localhost:3000](http://localhost:3000) in de browser.

## Hoe werkt het statusoordeel?

| Status | Criteria |
|--------|----------|
| 🚀 Loopt voor | ≥90% ingeleverd én cijfer ≥85% |
| ✅ Op schema | ≥90% van verlopen opdrachten ingeleverd |
| ⚠️ Let op | 70-89% ingeleverd |
| 🔴 Achterloopt | <70% ingeleverd |
