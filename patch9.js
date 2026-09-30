const fs = require('fs');

let appCode = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

// 1. Hide "Encerrar" on gallery for clients
appCode = appCode.replace(
  /<button className="back-btn" onClick=\{\(\) => setScreen\('dashboard'\)\}>\s*Encerrar\s*<\/button>/,
  `{!shareToken && (
            <button className="back-btn" onClick={() => setScreen('dashboard')}>
              Encerrar
            </button>
          )}`
);

// 2. Hide "Teste de link compartilhado" block on summary for clients
// It starts with <div className="summary-card" style={{ marginTop: '16px' }}> and ends before {noticeBanner}
// But wait, there are multiple "summary-card" with marginTop 16px!
// Let's replace the whole block by finding the start and end precisely.
const linkTestStart = `<div className="summary-card" style={{ marginTop: '16px' }}>
          <div className="summary-label">Teste de link compartilhado</div>`;

const linkTestEnd = `          ) : null}
        </div>

        {noticeBanner}`;

const linkTestRegex = new RegExp(
  linkTestStart.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + linkTestEnd.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')
);

const replacedLinkTest = `{!shareToken && (
        <div className="summary-card" style={{ marginTop: '16px' }}>
          <div className="summary-label">Link compartilhado</div>
          <small className="summary-help">
            Crie o link temporário para o cliente selecionar as fotos no próprio celular.
          </small>
          <div style={{ marginTop: '12px' }}>
            <label className="share-duration-label" htmlFor="share-duration">
              Tempo de acesso em minutos
            </label>
            <input
              id="share-duration"
              type="number"
              min="5"
              max="180"
              step="5"
              value={shareDurationMinutes}
              onChange={(event) =>
                setShareDurationMinutes(
                  Math.min(180, Math.max(5, Number(event.target.value) || 30))
                )
              }
              className="phone-input"
              style={{ marginTop: '6px' }}
            />
          </div>
          <div className="action-stack" style={{ padding: '14px 0 0' }}>
            <button
              className="btn-manual btn-manual-cash"
              disabled={shareActionLoading || selectedPhotos.length === 0}
              onClick={handleCreateShareSession}
            >
              {shareActionLoading ? 'Gerando e enviando...' : 'Criar link e enviar WhatsApp'}
            </button>
          </div>

          {shareAccess ? (
            <div className="share-summary">
              <div className="summary-row">
                <span>Link</span>
                <strong className="share-link-text">{shareAccess.link}</strong>
              </div>
              <div className="summary-row">
                <span>Código</span>
                <strong>{shareAccess.code}</strong>
              </div>
              <div className="summary-row">
                <span>Expira em</span>
                <strong>
                  <ShareCountdown isoDate={shareAccess.expiresAt} />
                </strong>
              </div>
              <div className="share-actions">
                <button
                  className="btn-manual btn-manual-card"
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      shareAccess.whatsappMessage ||
                        buildShareWhatsAppMessage(shareAccess.link, shareAccess.code)
                    )
                  }
                >
                  Copiar mensagem WhatsApp
                </button>
                <button
                  className="btn-manual btn-manual-card"
                  onClick={handleExtendShareSession}
                  disabled={shareActionLoading}
                >
                  Estender +15 min
                </button>
                <button
                  className="btn-manual btn-manual-cash"
                  onClick={handleRevokeShareSession}
                  disabled={shareActionLoading}
                >
                  Revogar acesso
                </button>
              </div>
              <small className="summary-help" style={{ marginTop: '12px' }}>
                {shareAccess.whatsappMessage ||
                  buildShareWhatsAppMessage(shareAccess.link, shareAccess.code)}
              </small>
            </div>
          ) : null}
        </div>
        )}

        {noticeBanner}`;

appCode = appCode.replace(linkTestRegex, replacedLinkTest);

// 3. Update texts in summary screen for clients
const phoneInputCardOld = `<div className="summary-card" style={{ marginTop: '16px' }}>
          <div className="summary-label">WhatsApp do cliente</div>
          <input
            type="tel"
            placeholder="(11) 99999-9999"
            value={clientPhone}
            onChange={(event) => setClientPhone(event.target.value.replace(/\\D/g, ''))}
            className="phone-input"
          />
          <small className="summary-help">
            Assim que o pagamento for confirmado por você no painel, as imagens serão
            disparadas para ele em formato de documento, sem compressao.
          </small>
        </div>`;

const phoneInputCardNew = `<div className="summary-card" style={{ marginTop: '16px' }}>
          <div className="summary-label">{shareToken ? 'Seu WhatsApp' : 'WhatsApp do cliente'}</div>
          <input
            type="tel"
            placeholder="(11) 99999-9999"
            value={clientPhone}
            onChange={(event) => setClientPhone(event.target.value.replace(/\\D/g, ''))}
            className="phone-input"
          />
          <small className="summary-help">
            {shareToken 
              ? 'Assim que o pagamento for confirmado, suas fotos serão enviadas para este número em alta qualidade.' 
              : 'Assim que o pagamento for confirmado por você no painel, as imagens serão disparadas para ele em formato de documento, sem compressao.'}
          </small>
        </div>`;

appCode = appCode.replace(phoneInputCardOld, phoneInputCardNew);

// 4. Hide "Finalizar e abordar próximo cliente" and adjust texts on Confirmed screen
const confirmedScreenRegex = /<button\s*className="btn-outline-white"\s*style=\{\{ marginTop: '30px' \}\}\s*onClick=\{\(\) => \{\s*resetSession\(\);\s*setScreen\('dashboard'\);\s*fetchDashboard\(\{ silent: true \}\);\s*\}\}\s*>\s*Finalizar e abordar próximo cliente\s*<\/button>/g;

appCode = appCode.replace(confirmedScreenRegex, `{!shareToken && (
          <button
            className="btn-outline-white"
            style={{ marginTop: '30px' }}
            onClick={() => {
              resetSession();
              setScreen('dashboard');
              fetchDashboard({ silent: true });
            }}
          >
            Finalizar e abordar próximo cliente
          </button>
        )}`);

const confirmedSubOld = `<p className="confirmed-sub" style={{ color: '#00C851', marginBottom: '30px' }}>
          {isPix
            ? 'Pagamento confirmado.'
            : 'Pagamento confirmado pelo fotógrafo. Fotos liberadas após validação no painel.'}
        </p>`;

const confirmedSubNew = `<p className="confirmed-sub" style={{ color: '#00C851', marginBottom: '30px' }}>
          {isPix
            ? 'Pagamento confirmado.'
            : (shareToken ? 'Solicitação enviada! Por favor, acerte o pagamento com o fotógrafo para liberar suas fotos.' : 'Pagamento confirmado pelo fotógrafo. Fotos liberadas após validação no painel.')}
        </p>`;

appCode = appCode.replace(confirmedSubOld, confirmedSubNew);

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', appCode);
console.log('Patch 9 applied');
