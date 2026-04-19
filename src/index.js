import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from './config/index.js';
import { optionalAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import stadiumRouter from './routes/stadium.js';
import teamRouter from './routes/team.js';
import leagueRouter from './routes/league.js';
import simulatorRouter from './routes/simulator.js';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin:      config.frontendUrl,
  credentials: true, // required to send/receive cookies cross-origin
}));

app.use(express.json());
app.use(cookieParser());

// Populate req.user on every request if a valid session cookie exists
//app.use(optionalAuth);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/auth',             authRouter);
app.use('/api/stadium',      stadiumRouter);
app.use('/api/team',         teamRouter);
app.use('/api/league',       leagueRouter);
app.use('/api/simulator',    simulatorRouter);

// Health check — useful for Railway/Render uptime monitors
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ ok: false, error: config.isDev ? err.message : 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`HT Lab API running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`CHPP callback: ${config.chpp.callbackUrl}`);
});
