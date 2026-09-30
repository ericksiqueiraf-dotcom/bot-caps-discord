const fs = require('fs');
let code = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');
code = code.replace(
  '<div className="logo"><span className="logo-snap">Snap</span><span className="logo-flow">Flow</span></div>',
  '<div className="logo"><img src="/logo.png" alt="SnapFlow" style={{ height: "45px", marginLeft: "-10px" }} /></div>'
);
fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', code);
