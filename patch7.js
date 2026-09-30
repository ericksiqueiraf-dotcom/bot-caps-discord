const fs = require('fs');
let appCode = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

// 1. Rewrite the entire state initialization block dynamically to handle any order
const stateBlockRegex = /const \[shareToken\] = useState\(\(\) => detectShareToken\(\)\);[\s\S]*?const \[dashData, setDashData\] = useState\(\{\s*stats:[\s\S]*?shareRecent: \[\],\s*\}\);/;

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
  const [period, setPeriod] = useState('hoje');
  const [viewerIndex, setViewerIndex] = useState(null);
  const [isGeneratingPix, setIsGeneratingPix] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [brokenPhotoIds, setBrokenPhotoIds] = useState([]);
  const [notice, setNotice] = useState(null);
  const [shareSessionInfo, setShareSessionInfo] = useState(null);
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [shareAccess, setShareAccess] = useState(() => getSavedState('share-access', null));
  const [shareActionLoading, setShareActionLoading] = useState(false);
  const [shareDurationMinutes, setShareDurationMinutes] = useState(30);
  const [dashData, setDashData] = useState({ stats: null, recent: [], shareRecent: [] });
  const [pendingManualSessions, setPendingManualSessions] = useState([]);
  
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
  
  // Save photos only if shareToken exists
  useEffect(() => {
    if (typeof window !== 'undefined' && shareToken) {
      window.localStorage.setItem('snapflow-photos', JSON.stringify(photos));
    }
  }, [photos, shareToken]);`;

appCode = appCode.replace(stateBlockRegex, newStateBlock);

// 2. Add anti-print to viewer!
const oldViewer = /<div className="viewer-overlay" onClick=\{closeViewer\}>[\s\S]*?<img[\s\S]*?src=\{currentPhoto\.url\}[\s\S]*?className="viewer-image"[\s\S]*?\/>/;

const newViewer = `<div className="viewer-overlay" onClick={closeViewer}>
          <img
            src={currentPhoto.url}
            className="viewer-image"
            alt="Tela cheia"
            style={{
              userSelect: 'none',
              WebkitUserSelect: 'none',
              pointerEvents: shareToken ? 'none' : 'auto'
            }}
          />
          {shareToken && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', opacity: 0.35, zIndex: 10,
              background: 'repeating-linear-gradient(45deg, transparent, transparent 100px, rgba(255,255,255,0.1) 100px, rgba(255,255,255,0.1) 200px)'
            }}>
               <div style={{
                 transform: 'rotate(-45deg)', fontSize: '8vw', fontWeight: '900',
                 color: 'white', textShadow: '0 0 20px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.8)',
                 whiteSpace: 'nowrap'
               }}>
                 FOTO PROTEGIDA
               </div>
            </div>
          )}`;

appCode = appCode.replace(oldViewer, newViewer);

const galleryGridRegex = /<main className="gallery-grid" style=\{\{ paddingBottom: '16px' \}\}>/;
const newGalleryGrid = `<main 
          className="gallery-grid" 
          style={{ paddingBottom: '16px', userSelect: shareToken ? 'none' : 'auto' }}
          onContextMenu={(e) => { if(shareToken) e.preventDefault(); }}
        >`;
appCode = appCode.replace(galleryGridRegex, newGalleryGrid);

// 3. Ensure global polling works
const oldLoadDashboardRegex = /useEffect\(\(\) => \{\s*let cancelled = false;[\s\S]*?const loadDashboard = async \(\) => \{[\s\S]*?loadDashboard\(\);\s*return \(\) => \{\s*cancelled = true;\s*\};\s*\}, \[\]\);/;

const newLoadDashboard = `useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      try {
        const response = await fetch(\`\${API_BASE_URL}/api/dashboard\`);
        if (!response.ok) return;

        const data = await response.json();
        if (!cancelled) {
          setDashData(data);
          
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

    if (screen === 'dashboard') {
      loadDashboard();
    }
    
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

appCode = appCode.replace(oldLoadDashboardRegex, newLoadDashboard);

// 4. Inject global banner at bottom
const bannerRegex = /      <Toaster notice=\{notice\} \/>\s*<\/div>\s*\);\s*\}\s*$/;
const injectGlobalBanner = `      <Toaster notice={notice} />
      
      {pendingManualSessions.length > 0 && !shareToken && (
        <div style={{
          position: 'fixed', bottom: '20px', left: '20px', right: '20px', 
          background: 'var(--surface-color)', padding: '16px', borderRadius: '12px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.8)', zIndex: 9999,
          border: '2px solid var(--green)'
        }}>
          <h4 style={{ margin: '0 0 10px 0', color: 'var(--green)' }}>💰 Cliente quer pagar no dinheiro!</h4>
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
                    setPendingManualSessions(prev => prev.filter(p => p.id !== sess.id));
                  } catch(e) {}
                }}
              >
                Aprovar & Liberar Fotos
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}`;

if(!appCode.includes('💰 Cliente quer pagar no dinheiro!')) {
  appCode = appCode.replace(bannerRegex, injectGlobalBanner);
}

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', appCode);

console.log('Patch 7 successful');
