import { chppRequest } from './chpp.js';
import { cache } from '../utils/cache.js';

const LEAGUE_CACHE_TTL = 24 * 60 * 60; // 24 hours

async function fetchRivalPower(accessToken, accessTokenSecret, teamId) {
  try {
    const data = await chppRequest(accessToken, accessTokenSecret, {
      file:    'teamdetails',
      version: '3.6',
      teamID:  teamId,
    });
    const team = data?.HattrickData?.Teams?.Team;
    return parseInt(team?.PowerRating?.PowerRating ?? 0);
  } catch (err) {
    console.error(`[league] failed to fetch power for team ${teamId}:`, err.message);
    return 0;
  }
}

export async function getLeagueOpponents({ accessToken, accessTokenSecret, leagueId, teamId }) {
  const leagueData = await chppRequest(accessToken, accessTokenSecret, {
    file:         'leaguedetails',
    version:      '1.7',
    leagueLeveID: leagueId,
  });

  const league = leagueData?.HattrickData?.League;
  if (!league) throw new Error('CHPP returned no league data');

  const season  = String(league.Season ?? '');
  const cacheKey = `league:${leagueId}:${season}`;
  const cached   = cache.get(cacheKey);
  if (cached) return cached;

  const rawTeams = league.Teams?.Team ?? [];
  const allTeams = Array.isArray(rawTeams) ? rawTeams : [rawTeams];

  // Filter out the user's own team
  const rivals = allTeams.filter(t => String(t.TeamID) !== String(teamId));

  // Fetch player power for each rival in parallel
  const teamsWithPower = await Promise.all(
    rivals.map(async t => ({
      teamId:   String(t.TeamID),
      teamName: t.TeamName,
      power:    await fetchRivalPower(accessToken, accessTokenSecret, t.TeamID),
    }))
  );

  const result = {
    leagueId: String(leagueId),
    season,
    teams: teamsWithPower,
  };

  cache.set(cacheKey, result, LEAGUE_CACHE_TTL);
  return result;
}
