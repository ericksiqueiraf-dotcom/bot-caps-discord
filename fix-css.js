const fs=require('fs');
const p='C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/index.css';
const c=`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
:root{--blue:#1E90FF;--green:#00C851;--black:#121212;--surface:#1E1E1E;--surface2:#2A2A2A;--white:#FFF;--gray:#9CA3AF;--radius:14px;--gap:16px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{height:100%;background:var(--black);color:var(--white);font-family:'Poppins',sans-serif}
.screen{display:flex;flex-direction:column;min-height:100dvh;max-width:430px;margin:0 auto;background:var(--black);position:relative}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:14px var(--gap);background:var(--surface);border-bottom:1px solid #333;position:sticky;top:0;z-index:30}
.logo{font-size:22px;font-weight:700;display:flex;align-items:center;gap:2px}
.logo-snap{color:#fff}.logo-flow{color:var(--blue)}.logo-bolt{font-size:18px;margin-left:2px}
.topbar-title{font-size:17px;font-weight:600}
.type-select{background:var(--surface2);border:1px solid #444;border-radius:8px;color:#fff;font-family:'Poppins',sans-serif;font-size:13px;padding:6px 8px;cursor:pointer;outline:none;max-width:170px}
.back-btn{background:none;border:none;color:var(--blue);font-size:15px;font-family:'Poppins',sans-serif;cursor:pointer;font-weight:500}
.promo-banner{background:var(--surface2);color:var(--gray);font-size:13px;font-weight:500;text-align:center;padding:8px var(--gap);border-bottom:1px solid #333}
.promo-banner.active{background:#0a2e1a;color:var(--green);border-bottom-color:var(--green)}
.gallery-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;flex:1;padding-bottom:90px}
.photo-tile{position:relative;aspect-ratio:1;cursor:pointer;background:var(--surface);overflow:hidden}
.photo-tile img{width:100%;height:100%;object-fit:cover;display:block}
.photo-tile.sel img{opacity:.65}
.photo-tile.sel::after{content:'';position:absolute;inset:0;background:rgba(0,200,81,.2)}
.tile-check{position:absolute;top:6px;right:6px;background:var(--green);color:#000;font-weight:900;font-size:14px;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;z-index:2;box-shadow:0 2px 6px rgba(0,0,0,.4)}
.bottombar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:430px;background:var(--surface);border-top:1px solid #333;padding:12px var(--gap);display:flex;align-items:center;justify-content:space-between;gap:12px;z-index:20}
.bottombar-info{display:flex;flex-direction:column}
.count-label{font-size:13px;color:var(--gray)}
.total-label{font-size:20px;font-weight:700;color:var(--green)}
.btn-primary{background:var(--green);color:#000;border:none;border-radius:12px;font-family:'Poppins',sans-serif;font-weight:700;font-size:16px;padding:16px 24px;cursor:pointer;white-space:nowrap;min-height:56px}
.btn-primary:active{transform:scale(.97)}
.btn-primary:disabled{opacity:.35;cursor:not-allowed}
.btn-secondary{background:var(--blue);color:#fff;border:none;border-radius:12px;font-family:'Poppins',sans-serif;font-weight:600;font-size:15px;padding:14px var(--gap);cursor:pointer;width:100%;min-height:52px;margin-top:8px}
.btn-ghost{background:none;border:none;color:var(--gray);font-family:'Poppins',sans-serif;font-size:15px;padding:12px;cursor:pointer;width:100%;min-height:48px}
.btn-outline-white{background:transparent;border:2px solid rgba(255,255,255,.3);color:#fff;font-family:'Poppins',sans-serif;font-weight:600;font-size:16px;border-radius:12px;padding:14px var(--gap);cursor:pointer;width:calc(100% - 32px);margin:16px;min-height:52px}
.summary-card{background:var(--surface);border-radius:var(--radius);margin:var(--gap);padding:var(--gap)}
.summary-row{display:flex;justify-content:space-between;align-items:center;padding:12px 0;font-size:15px;border-bottom:1px solid #333}
.summary-row:last-child{border-bottom:none}
.discount-row{color:var(--green)}
.summary-divider{height:1px;background:#444;margin:4px 0}
.total-row{padding-top:16px;border-bottom:none!important}
.total-big{font-size:28px;font-weight:700;color:var(--green)}
.green{color:var(--green)}
.action-stack{display:flex;flex-direction:column;padding:0 var(--gap);gap:4px}
.action-stack .btn-primary{width:100%;text-align:center}
.pixshot-badge{text-align:center;font-size:12px;color:#555;margin-top:auto;padding:16px}
.pixshot-badge span{color:var(--blue);font-weight:600}
.pix-instruction{text-align:center;font-size:14px;color:var(--gray);padding:16px var(--gap) 0}
.qr-box{background:#fff;border-radius:20px;margin:16px var(--gap);padding:24px;display:flex;flex-direction:column;align-items:center;gap:12px}
.qr-code-area{width:220px;height:220px;background:#fff;display:flex;align-items:center;justify-content:center}
.qr-fake{border:3px solid #000;padding:8px;border-radius:4px}
.qr-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;width:140px;height:140px}
.qr-cell{width:100%;height:100%;border-radius:1px}
.qr-cell.on{background:#000}
.pix-total{font-size:26px;font-weight:700;color:var(--green)}
.pix-sub{font-size:13px;color:var(--gray)}
.pix-status{text-align:center;font-size:15px;color:var(--gray);padding:0 var(--gap);display:flex;align-items:center;justify-content:center;gap:8px}
.spinner{animation:spin 2s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.pix-timer{text-align:center;font-size:13px;color:var(--blue);font-weight:600;padding:4px 0 16px}
.confirmed-screen{background:linear-gradient(160deg,#0a2e1a 0%,#121212 60%);align-items:center;padding:60px var(--gap) 32px}
.confirmed-icon{width:90px;height:90px;background:var(--green);border-radius:50%;font-size:44px;color:#000;display:flex;align-items:center;justify-content:center;margin-bottom:20px;box-shadow:0 0 40px rgba(0,200,81,.4)}
.confirmed-title{font-size:24px;font-weight:700;color:#fff;text-align:center}
.confirmed-value{font-size:36px;font-weight:700;color:var(--green);margin:8px 0}
.confirmed-sub{font-size:14px;color:var(--gray);margin-bottom:32px}
.delivery-options{width:100%;display:flex;flex-direction:column;gap:8px;margin-bottom:8px}
.delivery-btn{background:var(--surface);border:1px solid #333;border-radius:var(--radius);color:#fff;font-family:'Poppins',sans-serif;padding:14px var(--gap);display:flex;align-items:center;gap:14px;cursor:pointer;text-align:left;width:100%}
.delivery-btn:active{background:var(--surface2)}
.delivery-btn>span:first-child{font-size:24px}
.delivery-btn strong{display:block;font-size:15px;font-weight:600}
.delivery-btn small{display:block;font-size:12px;color:var(--gray)}
.delivery-btn .arrow{margin-left:auto;font-size:20px;color:var(--gray)}`;
fs.writeFileSync(p,c,'utf8');
console.log('OK');
