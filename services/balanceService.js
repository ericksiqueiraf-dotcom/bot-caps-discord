function calculateTeamMmr(team) {
  return team.reduce((total, player) => total + player.mmr, 0);
}

function calculateSeedRating(baseMmr = 1000) {
  const numericBase = Number(baseMmr || 1000);

  // Comprime o peso do elo da Riot para nao dominar o rank interno.
  return Math.round(1000 + (numericBase - 1000) * 0.45);
}

function getExperienceWeight(totalGames = 0) {
  const games = Number(totalGames || 0);

  if (games >= 20) {
    return 1.0;
  }

  if (games >= 10) {
    return 0.75;
  }

  if (games >= 5) {
    return 0.5;
  }

  return 0.25;
}

function calculateHybridMmr(baseMmr, customWins = 0, customLosses = 0, internalRating) {
  const totalGames = Number(customWins || 0) + Number(customLosses || 0);
  const seedRating = calculateSeedRating(baseMmr);
  const currentInternalRating = Number.isFinite(Number(internalRating)) ? Number(internalRating) : seedRating;
  const experienceWeight = getExperienceWeight(totalGames);
  const blendedRating = seedRating * (1 - experienceWeight) + currentInternalRating * experienceWeight;

  return Math.max(0, Math.round(blendedRating));
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

  const sortedPlayers = [...players].sort((a, b) => b.mmr - a.mmr);
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
  createBalancedTeams,
  calculateTeamMmr,
  calculateHybridMmr,
  calculateSeedRating,
  calculateEloDelta,
  getExperienceWeight
};
