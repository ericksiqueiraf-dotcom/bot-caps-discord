const fs = require('fs');

let serverCode = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/backend/server.js', 'utf8');

const oldManualPaymentRegex = /app\.post\('\/api\/manual-payment'[\s\S]*?return res\.status\(500\)\.json\(\{ error: 'Falha ao registrar pagamento manual' \}\);\s*\}\s*\}\);/;

const newManualPayment = `app.post('/api/manual-payment', async (req, res) => {
  const { total, count, sessionId, phone, photos, packageType, paymentMethod, isShareSession, shareToken } = req.body;

  try {
    const methodLabel = 'Dinheiro/Cartão';
    const finalStatus = isShareSession ? 'pending' : 'approved';
    const deliveryStatus = isShareSession ? 'idle' : 'queued';

    const db = readDB();
    
    let realAccessCode = null;
    if (isShareSession && shareToken) {
      const shareSess = db.shareSessions.find(s => s.token === shareToken);
      if (shareSess) {
        realAccessCode = shareSess.accessCode;
      }
    }

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
      accessCode: realAccessCode,
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
});`;

serverCode = serverCode.replace(oldManualPaymentRegex, newManualPayment);
fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/backend/server.js', serverCode);


let appCode = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

const oldUseEffect = `  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      try {
        const response = await fetch(\`\${API_BASE_URL}/api/dashboard\`);
        if (!response.ok) {
          throw new Error(\`Dashboard retornou \${response.status}\`);
        }

        const data = await response.json();
        if (!cancelled) {
          setDashData(data);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Falha ao carregar dashboard:', error);
        }
      }
    };

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, []);`;

const newUseEffect = `  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      try {
        const response = await fetch(\`\${API_BASE_URL}/api/dashboard\`);
        if (!response.ok) {
          throw new Error(\`Dashboard retornou \${response.status}\`);
        }

        const data = await response.json();
        if (!cancelled) {
          setDashData(data);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Falha ao carregar dashboard:', error);
        }
      }
    };

    if (screen === 'dashboard') {
      loadDashboard();
    }

    return () => {
      cancelled = true;
    };
  }, [screen]);`;

appCode = appCode.replace(oldUseEffect, newUseEffect);

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', appCode);

console.log('Done');
