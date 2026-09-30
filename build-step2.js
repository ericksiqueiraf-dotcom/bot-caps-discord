const fs = require('fs');

const appJsx = `import React, { useState } from 'react';
import './index.css';

const PHOTOS = Array.from({ length: 18 }).map((_, i) => ({
  id: \`p\${i}\`,
  url: \`https://picsum.photos/seed/\${i + 30}/1000/1000\`, // Aumentei a resolucao base do placeholder
}));

const DASHBOARD_STATS = {
  hoje: { valor: 1250, fotos: 115, sessoes: 12 },
  semana: { valor: 5400, fotos: 480, sessoes: 54 },
  mes: { valor: 15200, fotos: 1400, sessoes: 145 }
};

const RECENT_SESSIONS = [
  { id: 12, name: 'Cliente #012', time: '16:30', status: 'pago', total: 200 },
  { id: 11, name: 'Cliente #011', time: '15:10', status: 'pago', total: 150 },
  { id: 10, name: 'Cliente #010', time: '14:20', status: 'aberta', count: 12 }
];

const PRICING = {
  turismo:   { unit: 15, bulk: 10, threshold: 5 },
  corporate: { unit: 15, bulk: 10, threshold: 3 },
};

function calcTotal(count, type) {
  const p = PRICING[type];
  const unit = count >= p.threshold ? p.bulk : p.unit;
  return { unit, total: count * unit };
}

export default function App() {
  const [screen, setScreen]     = useState('dashboard');
  const [type, setType]         = useState('turismo');
  const [selected, setSelected] = useState([]);
  const [timer]                 = useState('04:59'); // tempo de sessao
  const [period, setPeriod]     = useState('hoje');
  
  // Controle do Carrossel de Fotos
  const [viewerIndex, setViewerIndex] = useState(null);

  const toggle = (id) =>
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  const startNewSession = () => {
    setSelected([]);
    setScreen('gallery');
  };

  const count = selected.length;
  const { unit, total } = calcTotal(count, type);
  const p = PRICING[type];
  const remaining = Math.max(0, p.threshold - count);
  const hasDiscount = count >= p.threshold;

  const fmt = (v) => \`R$\\u00a0\${v.toFixed(2).replace('.', ',')}\`;

  // ── VISUALIZADOR TELA CHEIA (CARROSSEL) ─────────────────────────
  if (viewerIndex !== null) {
    const currentPhoto = PHOTOS[viewerIndex];
    const isSelected = selected.includes(currentPhoto.id);
    
    const handlePrev = () => setViewerIndex(prev => prev > 0 ? prev - 1 : PHOTOS.length - 1);
    const handleNext = () => setViewerIndex(prev => prev < PHOTOS.length - 1 ? prev + 1 : 0);

    return (
      <div className="viewer-screen">
        <header className="viewer-topbar">
          <button className="viewer-close" onClick={() => setViewerIndex(null)}>✕ Voltar</button>
          
          <div className="viewer-cart-preview">
            <span className="cart-count">🛒 {count} fotos</span>
            <strong className="cart-total">{fmt(total)}</strong>
          </div>
        </header>

        <div className="viewer-body">
          {/* Seta esquerda invisible hit area */}
          <div className="viewer-nav left" onClick={handlePrev}>
            <div className="nav-btn">‹</div>
          </div>
          
          <div className="viewer-image-container">
            {!isSelected && <div className="watermark-fullscreen">SnapFlow</div>}
            <img src={currentPhoto.url} alt="Visualização" />
          </div>

          {/* Seta direita invisible hit area */}
          <div className="viewer-nav right" onClick={handleNext}>
            <div className="nav-btn">›</div>
          </div>
        </div>

        <footer className="viewer-bottom">
          <button 
            className={\`btn-giant \${isSelected ? 'btn-remove' : 'btn-add'}\`} 
            onClick={() => toggle(currentPhoto.id)}
          >
            {isSelected ? '✓ OTIMA! REMOVER DA SACOLA' : '+ ADICIONAR ESTA FOTO ALTA QUALIDADE'}
          </button>
        </footer>
      </div>
    );
  }

  // ── TELA 0 — DASHBOARD ──────────────────────────────────────────
  if (screen === 'dashboard') {
    const stats = DASHBOARD_STATS[period];
    return (
      <div className="screen dashboard-screen">
        <header className="dash-header">
          <div className="logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--blue)", marginRight: "6px" }}>
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
              <path d="M13 9l-4 5h2v4l4-5h-2V9z" stroke="none" fill="var(--blue)"/>
            </svg>
            <span className="logo-snap">Snap</span><span className="logo-flow">Flow</span>
          </div>
        </header>

        <main className="dash-main">
          <div className="period-tabs">
             <button className={period === 'hoje' ? 'active' : ''} onClick={() => setPeriod('hoje')}>Hoje</button>
             <button className={period === 'semana' ? 'active' : ''} onClick={() => setPeriod('semana')}>Semana</button>
             <button className={period === 'mes' ? 'active' : ''} onClick={() => setPeriod('mes')}>Mês</button>
          </div>

          <div className="stats-card">
             <div className="stats-title">Vendas ({period})</div>
             <div className="stats-value">{fmt(stats.valor)}</div>
             <div className="stats-subtitle">{stats.sessoes} sessões • {stats.fotos} fotos vendidas</div>
          </div>

          <div className="recent-sessions">
             <div className="recent-header">
                <h3>Sessões recentes</h3>
             </div>
             {RECENT_SESSIONS.map(s => (
               <div key={s.id} className="session-item">
                  <div className="session-avatar">S{s.id}</div>
                  <div className="session-info">
                     <strong>{s.name}</strong>
                     <small>{s.time}</small>
                  </div>
                  <div className="session-status">
                     {s.status === 'pago' ? (
                       <><span className="badge badge-green">Paga</span><strong className="green">{fmt(s.total)}</strong></>
                     ) : (
                       <><span className="badge badge-blue">Aberta</span><small>{s.count} fotos</small></>
                     )}
                  </div>
               </div>
             ))}
          </div>
        </main>
        <div className="dash-bottom">
           <button className="btn-primary" style={{width:'100%', marginBottom:'16px'}} onClick={startNewSession}>
             + Criar Sessão Cliente
           </button>
        </div>
      </div>
    );
  }

  // ── TELA 1 — GALERIA ──────────────────────────────────────────────
  if (screen === 'gallery') return (
    <div className="screen">
      <header className="topbar">
        <button className="back-btn" onClick={() => setScreen('dashboard')}>✕ Encerrar</button>
        <select className="type-select" value={type} onChange={e => setType(e.target.value)}>
          <option value="turismo">🌍 Turismo</option>
          <option value="corporate">🏫 Escolar/Corp</option>
        </select>
      </header>

      {count > 0 && (
        <div className={\`promo-banner \${hasDiscount ? 'active' : ''}\`}>
          {hasDiscount
            ? \`✅ Desconto ativo — \${fmt(unit)} por foto\`
            : \`+\${remaining} foto(s) para \${fmt(p.bulk)} cada\`}
        </div>
      )}

      <main className="gallery-grid">
        {PHOTOS.map((ph, index) => {
          const sel = selected.includes(ph.id);
          return (
            <div key={ph.id} className={\`photo-tile \${sel ? 'sel' : 'watermark'}\`} onClick={() => setViewerIndex(index)}>
              <img src={ph.url} alt="" loading="lazy" />
              {sel && <div className="tile-check">✔</div>}
            </div>
          );
        })}
      </main>

      <footer className="bottombar">
        <div className="bottombar-info">
          <span className="count-label">{count} foto(s)</span>
          <span className="total-label">{fmt(total)}</span>
        </div>
        <button
          className="btn-primary"
          disabled={count === 0}
          onClick={() => setScreen('summary')}
        >
          Finalizar Pedido →
        </button>
      </footer>
    </div>
  );

  // ── TELA 2 — RESUMO ───────────────────────────────────────────────
  if (screen === 'summary') return (
    <div className="screen center-screen">
      <header className="topbar">
        <button className="back-btn" onClick={() => setScreen('gallery')}>← Voltar Editar</button>
        <span className="topbar-title">Cobrança Final</span>
        <span />
      </header>
      <div className="summary-card">
        <div className="summary-row"><span>Fotos</span><strong>{count} fotos originais</strong></div>
        <div className="summary-row"><span>Preço / foto</span><strong>{fmt(unit)}</strong></div>
        {hasDiscount && (
          <div className="summary-row discount-row"><span>Desconto</span><strong>-{fmt((p.unit - unit) * count)}</strong></div>
        )}
        <div className="summary-divider" />
        <div className="summary-row total-row"><span>Total</span><strong className="total-big">{fmt(total)}</strong></div>
      </div>
      <div className="action-stack">
        <button className="btn-primary" onClick={() => setScreen('pix')}>🔳 Gerar Pix Agora</button>
      </div>
    </div>
  );

  // ── TELA 3 — PIX ─────────────────────────────────────────────────
  if (screen === 'pix') return (
    <div className="screen center-screen">
      <header className="topbar">
        <button className="back-btn" onClick={() => setScreen('summary')}>← Voltar</button>
        <span className="topbar-title">Pagamento</span>
        <span />
      </header>
      <div className="qr-box">
        <div className="qr-code-area">
          <div className="qr-fake">
            <div className="qr-grid">
              {Array.from({length:49}).map((_,i)=>(<div key={i} className={\`qr-cell \${Math.random()>0.5?'on':''}\`} />))}
            </div>
          </div>
        </div>
        <div className="pix-total">{fmt(total)}</div>
        <div className="pix-sub">{count} foto(s) sem marca d'água</div>
      </div>
      <div className="pix-status"><span className="spinner">⏳</span> Aguardando escaneamento...</div>
      <button className="btn-secondary" onClick={() => setScreen('confirmed')} style={{margin:'20px 16px', width:'calc(100% - 32px)'}}>
        ✅ (SIMULAR APROVAÇÃO WEBOOK)
      </button>
    </div>
  );

  // ── TELA 4 — CONFIRMADO ──────────────────────────────────────────
  if (screen === 'confirmed') return (
    <div className="screen confirmed-screen">
      <div className="confirmed-icon">✔</div>
      <h1 className="confirmed-title">Pix Aprovado!</h1>
      <p className="confirmed-sub" style={{color:'#00C851', marginBottom:'30px'}}>Fotos sendo enviadas em Arquivo Original (sem perda de qualidade)...</p>

      <div className="delivery-options">
        <button className="delivery-btn" style={{borderColor:'#25D366'}}>
          <span>💬</span>
          <div>
            <strong style={{color:'#25D366'}}>WhatsApp (Ação Automática API)</strong>
            <small>Fotos enviadas como *Documento*</small>
          </div>
        </button>
        <button className="delivery-btn">
          <span>🔗</span>
          <div><strong>Acesso Secundário</strong><small>Link na nuvem</small></div>
        </button>
      </div>

      <button className="btn-outline-white" style={{marginTop:'30px'}} onClick={() => { setSelected([]); setScreen('dashboard'); }}>
        Voltar e Atender Próximo
      </button>
    </div>
  );
}
`;

