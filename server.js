'use strict';

require('dotenv').config({ path: 'canvas.env', quiet: true });

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const CanvasClient = require('./src/canvas');
const apiRouter = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Validate required environment variables
const { CANVAS_API_TOKEN, CANVAS_BASE_URL, CANVAS_COURSE_ID } = process.env;
if (!CANVAS_API_TOKEN || !CANVAS_BASE_URL || !CANVAS_COURSE_ID) {
  console.error(
    'Fout: CANVAS_API_TOKEN, CANVAS_BASE_URL en CANVAS_COURSE_ID moeten ingesteld zijn in canvas.env'
  );
  process.exit(1);
}

// Initialize Canvas client and attach to app locals
app.locals.canvas = new CanvasClient({
  apiToken: CANVAS_API_TOKEN,
  baseUrl: CANVAS_BASE_URL,
  courseId: CANVAS_COURSE_ID,
});

// Rate limiting: API routes make external Canvas calls so limit to 60 req/min
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel verzoeken, probeer het over een minuut opnieuw.' },
});

// General limiter for all other routes (incl. static SPA fallback)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// HTTP Basic Auth middleware — password set via DASHBOARD_PASSWORD env var
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'Hoedoenzehetallemaal111';
if (!process.env.DASHBOARD_PASSWORD) {
  console.warn('Waarschuwing: DASHBOARD_PASSWORD is niet ingesteld. Gebruik het standaardwachtwoord (zie canvas.env.example).');
}
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    const password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
    if (password === DASHBOARD_PASSWORD) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="S4 Student Dashboard", charset="UTF-8"');
  res.status(401).send('Voer het dashboardwachtwoord in om toegang te krijgen.');
}

app.use(express.json());
app.use(generalLimiter);
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiLimiter, apiRouter);

// Serve frontend for all other routes (SPA fallback)
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`S4 Dashboard draait op http://localhost:${PORT}`);
  console.log(`Canvas cursus ID: ${CANVAS_COURSE_ID}`);
});

module.exports = app;
