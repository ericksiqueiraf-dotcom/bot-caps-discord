const fs = require('fs');
let code = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

// 1. Invert gallery layout
const invertStart = code.indexOf('<SessionOpsCard');
const invertEnd = code.indexOf('<main className="gallery-grid">');
if (invertStart !== -1 && invertEnd !== -1 && invertStart < invertEnd) {
    const blockToMove = code.substring(invertStart, invertEnd);
    code = code.substring(0, invertStart) + code.substring(invertEnd);
    const mainEnd = code.indexOf('</main>') + '</main>'.length;
    code = code.substring(0, mainEnd) + '\n\n        <div className="info-bottom-area" style={{ padding: \'0 16px 100px 16px\' }}>\n' + blockToMove + '        </div>\n' + code.substring(mainEnd);
}

// 2. Fix Viewer Capsule
code = code.replace(/<button className="viewer-nav left"[\s\S]*?<\/button>/, `<div onClick={handlePrev} style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.1)', borderRadius: '50%', color: 'white', fontSize: '24px', cursor: 'pointer', zIndex: 10, flexShrink: 0 }}>&#8249;</div>`);
code = code.replace(/<button className="viewer-nav right"[\s\S]*?<\/button>/, `<div onClick={handleNext} style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.1)', borderRadius: '50%', color: 'white', fontSize: '24px', cursor: 'pointer', zIndex: 10, flexShrink: 0 }}>&#8250;</div>`);

code = code.replace(/<div className="viewer-body">/, `<div className="viewer-body" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', overflow: 'hidden' }}>`);

code = code.replace(/<div className=\{\`viewer-image-container \$\{currentPhotoBroken \? 'image-broken-frame' : ''\}\`\}>/, `<div className={\`viewer-image-container \${currentPhotoBroken ? 'image-broken-frame' : ''}\`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 10px' }}>`);

code = code.replace(/<img\s+src=\{currentPhoto\.url\}[\s\S]*?\/>/, `<img src={currentPhoto.url} alt="Foto selecionada" onError={() => markBrokenPhoto(currentPhoto.id)} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />`);

// 3. Fix ShareCountdown colors
const regexShareCountdown = /function ShareCountdown\(\{\s*isoDate\s*\}\)\s*\{[\s\S]*?return\s*<>\s*\{formatRemainingCountdown\(isoDate, now\)\}\s*<\/>;\s*\}/;
const newShareCountdown = `function ShareCountdown({ isoDate }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiresAt = new Date(isoDate).getTime();
  const diffMs = Math.max(0, expiresAt - now);
  const totalMinutes = Math.floor(diffMs / 60000);
  
  let color = '#00C851';
  if (totalMinutes <= 15) color = '#ffbb33';
  if (totalMinutes <= 10) color = '#ff4444';
  if (diffMs <= 0) color = '#888';

  return <span style={{ color, fontWeight: 'bold', fontSize: '1.2em', padding: '4px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', border: \`1px solid \${color}\`, display: 'inline-block' }}>{formatRemainingCountdown(isoDate, now)}</span>;
}`;
code = code.replace(regexShareCountdown, newShareCountdown);

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', code);
