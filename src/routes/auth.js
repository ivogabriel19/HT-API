import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getRequestToken, buildAuthorizeUrl, getAccessToken, chppRequest } from '../services/chpp.js';
import { config } from '../config/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ─── GET /auth/login ──────────────────────────────────────────────────────────
// Step 1: Get a request token and redirect the user to Hattrick to authorize.
// The oauthTokenSecret is stored in a short-lived HttpOnly cookie so it survives
// hot-reload and multi-instance deployments without requiring Redis.
router.get('/login', async (req, res) => {
  try {
    const { oauthToken, oauthTokenSecret } = await getRequestToken();

    res.cookie('htlab_oauth_secret', oauthTokenSecret, {
      httpOnly: true,
      secure:   !config.isDev,
      sameSite: 'lax',
      maxAge:   10 * 60 * 1000, // 10 minutes — enough for the OAuth dance
    });

    const authorizeUrl = buildAuthorizeUrl(oauthToken);
    res.redirect(authorizeUrl);
  } catch (err) {
    console.error('[auth/login]', err.message);
    res.redirect(`${config.frontendUrl}/auth/error?reason=request_token_failed`);
  }
});

// ─── GET /auth/callback ───────────────────────────────────────────────────────
// Step 2: Hattrick redirects here after the user authorizes (or denies) access.
router.get('/callback', async (req, res) => {
  const { oauth_token, oauth_verifier } = req.query;

  if (!oauth_token || !oauth_verifier) {
    return res.redirect(`${config.frontendUrl}/auth/error?reason=missing_params`);
  }

  const oauthTokenSecret = req.cookies?.htlab_oauth_secret;

  if (!oauthTokenSecret) {
    return res.redirect(`${config.frontendUrl}/auth/error?reason=unknown_token`);
  }

  try {
    // Step 3: Exchange the verifier for a permanent access token
    const { accessToken, accessTokenSecret } = await getAccessToken(
      oauth_token,
      oauthTokenSecret,
      oauth_verifier,
    );

    res.clearCookie('htlab_oauth_secret');

    // Fetch basic user identity from CHPP using the fresh tokens
    const data = await chppRequest(accessToken, accessTokenSecret, { file: 'teamdetails', version: '3.6' });
    const team = data?.HattrickData?.Teams?.Team;

    if (!team) throw new Error('Could not read team from CHPP teamdetails');

    const userId = String(data?.HattrickData?.User?.UserID ?? team.TeamID);

    // leagueId = the series/division ID (LeagueLevelUnitID), used for leaguedetails calls
    const payload = {
      userId,
      teamId:            String(team.TeamID),
      teamName:          team.TeamName,
      leagueId:          String(team.LeagueLevelUnit?.LeagueLevelUnitID ?? ''),
      accessToken,
      accessTokenSecret,
    };

    const jwtToken = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

    // Set as HttpOnly cookie — never exposed to JS in the browser
    res.cookie('htlab_session', jwtToken, {
      httpOnly: true,
      secure:   !config.isDev,
      sameSite: config.isDev ? 'lax' : 'strict',
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
    });

    res.redirect(`${config.frontendUrl}/dashboard`);
  } catch (err) {
    console.error('[auth/callback]', err.message);
    res.redirect(`${config.frontendUrl}/auth/error?reason=access_token_failed`);
  }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
// Returns the currently authenticated user's basic info.
router.get('/me', requireAuth, (req, res) => {
  res.json({
    userId:   req.user.userId,
    teamId:   req.user.teamId,
    teamName: req.user.teamName,
    leagueId: req.user.leagueId,
  });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('htlab_session');
  res.json({ ok: true });
});

export default router;
