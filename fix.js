const fs = require('fs');
let code = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

// 1. Restore the dashboard SessionOpsCard
const badDashboardBlock = `{hasActiveSession ? (
            <main className="gallery-grid">
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

const goodDashboardBlock = `{hasActiveSession ? (
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

// The gallery block that was accidentally ripped out
const galleryBlock = `        <main className="gallery-grid">
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
        </main>`;

if (code.includes(badDashboardBlock)) {
    code = code.replace(badDashboardBlock, goodDashboardBlock);
    
    // Now we must inject the gallery logic back into the 'gallery' screen.
    // The gallery screen currently looks like this (missing the main grid):
    /*
        <div className="gallery-toolbar">
          <button className="gallery-toolbar-btn" onClick={toggleAllPhotos}>
            {allPhotosSelected ? 'Limpar seleção' : 'Selecionar tudo'}
          </button>
          <span className="gallery-toolbar-hint">
            {selected.length} de {photos.length} fotos selecionadas
          </span>
        </div>

        <div className="info-bottom-area" style={{ padding: '0 16px 100px 16px' }}>
    */
    // Wait, my script did NOT put it below the gallery screen, it just cut it out completely and pasted in dashboard!
    // So the gallery screen is missing the <main className="gallery-grid">.
    // And it has NO info-bottom-area because the info-bottom-area injection failed or put it somewhere else.
    // Let's just fix the gallery screen correctly.
} else {
    console.log('Bad dashboard block not found exactly as expected. Trying regex.');
}

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/BOT CAPS DISCORD/app_debug.txt', code);
