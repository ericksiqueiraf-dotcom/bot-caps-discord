const fs = require('fs');
const cssPath = 'C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/index.css';
const newCss = `
.tile-check-circle { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 50%; background: rgba(0,0,0,0.3); border: 2px solid rgba(255,255,255,0.8); display: flex; align-items: center; justify-content: center; color: #000; font-weight: 900; font-size: 14px; z-index: 5; cursor: pointer; transition: all 0.2s; }
.tile-check-circle.active { background: var(--green); border-color: var(--green); box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
`;
fs.appendFileSync(cssPath, newCss, 'utf8');