const cssAppends = \`
/* ── VISUALIZADOR CARROSSEL ───────────────────────────────────────── */
.viewer-screen {
  position: fixed; inset: 0; z-index: 100;
  background: var(--black);
  display: flex; flex-direction: column;
}
.viewer-topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px var(--gap); background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
}
.viewer-close {
  background: rgba(255,255,255,0.15); border: none; color: white; padding: 8px 16px; border-radius: 20px; font-weight: 600; cursor: pointer;
}
.viewer-cart-preview {
  display: flex; flex-direction: column; align-items: flex-end;
}
.cart-count { font-size: 11px; color: var(--gray); text-transform: uppercase; font-weight: 700; }
.cart-total { font-size: 16px; color: var(--green); font-weight: 700; }

.viewer-body {
  flex: 1; display: flex; position: relative; overflow: hidden;
}
.viewer-image-container {
  flex: 1; display: flex; align-items: center; justify-content: center; position: relative;
}
.viewer-image-container img {
  max-width: 100%; max-height: 100%; object-fit: contain;
}
.watermark-fullscreen {
  position: absolute; font-size: 40px; font-weight: 800; color: rgba(255,255,255,0.4);
  font-family: 'Poppins', sans-serif; transform: rotate(-30deg); text-shadow: 0 4px 12px rgba(0,0,0,0.8); pointer-events: none; z-index: 5;
}

.viewer-nav {
  position: absolute; top: 0; bottom: 0; width: 30%; cursor: pointer;
  display: flex; align-items: center; z-index: 10;
}
.viewer-nav.left { left: 0; justify-content: flex-start; padding-left: 10px; }
.viewer-nav.right { right: 0; justify-content: flex-end; padding-right: 10px; }
.nav-btn {
  width: 44px; height: 44px; border-radius: 50%; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: 300; backdrop-filter: blur(4px); pointer-events: none;
}

.viewer-bottom {
  padding: 16px var(--gap) 32px; background: rgba(0,0,0,0.7);
}
.btn-giant {
  width: 100%; padding: 20px; border-radius: 16px; font-size: 16px; font-weight: 700; text-align: center; border: none; cursor: pointer; transition: transform 0.1s;
}
.btn-giant:active { transform: scale(0.96); }
.btn-add { background: var(--green); color: #000; }
.btn-remove { background: var(--surface2); color: var(--gray); border: 2px solid #444; }
\`;

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', appJsx, 'utf8');
fs.appendFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/index.css', cssAppends, 'utf8');
console.log('Update Complete!');
