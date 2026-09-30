const fs = require('fs');
let code = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

const regex = /<button\s+className="btn-manual btn-manual-cash"\s+disabled=\{isGeneratingPix \|\| clientPhone\.length < 10\}\s+onClick=\{\(\) => handleManualPayment\('manual'\)\}\s*>\s*Pagamento Dinheiro\/Cartão\s*<\/button>/;

const newButton = `{!shareToken && (
            <button
              className="btn-manual btn-manual-cash"
              disabled={isGeneratingPix || clientPhone.length < 10}
              onClick={() => handleManualPayment('manual')}
            >
              Pagamento Dinheiro/Cartão
            </button>
          )}`;

code = code.replace(regex, newButton);

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', code);
