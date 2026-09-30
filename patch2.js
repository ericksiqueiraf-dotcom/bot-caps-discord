const fs = require('fs');
let code = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

const regex = /<header className="topbar">\s*<button className="back-btn" onClick=\{\(\) => setScreen\('dashboard'\)\}>\s*Encerrar\s*<\/button>\s*<\/header>/;

const newHeader = `<header className="topbar">
          <button className="back-btn" onClick={() => setScreen('dashboard')}>
            Encerrar
          </button>
          {shareToken && shareSessionInfo?.expiresAt ? (
            <div style={{ marginLeft: 'auto' }}>
              <ShareCountdown isoDate={shareSessionInfo.expiresAt} />
            </div>
          ) : null}
        </header>`;

code = code.replace(regex, newHeader);

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', code);
