import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getTeamData } from '../services/team.js';

const router = Router();
router.use(requireAuth);

// ─── GET /api/team ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { user } = req;
  try {
    const data = await getTeamData({
      accessToken:       user.accessToken,
      accessTokenSecret: user.accessTokenSecret,
      teamId:            user.teamId,
    });
    res.json({
      ok: true,
      data: {
        teamId:    data.teamId,
        teamName:  data.teamName,
        leagueId:  data.leagueId,
        division:  data.division,
        teamPower: data.teamPower,
      },
    });
  } catch (err) {
    console.error('[team]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
