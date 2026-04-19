import { chppRequest } from './chpp.js';
import { cache } from '../utils/cache.js';
import { config } from '../config/index.js';

// ─── Seat type constants (confirmed community figures) ────────────────────────
const SEAT_TYPES = {
  terraces: { ticketPrice: 7,  maintenancePerSeat: 0.5, buildCostPerSeat: 45,  recommendedRatio: 0.62 },
  basic:    { ticketPrice: 10, maintenancePerSeat: 0.7, buildCostPerSeat: 75,  recommendedRatio: 0.20 },
  roofed:   { ticketPrice: 19, maintenancePerSeat: 1.0, buildCostPerSeat: 90,  recommendedRatio: 0.12 },
  vip:      { ticketPrice: 35, maintenancePerSeat: 2.5, buildCostPerSeat: 300, recommendedRatio: 0.06 },
};

const CONVERSION_FIXED_COST = 10000; // € per any expansion/reduction
const REMOVAL_COST_PER_SEAT = 6;     // € regardless of type

// ─── Fetch raw arena data from CHPP ──────────────────────────────────────────
async function fetchArenaFromChpp(accessToken, accessTokenSecret, teamId) {
  // teamdetails gives us identity + ArenaID; arenadetails gives us capacity breakdown
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
  const arena = arenaData?.HattrickData?.Arena;

  if (!team)  throw new Error('CHPP returned no team data');
  if (!arena) throw new Error('CHPP returned no arena data for this team');

  return { team, arena };
}

// ─── Normalize raw CHPP arena XML into our internal model ────────────────────
function normalizeArena(team, arena) {
  const cap = arena.Capacity?.CurrentCapacity ?? {};
  const capacity = {
    terraces: parseInt(cap.Terraces       ?? 0),
    basic:    parseInt(cap.BasicSeats     ?? 0),
    roofed:   parseInt(cap.SeatsUnderRoof ?? 0),
    vip:      parseInt(cap.VIPSeats       ?? 0),
  };

  const totalCapacity = Object.values(capacity).reduce((s, n) => s + n, 0);

  const weeklyMaintenance = Object.entries(capacity).reduce((sum, [type, seats]) => {
    return sum + seats * SEAT_TYPES[type].maintenancePerSeat;
  }, 0);

  return {
    arenaId:   arena.ArenaId,
    arenaName: arena.ArenaName,
    teamId:    team.TeamID,
    teamName:  team.TeamName,
    leagueId:  team.LeagueLevelUnit?.LeagueLevelUnitID,
    capacity,
    totalCapacity,
    weeklyMaintenance: Math.round(weeklyMaintenance),
    lastUpdated: new Date().toISOString(),
  };
}

// ─── Stadium planning engine ──────────────────────────────────────────────────

function expectedAttendance(fanCount, fanMood) {
  // Calibrated to community data: 2500 fans @ mood 6 ≈ 40k attendance
  // moodFactor: 0.4 (mood=1) → 1.6 (mood=10)
  const moodFactor = 0.4 + (fanMood / 10) * 1.2;
  return Math.round(fanCount * moodFactor * 13.5);
}

function optimalCapacity(expectedAtt) {
  // 10% buffer above expected demand (better to have spare than lose revenue)
  return Math.round(expectedAtt * 1.10);
}

function weeklyIncomeAtCapacity(attendance, capacity) {
  const fillRate = Math.min(attendance / capacity, 1.0);
  return Object.entries(SEAT_TYPES).reduce((sum, [, type]) => {
    const seatsOfType = capacity * type.recommendedRatio;
    const sold        = seatsOfType * fillRate;
    return sum + sold * type.ticketPrice;
  }, 0);
}

function weeklyMaintenanceForCapacity(capacity) {
  return Object.values(SEAT_TYPES).reduce((sum, type) => {
    return sum + capacity * type.recommendedRatio * type.maintenancePerSeat;
  }, 0);
}

