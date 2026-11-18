async function startMatch({
  guild,
  guildId,
  lobby,
  deps
}) {
  const {
    withQueueOperationLock,
    loadQueue,
    loadCurrentMatch,
    saveQueue,
    saveCurrentMatch,
    createBalancedTeams,
    calculateHybridMmr,
    migrateInternalRating,
    createTeamChannelsForLobby,
    movePlayersToTeamChannels,
    createClassicTournamentCode,
    saveRiotTournamentMatches
  } = deps;

  return withQueueOperationLock(`${guildId}:global:queue`, async () => {
    const queueData = await loadQueue();
    const currentMatchData = await loadCurrentMatch();

    if (!queueData.lobbies[lobby.id] || currentMatchData.matches[lobby.id]?.active) {
      return null;
    }

    const currentLobby = queueData.lobbies[lobby.id];
    const playersForBalance = currentLobby.players.map((player) => {
      const migrated = migrateInternalRating({
        baseMmr: player.baseMmr,
        internalRating: player.internalRating,
        customWins: player.customWins,
        customLosses: player.customLosses,
        ratingVersion: player.ratingVersion
      });

      return {
        ...player,
        ...migrated,
        mmr: calculateHybridMmr(
          migrated.baseMmr,
          migrated.customWins,
          migrated.customLosses,
          migrated.internalRating
        )
      };
    });

    const teams = createBalancedTeams(playersForBalance);
    let riotTournament = null;
    if (lobby.mode === 'classic' && typeof createClassicTournamentCode === 'function') {
      riotTournament = await createClassicTournamentCode({ guildId, lobbyId: lobby.id }).catch((error) => {
        console.error('[RIOT TOURNAMENT] Falha ao criar código; iniciando partida sem integração:', error.message);
        return { ok: false, reason: 'erro_api' };
      });
      if (riotTournament?.ok) {
        teams.riotTournamentCode = riotTournament.code;
        teams.riotTournamentSetup = true;
      } else {
        teams.riotTournamentSetup = false;
        teams.riotTournamentReason = riotTournament?.reason || 'erro_api';
      }
    }
    const channels = await createTeamChannelsForLobby(guild, lobby);

    teams.mode = lobby.mode;
    teams.format = lobby.format;
    await movePlayersToTeamChannels(guild, teams, channels);

    // Protecao contra sala obsoleta: se ja existir partida ativa com a mesma
    // letra/modo/formato (ex: staff recriou o lobby e a antiga ficou "ativa"),
    // encerra a antiga para que !vitoria nao credite os times errados.
    const staleMatchIds = Object.entries(currentMatchData.matches || {})
      .filter(([existingId, entry]) =>
        entry.active &&
        entry.match &&
        existingId !== lobby.id &&
        entry.match.letter === lobby.letter &&
        entry.match.mode === lobby.mode &&
        entry.match.format === lobby.format
      )
      .map(([existingId]) => existingId);

    for (const staleId of staleMatchIds) {
      console.warn(`[START MATCH] Encerrando partida obsoleta ${staleId} (mesma letra ${lobby.letter}) para abrir ${lobby.id}.`);
      delete currentMatchData.matches[staleId];
    }

    currentMatchData.matches[lobby.id] = {
      active: true,
      votes: {},
      match: {
        ...lobby,
        teamOne: teams.teamOne,
        teamTwo: teams.teamTwo,
        teamOneChannelId: channels.teamOneChannelId,
        teamTwoChannelId: channels.teamTwoChannelId,
        teamSize: teams.teamOne.length,
        createdAt: new Date().toISOString(),
        ...(riotTournament?.ok ? {
          riotTournamentCode: riotTournament.code,
          riotCallbackToken: riotTournament.callbackToken,
          riotTournamentMetadata: riotTournament.metadata
        } : {})
      }
    };

    delete queueData.lobbies[lobby.id];
    await saveQueue(queueData);
    await saveCurrentMatch(currentMatchData);
    if (riotTournament?.ok && typeof saveRiotTournamentMatches === 'function') {
      try {
        const stored = await deps.loadRiotTournamentMatches();
        stored.matches = [
          ...stored.matches.filter((item) => item.lobbyId !== lobby.id),
          {
            lobbyId: lobby.id,
            guildId,
            callbackToken: riotTournament.callbackToken,
            teamOne: teams.teamOne.map((player) => ({ discordId: player.discordId, puuid: player.puuid })),
            teamTwo: teams.teamTwo.map((player) => ({ discordId: player.discordId, puuid: player.puuid })),
            createdAt: new Date().toISOString()
          }
        ].slice(-300);
        await saveRiotTournamentMatches(stored);
      } catch (error) {
        console.error('[RIOT TOURNAMENT] Não foi possível guardar vínculo da partida; estatísticas desativadas nesta sala:', error.message);
        delete currentMatchData.matches[lobby.id].match.riotTournamentCode;
        delete currentMatchData.matches[lobby.id].match.riotCallbackToken;
        delete currentMatchData.matches[lobby.id].match.riotTournamentMetadata;
        await saveCurrentMatch(currentMatchData).catch(() => null);
        delete teams.riotTournamentCode;
        teams.riotTournamentSetup = false;
      }
    }

    return { teams, chs: channels, lobby };
  });
}

module.exports = {
  startMatch
};
