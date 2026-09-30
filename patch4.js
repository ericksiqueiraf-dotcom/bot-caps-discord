const fs = require('fs');
let appCode = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');
let serverCode = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/backend/server.js', 'utf8');

// server.js patches
const oldManualPaymentRegex = /app\.post\('\/api\/manual-payment'[\s\S]*?return res\.status\(500\)\.json\(\{ error: 'Falha ao registrar pagamento manual' \}\);\s*\}\s*\}\);/;

const newManualPayment = `app.post('/api/manual-payment', async (req, res) => {
  const { total, count, sessionId, phone, photos, packageType, paymentMethod, isShareSession, shareToken, accessCode } = req.body;

  try {
    const methodLabel = 'Dinheiro/Cartão';
    const finalStatus = isShareSession ? 'pending' : 'approved';
    const deliveryStatus = isShareSession ? 'idle' : 'queued';

    const db = readDB();
    db.sessions.push({
      id: sessionId,
      amount: total,
      photoCount: count,
      packageType: packageType || 'eventos',
      phone,
      photos,
      status: finalStatus,
      paymentMethod: methodLabel,
      approvedAt: isShareSession ? null : new Date().toISOString(),
      deliveryStatus,
      deliveryError: null,
      shareToken: shareToken || null,
      accessCode: accessCode || null,
      created_at: new Date().toISOString(),
    });
    writeDB(db);

    if (!isShareSession) {
      sendPhotosViaWhatsApp(sessionId, phone, photos);
    }

    return res.json({
      status: finalStatus,
      deliveryStatus,
      paymentMethod: methodLabel,
    });
  } catch (error) {
    console.error('Falha no pagamento manual:', error);
    return res.status(500).json({ error: 'Falha ao registrar pagamento manual' });
  }
});

app.post('/api/approve-manual-session/:id', async (req, res) => {
  try {
    const db = readDB();
    const session = db.sessions.find(s => s.id === req.params.id);
    if (!session) return res.status(404).json({error: 'Not found'});
    
    session.status = 'approved';
    session.approvedAt = new Date().toISOString();
    session.deliveryStatus = 'queued';
    writeDB(db);
    
    sendPhotosViaWhatsApp(session.id, session.phone, session.photos);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({error: 'Falha ao aprovar'});
  }
});`;

serverCode = serverCode.replace(oldManualPaymentRegex, newManualPayment);

const dashboardEndpointOld = `    const recent = db.sessions
      .slice()
      .reverse()
      .slice(0, 15)
      .map((session) => ({
        id: session.id,
        amount: session.amount,
        photoCount: session.photoCount,
        packageType: session.packageType,
        status: session.status,
        deliveryStatus: session.deliveryStatus,
      }));`;
const dashboardEndpointNew = `    const recent = db.sessions
      .slice()
      .reverse()
      .slice(0, 15)
      .map((session) => ({
        id: session.id,
        amount: session.amount,
        photoCount: session.photoCount,
        packageType: session.packageType,
        status: session.status,
        deliveryStatus: session.deliveryStatus,
        paymentMethod: session.paymentMethod,
        accessCode: session.accessCode,
        phone: session.phone,
      }));`;
serverCode = serverCode.replace(dashboardEndpointOld, dashboardEndpointNew);

// App.jsx patches
const oldBtn = `{!shareToken && (
            <button
              className="btn-manual btn-manual-cash"
              disabled={isGeneratingPix || clientPhone.length < 10}
              onClick={() => handleManualPayment('manual')}
            >
              Pagamento Dinheiro/Cartão
            </button>
          )}`;
const newBtn = `<button
            className="btn-manual btn-manual-cash"
            disabled={isGeneratingPix || clientPhone.length < 10}
            onClick={() => handleManualPayment('manual')}
          >
            {shareToken ? 'Solicitar Pagto em Dinheiro/Cartão' : 'Pagamento Dinheiro/Cartão'}
          </button>`;
appCode = appCode.replace(oldBtn, newBtn);

