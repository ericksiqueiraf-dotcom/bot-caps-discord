async function castVictoryVote({
  currentMatchData,
  matchEntry,
  voterId,
  teamVote,
  voteThreshold,
  deps
}) {
  const {
    saveCurrentMatch
  } = deps;

  const [matchId, entry] = matchEntry;
  if (!entry.votes) {
    entry.votes = {};
  }

  if (entry.votes[voterId]) {
    return {
      status: 'already_voted',
      previousVote: entry.votes[voterId]
    };
  }

  entry.votes[voterId] = teamVote;

  const votesT1 = Object.values(entry.votes).filter((vote) => vote === '1').length;
  const votesT2 = Object.values(entry.votes).filter((vote) => vote === '2').length;
  const winnerTeam = votesT1 >= voteThreshold ? '1' : votesT2 >= voteThreshold ? '2' : null;

  await saveCurrentMatch(currentMatchData);

  return {
    status: winnerTeam ? 'threshold_reached' : 'vote_recorded',
    matchId,
    winnerTeam,
    votesT1,
    votesT2,
    totalVotes: votesT1 + votesT2,
    threshold: voteThreshold
  };
}

module.exports = {
  castVictoryVote
};
