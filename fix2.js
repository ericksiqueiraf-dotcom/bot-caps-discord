const fs = require('fs');
let code = fs.readFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', 'utf8');

const badDashboardBlock = `          {hasActiveSession ? (
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

const goodDashboardBlock = `          {hasActiveSession ? (
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

code = code.replace(badDashboardBlock, goodDashboardBlock);

const badGalleryBlock = `        <SessionOpsCard
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

        <div className="package-alert compact">
          <span>Pacote em uso:</span>
          <strong>{PRICING[type].label}</strong>
        </div>

        {count > 0 ? (
          <div className={\`promo-banner \${hasDiscount ? 'active' : ''}\`}>
            {hasDiscount
              ? \`Desconto ativo: \${formatMoney(unit)} por foto\`
              : \`Faltam \${remaining} foto(s) para o desconto\`}
          </div>
        ) : null}

        <div className="gallery-toolbar">
          <button className="gallery-toolbar-btn" onClick={toggleAllPhotos}>
            {allPhotosSelected ? 'Limpar seleção' : 'Selecionar tudo'}
          </button>
          <span className="gallery-toolbar-hint">
            {selected.length} de {photos.length} fotos selecionadas
          </span>
        </div>

                </div>`;

const goodGalleryBlock = `        <main className="gallery-grid" style={{ paddingBottom: '16px' }}>
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

code = code.replace(badGalleryBlock, goodGalleryBlock);

fs.writeFileSync('C:/Users/ErickSiqueira/Documents/APP FOTOGRAFIA/src/App.jsx', code);