const oldHandleRegex = /const response = await fetch\(`\$\{API_BASE_URL\}\/api\/manual-payment`[\s\S]*?body: JSON\.stringify\(\{\s*total,\s*count,\s*sessionId: generatedId,\s*phone: clientPhone,\s*photos: selectedPhotos,\s*thumbs: selectedThumbs,\s*packageType: type,\s*paymentMethod,\s*\}\),[\s\S]*?setNotice\('Pagamento em dinheiro\/cartão confirmado pelo fotógrafo e fotos liberadas\.'\);/m;

const newHandle = `const response = await fetch(\`\${API_BASE_URL}/api/manual-payment\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total,
          count,
          sessionId: generatedId,
          phone: clientPhone,
          photos: selectedPhotos,
          thumbs: selectedThumbs,
          packageType: type,
          paymentMethod,
          isShareSession: !!shareToken,
          shareToken: shareToken,
          accessCode: shareSessionInfo?.accessCode,
        }),
      });

      const data = await readJsonResponse(response);

      if (response.ok && data.status === 'approved') {
        setLiveOps({
          paymentStatus: 'approved',
          deliveryStatus: data.deliveryStatus || 'queued',
          deliveryError: null,
          paymentMethod: 'Dinheiro/Cartão',
        });
        setNotice('Pagamento em dinheiro/cartão confirmado pelo fotógrafo e fotos liberadas.');
      } else if (response.ok && data.status === 'pending') {
        setLiveOps({
          paymentStatus: 'pending',
          deliveryStatus: 'idle',
          deliveryError: null,
          paymentMethod: 'Dinheiro/Cartão',
        });
        setNotice('Solicitação enviada! Avise o fotógrafo para liberar as fotos.');
        setScreen('pix');
        return;`;

appCode = appCode.replace(oldHandleRegex, newHandle);

const oldSessionMapRegex = /<div key=\{session\.id\} className="session-item">[\s\S]*?<div className="session-info">[\s\S]*?<strong>\{formatMoney\(Number\(session\.amount\) \|\| 0\)\}<\/strong>[\s\S]*?<small>[\s\S]*?\{session\.photoCount\} foto\(s\) • \{packageLabel\}[\s\S]*?<\/small>[\s\S]*?<\/div>[\s\S]*?<div className="session-status">[\s\S]*?<span className=\{\`badge badge-\$\{paymentMeta\.tone\}\`\}>\{paymentMeta\.label\}<\/span>[\s\S]*?<span className=\{\`badge badge-\$\{deliveryMeta\.tone\}\`\}>\{deliveryMeta\.label\}<\/span>[\s\S]*?<\/div>[\s\S]*?<\/div>/m;

const newSessionMap = `<div key={session.id} className="session-item" style={{ flexWrap: 'wrap' }}>
                  <div className="session-info">
                    <strong>{formatMoney(Number(session.amount) || 0)}</strong>
                    <small>
                      {session.photoCount} foto(s) • {packageLabel}
                    </small>
                    {session.accessCode ? (
                      <small style={{ color: 'var(--green)', display: 'block', marginTop: '4px' }}>Código: {session.accessCode} • {session.phone}</small>
                    ) : null}
                  </div>
                  <div className="session-status" style={{ gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span className={\`badge badge-\${paymentMeta.tone}\`}>{paymentMeta.label}</span>
                    <span className={\`badge badge-\${deliveryMeta.tone}\`}>{deliveryMeta.label}</span>
                    {session.status === 'pending' && session.paymentMethod === 'Dinheiro/Cartão' ? (
                      <button 
                        className="share-quick-btn" 
                        style={{ background: 'var(--green)', color: 'black', border: 'none', padding: '6px 12px', width: '100%', marginTop: '4px' }}
                        onClick={async () => {
                          try {
                            await fetch(\`\${API_BASE_URL}/api/approve-manual-session/\${session.id}\`, { method: 'POST' });
                            fetchDashboard({silent: true});
                          } catch (e) { console.error(e); }
                        }}
                      >
                        Liberar Fotos
                      </button>
                    ) : null}
                  </div>
                </div>`;

appCode = appCode.replace(oldSessionMapRegex, newSessionMap);

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/backend/server.js', serverCode);
fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', appCode);

console.log('Done');
