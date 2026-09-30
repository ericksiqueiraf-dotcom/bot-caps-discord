const fs = require('fs');

let appCode = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

// 1. Fix global banner
const bannerRegex = /      <Toaster notice=\{notice\} \/>\s*<\/div>\s*\);\s*\}\s*return null;\s*\}/;
const endAppRegex = /  return null;\s*\}/;

const injectGlobalBanner = `  return (
    <>
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
    </>
  );
}`;

if (!appCode.includes('💰 Cliente quer pagar no dinheiro!')) {
  appCode = appCode.replace(endAppRegex, injectGlobalBanner);
}

// 2. Fix anti-print on thumbnails
// We need to move the onClick from <img> to the wrapper <div className="photo-tile">
// And apply pointer-events: none and touch-callout: none to the <img>

const tileRegex = /<div key=\{photo\.id\} className=\{\`photo-tile \$\{isSelected \? 'sel' : ''\}\`\}>([\s\S]*?)<img([\s\S]*?)onClick=\{\(\) => setViewerIndex\(index\)\}([\s\S]*?)\/>/g;

// Wait, the regex might be tricky. Let's do it with a more targeted replacement.

const oldTileHtml = `              <div key={photo.id} className={\`photo-tile \${isSelected ? 'sel' : ''}\`}>
                {isBroken ? (
                  <div className="image-broken-message image-broken-tile">Imagem indisponivel</div>
                ) : (
                  <img
                    src={photo.thumbUrl || photo.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    onClick={() => setViewerIndex(index)}
                    onError={() => markBrokenPhoto(photo.id)}
                  />
                )}`;

const newTileHtml = `              <div 
                key={photo.id} 
                className={\`photo-tile \${isSelected ? 'sel' : ''}\`}
                onClick={() => setViewerIndex(index)}
                style={{ position: 'relative' }}
              >
                {isBroken ? (
                  <div className="image-broken-message image-broken-tile">Imagem indisponivel</div>
                ) : (
                  <>
                    <img
                      src={photo.thumbUrl || photo.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                      onError={() => markBrokenPhoto(photo.id)}
                      style={{
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                        WebkitTouchCallout: 'none',
                        pointerEvents: shareToken ? 'none' : 'auto'
                      }}
                    />
                    {shareToken && (
                      <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        zIndex: 2, pointerEvents: 'none',
                        background: 'repeating-linear-gradient(45deg, transparent, transparent 40px, rgba(255,255,255,0.05) 40px, rgba(255,255,255,0.05) 80px)'
                      }} />
                    )}
                  </>
                )}`;

appCode = appCode.replace(oldTileHtml, newTileHtml);

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', appCode);

console.log('Patch 8 done');
