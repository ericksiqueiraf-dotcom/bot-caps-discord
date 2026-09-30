const fs = require('fs');

let appCode = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');
let serverCode = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/backend/server.js', 'utf8');

// 1. App.jsx: State persistence
const oldStateBlock = `  const [shareToken] = useState(() => detectShareToken());
  const [screen, setScreen] = useState(() => (detectShareToken() ? 'share-lock' : 'dashboard'));
  const [shareAccess, setShareAccess] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('snapflow-share-access');
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
          /* empty */
        }
      }
    }
    return null;
  });

  const [type, setType] = useState('eventos');
  const [photos, setPhotos] = useState([]);
  const [selected, setSelected] = useState([]);
  const [clientPhone, setClientPhone] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [qrCodeBase64, setQrCodeBase64] = useState('');
  const [liveOps, setLiveOps] = useState({
    paymentStatus: 'draft',
    deliveryStatus: 'idle',
    deliveryError: null,
    paymentMethod: null,
  });`;

const newStateBlock = `  const [shareToken] = useState(() => detectShareToken());
  
  const getSavedState = (key, fallback) => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('snapflow-' + key);
      if (stored) {
        try { return JSON.parse(stored); } catch { /* ignore */ }
      }
    }
    return fallback;
  };

  const [shareAccess, setShareAccess] = useState(() => getSavedState('share-access', null));
  
  const initialScreen = () => {
    const token = detectShareToken();
    if (token) {
      const access = getSavedState('share-access', null);
      if (access && access.token === token) {
        return getSavedState('screen', 'gallery');
      }
      return 'share-lock';
    }
    return getSavedState('screen', 'dashboard');
  };

  const [screen, setScreen] = useState(initialScreen);
  const [type, setType] = useState(() => getSavedState('type', 'eventos'));
  const [photos, setPhotos] = useState(() => getSavedState('photos', []));
  const [selected, setSelected] = useState(() => getSavedState('selected', []));
  const [clientPhone, setClientPhone] = useState(() => getSavedState('clientPhone', ''));
  const [sessionId, setSessionId] = useState(() => getSavedState('sessionId', ''));
  const [qrCodeBase64, setQrCodeBase64] = useState(() => getSavedState('qrCodeBase64', ''));
  const [liveOps, setLiveOps] = useState(() => getSavedState('liveOps', {
    paymentStatus: 'draft',
    deliveryStatus: 'idle',
    deliveryError: null,
    paymentMethod: null,
  }));
  
  // Persist important state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const prefix = 'snapflow-';
      window.localStorage.setItem(prefix + 'screen', JSON.stringify(screen));
      window.localStorage.setItem(prefix + 'type', JSON.stringify(type));
      window.localStorage.setItem(prefix + 'selected', JSON.stringify(selected));
      window.localStorage.setItem(prefix + 'clientPhone', JSON.stringify(clientPhone));
      window.localStorage.setItem(prefix + 'sessionId', JSON.stringify(sessionId));
      window.localStorage.setItem(prefix + 'qrCodeBase64', JSON.stringify(qrCodeBase64));
      window.localStorage.setItem(prefix + 'liveOps', JSON.stringify(liveOps));
    }
  }, [screen, type, selected, clientPhone, sessionId, qrCodeBase64, liveOps]);
  
  // Save photos if we are in share view (dashboard photos are not saved to save space)
  useEffect(() => {
    if (typeof window !== 'undefined' && shareToken) {
      window.localStorage.setItem('snapflow-photos', JSON.stringify(photos));
    }
  }, [photos, shareToken]);`;

appCode = appCode.replace(oldStateBlock, newStateBlock);

// 2. App.jsx: Global photographer polling
const oldUseEffectDashboard = /useEffect\(\(\) => \{\s*let cancelled = false;[\s\S]*?if \(screen === 'dashboard'\) \{\s*loadDashboard\(\);\s*\}[\s\S]*?return \(\) => \{\s*cancelled = true;\s*\};\s*\}, \[screen\]\);/;

const newUseEffectDashboard = `useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      try {
        const response = await fetch(\`\${API_BASE_URL}/api/dashboard\`);
        if (!response.ok) return;

        const data = await response.json();
        if (!cancelled) {
          setDashData(data);
          
          // Se for fotógrafo (sem shareToken), avisa se tiver manual pendente
          if (!shareToken) {
            const pendingManual = data.recent.filter(s => s.status === 'pending' && s.paymentMethod === 'Dinheiro/Cartão');
            if (pendingManual.length > 0) {
              setPendingManualSessions(pendingManual);
            } else {
              setPendingManualSessions([]);
            }
          }
        }
      } catch (error) {
        // ignore
      }
    };

    loadDashboard();
    
    // Auto-refresh a cada 5 segundos para o fotógrafo ter updates em tempo real!
    const interval = setInterval(() => {
      if (!shareToken || screen === 'dashboard') {
        loadDashboard();
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [screen, shareToken]);`;

appCode = appCode.replace(oldUseEffectDashboard, newUseEffectDashboard);

// 3. App.jsx: Add pendingManualSessions state and Global Banner rendering
const oldDashDataState = `  const [dashData, setDashData] = useState({ stats: null, recent: [], shareRecent: [] });`;
const newDashDataState = `  const [dashData, setDashData] = useState({ stats: null, recent: [], shareRecent: [] });
  const [pendingManualSessions, setPendingManualSessions] = useState([]);`;
appCode = appCode.replace(oldDashDataState, newDashDataState);

// Add global floating banner right before the last closing </div> of App
const oldClosingDiv = /    <\div>\s*<Toaster notice=\{notice\} \/>\s*<\/div>\s*\);\s*\}\s*export default App;/;

// Wait, the end of App is:
//     <div>
//       <Toaster notice={notice} />
//     </div>
//   );
// }
const injectGlobalBanner = `      <Toaster notice={notice} />
      
      {pendingManualSessions.length > 0 && !shareToken && (
        <div style={{
          position: 'fixed', bottom: '20px', left: '20px', right: '20px', 
          background: 'var(--surface-color)', padding: '16px', borderRadius: '12px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 9999,
          border: '1px solid var(--green)'
        }}>
          <h4 style={{ margin: '0 0 10px 0', color: 'var(--green)' }}>Solicitação de Liberação de Fotos!</h4>
          {pendingManualSessions.map(sess => (
            <div key={sess.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <strong>{sess.photoCount} foto(s) • {sess.accessCode ? \`Cód: \${sess.accessCode}\` : sess.phone}</strong>
              </div>
              <button 
                className="btn-primary"
                style={{ margin: 0, padding: '8px 16px', fontSize: '14px', width: 'auto' }}
                onClick={async () => {
                  try {
                    await fetch(\`\${API_BASE_URL}/api/approve-manual-session/\${sess.id}\`, { method: 'POST' });
                    setNotice('Fotos enviadas com sucesso!');
                    fetchDashboard({silent: true});
                  } catch(e) {}
                }}
              >
                Liberar Fotos
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}`;

appCode = appCode.replace(/      <Toaster notice=\{notice\} \/>\s*<\/div>\s*\);\s*\}\s*$/, injectGlobalBanner);

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', appCode);

console.log('Patch 6 ready!');
