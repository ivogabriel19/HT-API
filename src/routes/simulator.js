import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { simulateSeason } from '../services/simulator.js';

const router = Router();
router.use(requireAuth);

// ─── POST /api/simulator/season ───────────────────────────────────────────────
router.post('/season', async (req, res) => {
  const { user } = req;
  const { fanMood, matchesPerSeason, expectation, prices } = req.body ?? {};

  // Validate optional params
  if (fanMood !== undefined) {
    const v = parseInt(fanMood, 10);
    if (isNaN(v) || v < 1 || v > 10)
      return res.status(400).json({ ok: false, error: 'fanMood must be an integer between 1 and 10' });
  }
  if (matchesPerSeason !== undefined) {
    const v = parseInt(matchesPerSeason, 10);
    if (isNaN(v) || v < 7 || v > 14)
      return res.status(400).json({ ok: false, error: 'matchesPerSeason must be an integer between 7 and 14' });
  }
  if (expectation !== undefined) {
    const v = parseInt(expectation, 10);
    if (isNaN(v) || v < 1 || v > 8)
      return res.status(400).json({ ok: false, error: 'expectation must be an integer between 1 and 8' });
  }

  try {
    const result = await simulateSeason({
      accessToken:       user.accessToken,
      accessTokenSecret: user.accessTokenSecret,
      teamId:            user.teamId,
      leagueId:          user.leagueId,
      params: {
        fanMood:          fanMood !== undefined ? parseInt(fanMood, 10) : 6,
        matchesPerSeason: matchesPerSeason !== undefined ? parseInt(matchesPerSeason, 10) : 8,
        expectation:      expectation !== undefined ? parseInt(expectation, 10) : 2,
        prices,
      },
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('[simulator/season]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
