import { getTeamData } from './team.js';
import { getLeagueOpponents } from './league.js';

// ─── Match engine ─────────────────────────────────────────────────────────────

function simulateMatch(teamPower, opponentPower) {
  const diff = teamPower - opponentPower;
  const roll = Math.random();

  if (diff > 150) return 'win';
  if (diff < -150) return 'loss';
  if (diff > 50)  return roll < 0.70 ? 'win' : 'draw';
  if (diff < -50) return roll < 0.30 ? 'win' : 'loss';
  // Even match
  if (roll < 0.33) return 'win';
  if (roll < 0.67) return 'draw';
  return 'loss';
}

// ─── Mood ─────────────────────────────────────────────────────────────────────

function updateMood(mood, currentPos, expectedPos) {
  if (currentPos <= expectedPos - 2) return Math.min(mood + 1, 10);
  if (currentPos >= expectedPos + 2) return Math.max(mood - 1, 1);
  return mood;
}

// ─── Attendance ───────────────────────────────────────────────────────────────

function calcAttendance(fans, mood, position, matchesPerSeason, capacity) {
  const base       = Math.floor(Math.random() * 6) + 20; // 20–25 inclusive
  const moodFactor = 0.8 + mood * 0.04;
  const posFactor  = 1 + (8 - position) * 0.02;
  // Division by 1000 scales down "fans × base" to a plausible match attendance.
  // Calibrate this factor once real CHPP data is available.
  const raw = fans * base / 1000 * moodFactor * posFactor * matchesPerSeason;
  return Math.floor(Math.min(raw, capacity));
}

// ─── Revenue ─────────────────────────────────────────────────────────────────

function calcRevenue(attendance, mix, prices) {
  const weightedPrice =
    mix.terraces * prices.terraces +
    mix.basic    * prices.basic    +
    mix.roofed   * prices.roofed   +
    mix.vip      * prices.vip;
  return Math.round(attendance * weightedPrice);
}

// ─── Fan growth ───────────────────────────────────────────────────────────────

function updateFans(fans, currentPos, expectedPos, division) {
  const diff       = expectedPos - currentPos; // positive = better than expected
  const growth     = diff * 0.01;
  const divisionCap = 50000 / division;
  const saturation  = 1 - fans / divisionCap;
  return Math.max(Math.round(fans + fans * growth * saturation), 1);
}

// ─── Seat mix ─────────────────────────────────────────────────────────────────

function calcMix(capacity) {
  const total = capacity.terraces + capacity.basic + capacity.roofed + capacity.vip;
  if (total === 0) return { terraces: 0.5, basic: 0.3, roofed: 0.15, vip: 0.05 };
  return {
    terraces: capacity.terraces / total,
    basic:    capacity.basic    / total,
    roofed:   capacity.roofed   / total,
    vip:      capacity.vip      / total,
  };
}

// ─── Default prices (same as stadium analysis recommendedSeats ticketPrice) ──

const DEFAULT_PRICES = { terraces: 7, basic: 10, roofed: 19, vip: 35 };

// ─── Main simulation ─────────────────────────────────────────────────────────

export async function simulateSeason({
  accessToken,
  accessTokenSecret,
  teamId,
  leagueId,
  params,
}) {
  const { fanMood = 6, matchesPerSeason = 8, expectation = 2, prices } = params;

  // Fetch team + league data (both are cached)
  const [teamData, leagueData] = await Promise.all([
    getTeamData({ accessToken, accessTokenSecret, teamId }),
    getLeagueOpponents({ accessToken, accessTokenSecret, leagueId, teamId }),
  ]);

  const { fans: initialFans, arena, teamPower, division } = teamData;
  const mix           = calcMix(arena.capacity);
  const resolvedPrices = prices ?? DEFAULT_PRICES;
  const expectedPos   = 9 - expectation;

  // Table: index 0 = user, indices 1–7 = rivals (same order as leagueData.teams)
  const points = new Array(leagueData.teams.length + 1).fill(0);

  let currentFans = initialFans;
  let currentMood = fanMood;

  const matches     = [];
  let totalRevenue  = 0;
  let totalAttend   = 0;

  for (let i = 0; i < 14; i++) {
    const rivalIdx = i % 7;
    const rival    = leagueData.teams[rivalIdx];

    const result   = simulateMatch(teamPower, rival.power);

    // Update user points
    points[0] += result === 'win' ? 3 : result === 'draw' ? 1 : 0;

    // Update rival points from this match
    points[rivalIdx + 1] += result === 'loss' ? 3 : result === 'draw' ? 1 : 0;

    // All other rivals get 1.5 pts/match (rival-vs-rival simplified)
    for (let j = 1; j < points.length; j++) {
      if (j !== rivalIdx + 1) points[j] += 1.5;
    }

    // User position in table (1 = first)
    const userPts      = points[0];
    const sorted       = [...points].sort((a, b) => b - a);
    const position     = sorted.indexOf(userPts) + 1;

    currentMood = updateMood(currentMood, position, expectedPos);

    const attendance = calcAttendance(currentFans, currentMood, position, matchesPerSeason, arena.totalCapacity);
    const revenue    = calcRevenue(attendance, mix, resolvedPrices);
    currentFans      = updateFans(currentFans, position, expectedPos, division);

    totalRevenue += revenue;
    totalAttend  += attendance;

    matches.push({
      match:      i + 1,
      opponent:   rival.power,
      result,
      position,
      mood:       currentMood,
      attendance,
      revenue,
      fans:       currentFans,
    });
  }

  return {
    inputs: {
      fans:             initialFans,
      capacity:         arena.totalCapacity,
      teamPower,
      division,
      leagueTeams:      leagueData.teams.map(t => t.power),
      fanMood,
      matchesPerSeason,
      expectation,
      prices:           resolvedPrices,
      mix,
    },
    result: {
      finalFans:     currentFans,
      totalRevenue:  Math.round(totalRevenue),
      avgAttendance: Math.round(totalAttend / 14),
      occupancy:     parseFloat((totalAttend / (14 * arena.totalCapacity)).toFixed(3)),
      matches,
    },
    meta: {
      modelVersion: '1.0.0',
      generatedAt:  new Date().toISOString(),
    },
  };
}
