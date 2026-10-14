require('dotenv').config();

const path = require('path');
const express = require('express');
const {
  getDashboardViewModel,
  updatePlayer,
  updateContentTemplates,
  resetContentTemplates,
  reseedPlayer,
  removePlayerFromLobby,
  deleteLobby,
  deleteMatch,
  recordManualMatchResult,
  cancelInterBusca,
  QUEUE_MODES,
  KNOWN_ARAM_FORMATS
} = require('./service');
const {
  verifyUser,
  issueSession,
  revokeSession,
  parseCookies,
  getSessionUser,
  sessionCookieHeader,
  clearSessionCookieHeader,
  requireAuth,
  requireRole
} = require('./auth');

const app = express();
const PORT = Number(process.env.ADMIN_PORT || 3030);

// Alternador entre painéis (um processo por bot; links cruzados).
const BOT_LABEL = process.env.BOT_LABEL || (PORT === 3031 ? 'LCL' : 'CAPS');
const PEER_URL = process.env.PEER_ADMIN_URL || (PORT === 3031 ? 'http://localhost:3030' : 'http://localhost:3031');
const PEER_LABEL = process.env.PEER_LABEL || (PORT === 3031 ? 'CAPS' : 'LCL');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.join(__dirname, 'public')));

function buildRedirect(res, message, type = 'success', query = '') {
  const params = new URLSearchParams(query);
  params.set(type, message);
  return res.redirect(`/?${params.toString()}`);
}

function currentUser(req) {
  return getSessionUser(parseCookies(req).caps_admin);
}

// Login (publico). Demais rotas exigem sessao.
app.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  return res.render('login', { flash: { error: req.query.error || '' } });
});

app.post('/login', async (req, res) => {
  try {
    const user = await verifyUser(req.body.username, req.body.password);
    if (!user) return res.redirect('/login?error=' + encodeURIComponent('Usuario ou senha invalidos.'));
    const token = issueSession(user);
    res.setHeader('Set-Cookie', sessionCookieHeader(token));
    return res.redirect('/');
  } catch (error) {
    return res.redirect('/login?error=' + encodeURIComponent(error.message));
  }
});

app.post('/logout', (req, res) => {
  revokeSession(parseCookies(req).caps_admin);
  res.setHeader('Set-Cookie', clearSessionCookieHeader());
  return res.redirect('/login');
});

app.use(requireAuth);
// MVP: viewer le; escrita (POST) so admin. /logout liberado p/ autenticados.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.path === '/logout') return next();
  return requireRole('admin')(req, res, next);
});

app.get('/', async (req, res, next) => {
  try {
    const viewModel = await getDashboardViewModel(req.query.q);

    res.render('dashboard', {
      ...viewModel,
      user: req.adminUser,
      botLabel: BOT_LABEL,
      peerUrl: PEER_URL,
      peerLabel: PEER_LABEL,
      filters: {
        q: req.query.q || ''
      },
      flash: {
        success: req.query.success || '',
        error: req.query.error || ''
      },
      queueModes: QUEUE_MODES,
      aramFormats: KNOWN_ARAM_FORMATS
    });
  } catch (error) {
    next(error);
  }
});

app.post('/players/:playerKey/update', async (req, res) => {
  try {
    await updatePlayer(req.params.playerKey, req.body);
    return buildRedirect(res, 'Jogador atualizado com sucesso.');
  } catch (error) {
    return buildRedirect(res, error.message, 'error');
  }
});

app.post('/content/update', async (req, res) => {
  try {
    await updateContentTemplates(req.body);
    return buildRedirect(res, 'Textos do bot atualizados com sucesso.');
  } catch (error) {
    return buildRedirect(res, error.message, 'error');
  }
});

app.post('/content/reset', async (req, res) => {
  try {
    await resetContentTemplates(String(req.body.section || 'all'));
    return buildRedirect(res, 'Textos padrao restaurados com sucesso.');
  } catch (error) {
    return buildRedirect(res, error.message, 'error');
  }
});

app.post('/players/:playerKey/reseed', async (req, res) => {
  try {
    const mode = req.body.mode === QUEUE_MODES.ARAM ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
    const format = mode === QUEUE_MODES.ARAM ? String(req.body.format || '').toLowerCase() || null : null;
    await reseedPlayer(req.params.playerKey, mode, format);
    return buildRedirect(res, 'MMR interno recalculado a partir do seed.');
  } catch (error) {
    return buildRedirect(res, error.message, 'error');
  }
});

app.post('/lobbies/:lobbyId/remove-player', async (req, res) => {
  try {
    await removePlayerFromLobby(req.params.lobbyId, req.body.discordId);
    return buildRedirect(res, 'Jogador removido do lobby.');
  } catch (error) {
    return buildRedirect(res, error.message, 'error');
  }
});

app.post('/lobbies/:lobbyId/delete', async (req, res) => {
  try {
    await deleteLobby(req.params.lobbyId);
    return buildRedirect(res, 'Lobby removido do estado salvo.');
  } catch (error) {
    return buildRedirect(res, error.message, 'error');
  }
});

app.post('/matches/:matchId/result', async (req, res) => {
  try {
    const winnerTeam = String(req.body.winnerTeam || '');
    if (!['1', '2'].includes(winnerTeam)) {
      throw new Error('Equipe vencedora invalida.');
    }

    await recordManualMatchResult(req.params.matchId, winnerTeam);
    return buildRedirect(res, 'Resultado manual registrado e partida encerrada.');
  } catch (error) {
    return buildRedirect(res, error.message, 'error');
  }
});

app.post('/matches/:matchId/delete', async (req, res) => {
  try {
    await deleteMatch(req.params.matchId);
    return buildRedirect(res, 'Partida removida do estado salvo.');
  } catch (error) {
    return buildRedirect(res, error.message, 'error');
  }
});

app.post('/inter/buscas/cancel', async (req, res) => {
  try {
    const result = await cancelInterBusca(req.body.key);
    if (result.status !== 'cancelled') {
      throw new Error('Busca nao encontrada (ja formou match ou expirou).');
    }
    return buildRedirect(res, 'Busca inter cancelada.');
  } catch (error) {
    return buildRedirect(res, error.message, 'error');
  }
});

app.use((error, req, res, next) => {
  console.error('[ADMIN DASHBOARD]', error);
  res.status(500).send(`Erro interno no dashboard: ${error.message}`);
});

app.listen(PORT, () => {
  console.log(`[ADMIN] Dashboard local disponivel em http://localhost:${PORT}`);
});