function expansionROI(currentCapacity, optCap, currentMaintenance, expectedAtt, matchesPerSeason) {
  if (optCap <= currentCapacity) {
    return { expansionNeeded: false, deltaSeats: 0 };
  }

  const deltaSeats = optCap - currentCapacity;

  // Build cost: fixed fee + cost per new seat (using recommended mix)
  const buildCost = CONVERSION_FIXED_COST +
    Object.values(SEAT_TYPES).reduce((sum, type) => {
      return sum + Math.round(deltaSeats * type.recommendedRatio) * type.buildCostPerSeat;
    }, 0);

  const currentNetWeekly  = weeklyIncomeAtCapacity(expectedAtt, currentCapacity) - currentMaintenance;
  const optimalMaintenance = weeklyMaintenanceForCapacity(optCap);
  const optimalNetWeekly   = weeklyIncomeAtCapacity(expectedAtt, optCap) - optimalMaintenance;

  const weeklyGain     = optimalNetWeekly - currentNetWeekly;
  const seasonlyGain   = weeklyGain * matchesPerSeason;
  const paybackWeeks   = weeklyGain > 0 ? Math.ceil(buildCost / weeklyGain) : null;

  return {
    expansionNeeded:       true,
    deltaSeats:            Math.round(deltaSeats),
    buildCost:             Math.round(buildCost),
    weeklyIncomeGain:      Math.round(weeklyGain),
    seasonIncomeGain:      Math.round(seasonlyGain),
    paybackWeeks,
    newWeeklyMaintenance:  Math.round(optimalMaintenance),
  };
}

function recommendedSeatDistribution(capacity) {
  return Object.fromEntries(
    Object.entries(SEAT_TYPES).map(([type, t]) => [
      type,
      {
        seats:              Math.round(capacity * t.recommendedRatio),
        ticketPrice:        t.ticketPrice,
        weeklyMaintenance:  Math.round(capacity * t.recommendedRatio * t.maintenancePerSeat),
        buildCostIfNew:     Math.round(capacity * t.recommendedRatio * t.buildCostPerSeat),
      },
    ])
  );
}

// ─── Public: full stadium analysis ───────────────────────────────────────────
export async function getStadiumAnalysis({
  accessToken,
  accessTokenSecret,
  teamId,
  fanCount,
  fanMood = 6,
  matchesPerSeason = 8,
}) {
  const cacheKey = `stadium:${teamId}`;
  const cached   = cache.get(cacheKey);
  if (cached) return cached;

  // 1. Fetch and normalize arena from CHPP
  const { team, arena } = await fetchArenaFromChpp(accessToken, accessTokenSecret, teamId);
  const arenaData = normalizeArena(team, arena);

  // 2. Also pull fan data from teamdetails (same call — already fetched)
  // fanCount and fanMood should be passed from the frontend or fetched separately
  // via the /fans endpoint; here we accept them as parameters for flexibility.
  const expectedAtt = expectedAttendance(fanCount, fanMood);
  const optCap      = optimalCapacity(expectedAtt);
  const fillRate    = Math.min(expectedAtt / arenaData.totalCapacity, 1.0);

  const currentWeeklyIncome = weeklyIncomeAtCapacity(expectedAtt, arenaData.totalCapacity);
  const currentNetIncome    = currentWeeklyIncome - arenaData.weeklyMaintenance;

  const roi = expansionROI(
    arenaData.totalCapacity,
    optCap,
    arenaData.weeklyMaintenance,
    expectedAtt,
    matchesPerSeason,
  );

  // 3. Build verdict
  const delta = optCap - arenaData.totalCapacity;
  let verdict;
  if (Math.abs(delta) < arenaData.totalCapacity * 0.05) {
    verdict = { status: 'optimal', message: 'Tu estadio está bien dimensionado para tu base de fans actual.' };
  } else if (delta > 0 && roi.paybackWeeks !== null && roi.paybackWeeks <= 20) {
    verdict = { status: 'expand', message: `Expansión recomendada: ${roi.deltaSeats.toLocaleString()} asientos nuevos. Amortización en ~${roi.paybackWeeks} partidos en casa.` };
  } else if (delta > 0) {
    verdict = { status: 'watch', message: 'Capacidad por debajo de la demanda potencial, pero el ROI no justifica expansión inmediata.' };
  } else {
    verdict = { status: 'oversized', message: 'Estadio sobredimensionado. El mantenimiento semanal está reduciendo tu rentabilidad.' };
  }

  const result = {
    arena:       arenaData,
    fans: {
      count:    fanCount,
      mood:     fanMood,
    },
    attendance: {
      expected:        expectedAtt,
      fillRate:        parseFloat(fillRate.toFixed(3)),
      matchesPerSeason,
    },
    financials: {
      currentWeeklyGrossIncome: Math.round(currentWeeklyIncome),
      currentWeeklyMaintenance: arenaData.weeklyMaintenance,
      currentWeeklyNetIncome:   Math.round(currentNetIncome),
      currentSeasonNetIncome:   Math.round(currentNetIncome * matchesPerSeason),
    },
    recommendation: {
      optimalCapacity:     optCap,
      recommendedSeats:    recommendedSeatDistribution(optCap),
      roi,
      verdict,
    },
    meta: {
      modelVersion: '1.0.0',
      generatedAt:  new Date().toISOString(),
    },
  };

  cache.set(cacheKey, result, config.cache.teamTtl);
  return result;
}
