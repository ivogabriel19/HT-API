import { chppRequest } from './chpp.js';
import { cache } from '../utils/cache.js';

const TEAM_CACHE_TTL = 60 * 60; // 1 hour

export async function getTeamData({ accessToken, accessTokenSecret, teamId }) {
  const cacheKey = `team:${teamId}`;
  const cached   = cache.get(cacheKey);
  if (cached) return cached;

  // teamdetails → identity, PowerRating, fans, ArenaID
  // arenadetails → capacity breakdown
  const [detailsData, arenaData] = await Promise.all([
    chppRequest(accessToken, accessTokenSecret, {
      file:    'teamdetails',
      version: '3.6',
      teamID:  teamId,
    }),
    chppRequest(accessToken, accessTokenSecret, {
      file:    'arenadetails',
      version: '1.8',
      teamID:  teamId,
    }),
  ]);

  const team  = detailsData?.HattrickData?.Teams?.Team;
  if (!team) throw new Error('CHPP returned no team data');

  const cap = arenaData?.HattrickData?.Arena?.Capacity?.CurrentCapacity ?? {};
  const capacity = {
    terraces: parseInt(cap.Terraces       ?? 0),
    basic:    parseInt(cap.BasicSeats     ?? 0),
    roofed:   parseInt(cap.SeatsUnderRoof ?? 0),
    vip:      parseInt(cap.VIPSeats       ?? 0),
  };

  const result = {
    teamId:    String(team.TeamID),
    teamName:  team.TeamName,
    leagueId:  String(team.LeagueLevelUnit?.LeagueLevelUnitID ?? ''),
    division:  parseInt(team.LeagueLevelUnit?.LeagueLevel ?? 0),
    teamPower: parseInt(team.PowerRating?.PowerRating ?? 0),
    fans:      parseInt(team.Fanclub?.FanclubSize ?? 0),
    arena: {
      capacity,
      totalCapacity: Object.values(capacity).reduce((s, n) => s + n, 0),
    },
  };

  cache.set(cacheKey, result, TEAM_CACHE_TTL);
  return result;
}
