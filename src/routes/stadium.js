import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getStadiumAnalysis } from '../services/stadium.js';

const router = Router();

// All stadium routes require authentication
router.use(requireAuth);

// ─── GET /api/stadium/analysis ────────────────────────────────────────────────
// Returns the full stadium analysis for the authenticated user's team.
//
// Query params (optional — the frontend can pass these or let the user set them):
//   fanMood        (1–10, default 6)
//   matchesPerSeason (7–14, default 8)
//
// Fan count is read directly from CHPP teamdetails (no override needed).
router.get('/analysis', async (req, res) => {
  const { user } = req;

  const fanMood = Math.min(10, Math.max(1, parseInt(req.query.fanMood ?? '6', 10)));
  const matchesPerSeason = Math.min(14, Math.max(7, parseInt(req.query.matchesPerSeason ?? '8', 10)));

  try {
    // Fan count comes from teamdetails — fetch it fresh if not cached
    const teamData = await import('../services/chpp.js').then(m =>
      m.chppRequest(user.accessToken, user.accessTokenSecret, {
        file:    'teamdetails',
        version: '3.6',
        teamID:  user.teamId,
      })
    );

    const fanCount = parseInt(teamData?.HattrickData?.Teams?.Team?.Fanclub?.FanclubSize ?? '0', 10);

    const analysis = await getStadiumAnalysis({
      accessToken:       user.accessToken,
      accessTokenSecret: user.accessTokenSecret,
      teamId:            user.teamId,
      fanCount,
      fanMood,
      matchesPerSeason,
    });

    res.json({ ok: true, data: analysis });
  } catch (err) {
    console.error('[stadium/analysis]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
