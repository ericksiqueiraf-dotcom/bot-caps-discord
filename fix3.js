const fs = require('fs');
let code = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

// The exact string to replace in dashboard
const dStart = code.indexOf('{hasActiveSession ? (\n            <main className="gallery-grid">');
const dEnd = code.indexOf(') : null}', dStart) + 9;

if (dStart !== -1 && dEnd !== -1) {
    const goodDashboard = `{hasActiveSession ? (
            <SessionOpsCard
              title="Sessao atual"
              stage={activeStage}
              count={count}
              total={total}
              phone={clientPhone}
              packageType={type}
              paymentMethod={liveOps.paymentMethod}
              paymentStatus={liveOps.paymentStatus}
              deliveryStatus={liveOps.deliveryStatus}
              deliveryError={liveOps.deliveryError}
            />
          ) : null}`;
    code = code.substring(0, dStart) + goodDashboard + code.substring(dEnd);
    console.log('Fixed dashboard!');
} else {
    console.log('Could not find dashboard block', dStart, dEnd);
}

const gStart = code.indexOf('<SessionOpsCard\n          title="Sessao atual"');
const gEnd = code.indexOf('</div>', code.indexOf('<span className="gallery-toolbar-hint">')) + 6;

if (gStart !== -1 && gEnd !== -1 && gStart > dEnd) {
    const goodGallery = `<main className="gallery-grid" style={{ paddingBottom: '16px' }}>
          {photos.map((photo, index) => {
            const isSelected = selected.includes(photo.id);
            const isBroken = brokenPhotoIds.includes(photo.id);

            return (
              <div key={photo.id} className={\`photo-tile \${isSelected ? 'sel' : ''}\`}>
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
                )}
                <div
                  className={\`tile-check-circle \${isSelected ? 'active' : ''}\`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(photo.id);
                  }}
                >
                  {isSelected ? '●' : ''}
                </div>
              </div>
            );
          })}
        </main>

        <div className="info-bottom-area" style={{ padding: '0 16px 100px 16px' }}>
          <div className="gallery-toolbar" style={{ marginBottom: '16px' }}>
            <button className="gallery-toolbar-btn" onClick={toggleAllPhotos}>
              {allPhotosSelected ? 'Limpar seleção' : 'Selecionar tudo'}
            </button>
            <span className="gallery-toolbar-hint">
              {selected.length} de {photos.length} fotos selecionadas
            </span>
          </div>

          {count > 0 ? (
            <div className={\`promo-banner \${hasDiscount ? 'active' : ''}\`} style={{ borderRadius: '8px', marginBottom: '8px' }}>
              {hasDiscount
                ? \`Desconto ativo: \${formatMoney(unit)} por foto\`
                : \`Faltam \${remaining} foto(s) para o desconto\`}
            </div>
          ) : null}

          <div className="package-alert compact" style={{ marginBottom: '16px' }}>
            <span>Pacote em uso:</span>
            <strong>{PRICING[type].label}</strong>
          </div>

          <SessionOpsCard
            title="Sessao atual"
            stage={activeStage}
            count={count}
            total={total}
            phone={clientPhone}
            packageType={type}
            paymentMethod={liveOps.paymentMethod}
            paymentStatus={liveOps.paymentStatus}
            deliveryStatus={liveOps.deliveryStatus}
            deliveryError={liveOps.deliveryError}
          />
        </div>`;
    
    code = code.substring(0, gStart) + goodGallery + code.substring(gEnd);
    console.log('Fixed gallery!');
} else {
    console.log('Could not find gallery block', gStart, gEnd);
}

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', code);
