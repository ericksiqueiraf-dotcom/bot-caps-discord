const fs = require('fs');
const cssPath = 'C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/index.css';

const newCss = `
/* ── DASHBOARD FOTÓGRAFO ──────────────────────────────────────────── */
.dashboard-screen {
  background: var(--black);
}
.dash-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px var(--gap); border-bottom: 1px solid #333;
}
.user-avatar {
  background: var(--surface2); width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; font-size: 16px;
}
.dash-main { padding: 20px var(--gap); flex: 1; overflow-y: auto; }
.period-tabs {
  display: flex; gap: 8px; margin-bottom: 24px;
}
.period-tabs button {
  flex: 1; background: var(--surface); border: 1px solid #333; color: var(--gray);
  padding: 10px 0; border-radius: 8px; font-family: 'Poppins', sans-serif;
  font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;
}
.period-tabs button.active {
  background: rgba(30, 144, 255, 0.15); border-color: var(--blue); color: var(--blue);
}
.stats-card {
  background: var(--surface); padding: 24px; border-radius: var(--radius);
  text-align: center; border: 1px solid #333; margin-bottom: 32px;
}
.stats-title { font-size: 14px; color: var(--gray); font-weight: 500; }
.stats-value { font-size: 38px; color: var(--green); font-weight: 700; margin: 8px 0; }
.stats-subtitle { font-size: 13px; color: var(--gray); }

.recent-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
}
.recent-header h3 { font-size: 16px; font-weight: 600; color: #fff; }
.recent-header span { font-size: 13px; color: var(--blue); cursor: pointer; }

.session-item {
  display: flex; align-items: center; background: var(--surface);
  padding: 16px; border-radius: 12px; margin-bottom: 10px; border: 1px solid #333;
}
.session-avatar {
  width: 44px; height: 44px; background: var(--surface2); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 600; font-size: 14px; color: #fff; margin-right: 12px;
}
.session-info { flex: 1; display: flex; flex-direction: column; }
.session-info strong { font-size: 15px; font-weight: 600; color: #fff; }
.session-info small { font-size: 12px; color: var(--gray); margin-top: 2px; }

.session-status { text-align: right; display: flex; flex-direction: column; align-items: flex-end; }
.badge { font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; text-transform: uppercase; margin-bottom: 4px; }
.badge-green { background: rgba(0, 200, 81, 0.2); color: var(--green); }
.badge-blue { background: rgba(30, 144, 255, 0.2); color: var(--blue); }

.dash-bottom {
  padding: 16px var(--gap); background: var(--surface); border-top: 1px solid #333;
}

/* ── WATERMARK ────────────────────────────────────────────────────── */
.watermark::before {
  content: 'SnapFlow';
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(-30deg);
  font-size: 26px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.45);
  font-family: 'Poppins', sans-serif;
  text-shadow: 0 2px 8px rgba(0,0,0,0.8);
  pointer-events: none;
  z-index: 10;
  white-space: nowrap;
}
`;

fs.appendFileSync(cssPath, newCss, 'utf8');
console.log('CSS adicionado com sucesso!');
