const DEFAULT_CUSTOM_POINTS = 1000;
const RATING_VERSION = 2;

// Peso usado no balanceamento de times: apenas o elo do LoL (baseMmr).
// A pontuacao custom (internalRating/modo) e so visual (perfil, placar, embeds)
// e NAO influencia a montagem dos times.
function getBalanceWeight(player = {}) {
  return Math.max(0, Number(player.baseMmr || 0));
}

function calculateTeamMmr(team) {
  return team.reduce((total, player) => total + getBalanceWeight(player), 0);
}

function calculateSeedRating(baseMmr = 0) {
  return DEFAULT_CUSTOM_POINTS + Math.max(0, Number(baseMmr || 0));
}

function getExperienceWeight(totalGames = 0) {
  const games = Number(totalGames || 0);

  if (games === 0) {
    return 0;
  }

  if (games >= 20) {
    return 1.0;
  }

  if (games >= 10) {
    return 0.9;
  }

  if (games >= 5) {
    return 0.8;
  }

  return 0.7;
}

function migrateInternalRating(modeStats = {}) {
  const baseMmr = Math.max(0, Number(modeStats.baseMmr || 0));

  if (Number(modeStats.ratingVersion) === RATING_VERSION) {
    const currentRating = Number(modeStats.internalRating);

    return {
      ...modeStats,
      baseMmr,
      internalRating: Number.isFinite(currentRating) ? currentRating : calculateSeedRating(baseMmr),
      ratingVersion: RATING_VERSION
    };
  }

  const previousRating = Number.isFinite(Number(modeStats.internalRating))
    ? Number(modeStats.internalRating)
    : DEFAULT_CUSTOM_POINTS;

  return {
    ...modeStats,
    baseMmr,
    internalRating: previousRating + baseMmr,
    ratingVersion: RATING_VERSION
  };
}

function applyLeagueMmrChange(modeStats, newBaseMmr) {
  const migrated = migrateInternalRating(modeStats);
  const nextBaseMmr = Math.max(0, Number(newBaseMmr || 0));
  const previousBaseMmr = Number(migrated.baseMmr || 0);
  const totalGames = Number(migrated.customWins || 0) + Number(migrated.customLosses || 0);
  const nextRating = totalGames === 0
    ? calculateSeedRating(nextBaseMmr)
    : Math.max(0, Number(migrated.internalRating) + (nextBaseMmr - previousBaseMmr));

  return {
    ...migrated,
    baseMmr: nextBaseMmr,
    internalRating: nextRating,
    ratingVersion: RATING_VERSION
  };
}

function calculateHybridMmr(baseMmr, customWins = 0, customLosses = 0, internalRating) {
  const seedRating = calculateSeedRating(baseMmr);
  const currentInternalRating = Number.isFinite(Number(internalRating)) ? Number(internalRating) : seedRating;

  return Math.max(0, Math.round(currentInternalRating));
}

function calculateExpectedScore(ownRating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - ownRating) / 400));
}

function getKFactor(totalGames = 0) {
  const games = Number(totalGames || 0);

  if (games < 5) {
    return 50;
  }

  if (games < 15) {
    return 35;
  }

  return 24;
}

function calculateEloDelta(currentRating, opponentRating, actualScore, totalGames = 0) {
  const expectedScore = calculateExpectedScore(currentRating, opponentRating);
  const kFactor = getKFactor(totalGames);

  return Math.round(kFactor * (actualScore - expectedScore));
}

function createBalancedTeams(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length % 2 !== 0) {
    throw new Error('O balanceamento exige uma quantidade par de jogadores.');
  }

  const sortedPlayers = [...players].sort((a, b) => getBalanceWeight(b) - getBalanceWeight(a));
  const bestCombination = findBestSnakeArrangement(sortedPlayers);

  if (!bestCombination) {
    throw new Error('Nao foi possivel criar times equilibrados.');
  }

  const teams = applySnakeDraft(bestCombination);

  return {
    teamOne: teams.teamOne,
    teamTwo: teams.teamTwo,
    teamOneMmr: calculateTeamMmr(teams.teamOne),
    teamTwoMmr: calculateTeamMmr(teams.teamTwo),
    difference: Math.abs(calculateTeamMmr(teams.teamOne) - calculateTeamMmr(teams.teamTwo))
  };
}

function findBestSnakeArrangement(players) {
  let bestArrangement = null;
  let smallestDifference = Number.POSITIVE_INFINITY;
  const pairs = [];

  for (let index = 0; index < players.length; index += 2) {
    pairs.push([players[index], players[index + 1]]);
  }

  function explore(pairIndex, arrangedPlayers) {
    if (pairIndex === pairs.length) {
      const teams = applySnakeDraft(arrangedPlayers);
      const difference = Math.abs(calculateTeamMmr(teams.teamOne) - calculateTeamMmr(teams.teamTwo));

      if (difference < smallestDifference) {
        smallestDifference = difference;
        bestArrangement = [...arrangedPlayers];
      }

      return;
    }

    const [firstPlayer, secondPlayer] = pairs[pairIndex];

    arrangedPlayers.push(firstPlayer, secondPlayer);
    explore(pairIndex + 1, arrangedPlayers);
    arrangedPlayers.pop();
    arrangedPlayers.pop();

    arrangedPlayers.push(secondPlayer, firstPlayer);
    explore(pairIndex + 1, arrangedPlayers);
    arrangedPlayers.pop();
    arrangedPlayers.pop();
  }

  explore(0, []);
  return bestArrangement;
}

function applySnakeDraft(players) {
  const teamOne = [];
  const teamTwo = [];

  players.forEach((player, index) => {
    const round = Math.floor(index / 2);
    const isEvenRound = round % 2 === 0;

    if (index % 2 === 0) {
      (isEvenRound ? teamOne : teamTwo).push(player);
    } else {
      (isEvenRound ? teamTwo : teamOne).push(player);
    }
  });

  return { teamOne, teamTwo };
}

module.exports = {
  DEFAULT_CUSTOM_POINTS,
  RATING_VERSION,
  getBalanceWeight,
  createBalancedTeams,
  calculateTeamMmr,
  calculateHybridMmr,
  calculateSeedRating,
  calculateEloDelta,
  getExperienceWeight,
  migrateInternalRating,
  applyLeagueMmrChange
};
