import React, {memo, useState} from 'react';
import {Button} from './primitives.jsx';
import {Plus, Upload} from 'lucide-react';

function ArtworkPanelView({app, snapshot}) {
  const {workspace, ui} = snapshot;
  const actions = app.actions;
  const [dragging, setDragging] = useState(false);
  const query = (ui.artSearch || '').trim().toLocaleLowerCase();
  const assets = workspace.assets.filter(asset => asset.name.toLocaleLowerCase().includes(query));

  async function upload(event) {
    const input = event.currentTarget;
    try { await actions.uploadFiles(input.files); }
    finally { input.value = ''; }
  }

  const importGuidance = <>
    <p className="import-format">Transparent PNG or WebP · up to 20 MB. Use a flat, cropped design with transparency; skin photos need preparation outside tattoo you.</p>
    <label className="check"><input id="import-existing" type="checkbox" checked={!!ui.importExisting} disabled={ui.blocked} aria-describedby={ui.importExisting ? 'import-existing-help' : undefined}
      onChange={event => actions.setImportExisting(event.target.checked)} /> Import as existing tattoos</label>
    <p id="import-existing-help" className="hint" hidden={!ui.importExisting}>Use a flat design. Position and lock it to match the tattoo already on your skin.</p>
  </>;
  const importControls = (
    <div className={`artwork-import${workspace.assets.length ? ' library-import' : ''}`}>
      <label className={`upload${dragging ? ' dragging' : ''}`} id="upload-zone" htmlFor="tattoo-upload"
        onDragOver={event => { event.preventDefault(); if (!ui.blocked) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); if (!ui.blocked) actions.uploadFiles(event.dataTransfer.files); }}>
        <Upload size={17} aria-hidden="true" /><strong>Import artwork</strong>
        <input id="tattoo-upload" type="file" aria-label="Import artwork" accept="image/png,image/webp" multiple disabled={ui.blocked} onChange={upload} />
      </label>
      {workspace.assets.length
        ? <details className="import-guidance"><summary>Formats and existing tattoos</summary>{importGuidance}</details>
        : importGuidance}
    </div>
  );

  return <section data-surface-content="artwork">
    <div data-left-content="library">
      {importControls}
      <div className="library-search">
        <input id="art-search" type="search" placeholder="Find artwork…" aria-label="Search artwork" autoComplete="off"
          value={ui.artSearch || ''} disabled={ui.blocked} onChange={event => actions.setArtSearch(event.target.value)} />
        <span id="art-results" role="status">{assets.length === workspace.assets.length ? `${assets.length} design${assets.length === 1 ? '' : 's'}` : `${assets.length} of ${workspace.assets.length}`}</span>
      </div>
      <div id="artwork" className="artwork">
        {assets.map(asset => <article key={asset.id} className="art-card">
          <Button variant="ghost" className="preview-art" data-preview={asset.id} aria-label={`Preview ${asset.name}`} disabled={ui.blocked}
            onClick={event => actions.previewArtwork(asset.id, event.currentTarget)}>
            <span className="art-paper"><img src={asset.url} width={Number(asset.width) || 200} height={Number(asset.height) || 200} loading="lazy" decoding="async" alt="" /></span>
            <strong title={asset.name}>{asset.name.replace(/\.(png|webp)$/i, '').replace(/[-_]+/g, ' ')}</strong>
          </Button>
          <div className="art-card-actions">
            <Button variant="ghost" className="add-art" data-add={asset.id} aria-label={`Add ${asset.name} to study`} disabled={ui.blocked}
              onClick={() => actions.addArtwork(asset.id)}><Plus size={18} aria-hidden="true" /><span>Add</span></Button>
          </div>
        </article>)}
        {!assets.length && <p className="empty">{workspace.assets.length ? 'No matching artwork. Clear the search to show all designs.' : 'No artwork imported. Import a transparent PNG or WebP.'}</p>}
      </div>
    </div>
  </section>;
}

export function artworkPanelPropsEqual(previous, next) {
  const a = previous.snapshot, b = next.snapshot;
  return previous.app === next.app && a.workspace.assets === b.workspace.assets &&
    a.ui.blocked === b.ui.blocked && a.ui.artSearch === b.ui.artSearch &&
    a.ui.importExisting === b.ui.importExisting;
}

export const ArtworkPanel = memo(ArtworkPanelView, artworkPanelPropsEqual);
