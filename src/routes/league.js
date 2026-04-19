import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getLeagueOpponents } from '../services/league.js';

const router = Router();
router.use(requireAuth);

// ─── GET /api/league/opponents ────────────────────────────────────────────────
router.get('/opponents', async (req, res) => {
  const { user } = req;
  try {
    const data = await getLeagueOpponents({
      accessToken:       user.accessToken,
      accessTokenSecret: user.accessTokenSecret,
      leagueId:          user.leagueId,
      teamId:            user.teamId,
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[league/opponents]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
