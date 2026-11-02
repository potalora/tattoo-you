import React, {memo, useEffect, useState} from 'react';
import {editable, selection} from '../model.js';
import {REGIONS} from '../regions.js';
import {Eye, EyeOff, LockKeyhole, LockKeyholeOpen, ArrowUp, ArrowDown, Crosshair, Focus, Orbit} from 'lucide-react';
import {Button, Field, Select, RangeControl, PreparedCompositionGuidance, closeMenuThen} from './primitives.jsx';

function CompositionPanelView({app, snapshot, instrument = false}) {
  const {workspace, study, ui} = snapshot;
  const actions = app.actions;
  const chosen = selection(study);
  const hasTattoos = study.tattoos.length > 0;
  const items = editable(study);
  const tattoo = items[0] || chosen[0];
  const selectedAsset = chosen.length === 1 ? workspace.assets.find(asset => asset.id === chosen[0].assetId) : null;
  const disabled = ui.blocked || !items.length;
  const canReanchor = snapshot.selection?.canReanchor ?? items.length === 1;
  const hasLocked = chosen.some(layer => layer.locked);
  const lockedCount = chosen.length - items.length;
  const mixedLocks = hasLocked && items.length > 0;
  const name = chosen.length === 1 ? chosen[0].name : chosen.length ? 'Multiple tattoos' : '';
  const selectedId = chosen.length === 1 ? chosen[0].id : null;
  const [nameDraft, setNameDraft] = useState(name);
  useEffect(() => setNameDraft(name), [study.id, selectedId, name]);

  const title = chosen.length === 1 ? chosen[0].name : chosen.length ? `${chosen.length} tattoos selected` : 'Choose a tattoo';
  const summary = chosen.length === 1 && hasLocked
    ? 'Locked in place. Unlock to adjust this tattoo.'
    : chosen.length === 1
    ? `${chosen[0].existing ? 'Existing tattoo' : 'New tattoo'}`
    : chosen.length
    ? `${chosen.length} selected · ${items.length} editable · ${chosen.length - items.length} locked`
    : hasTattoos ? (instrument ? 'Choose a tattoo from the Tattoos tray.' : 'Select a tattoo below to adjust its placement.') : 'Add artwork, choose a body area, then adjust width.';

  const menuAction = closeMenuThen;

  function range(id, label, min, max, step) {
    const value = tattoo?.[id] ?? (id === 'opacity' ? .9 : 0);
    const format = number => id === 'rotation' ? `${number.toFixed(0)}°`
      : id === 'opacity' ? `${Math.round(number * 100)}%`
        : `${number.toFixed(1)} cm${id === 'width' ? ' ≈' : ''}`;
    return <RangeControl key={`${study.id}:${study.selectedIds.join(',')}:${id}`} id={id} label={label} value={value} min={min} max={max} step={step}
      disabled={disabled} format={format} numberScale={id === 'opacity' ? 100 : 1} onChange={next => actions.editTattoo(id, Number(next))}
      onCommit={() => actions.endGesture(id)} />;
  }

  return <section data-surface-content="composition" data-adjustment={ui.adjustmentTool || 'place'}>
    {!hasTattoos && <div className="composition-heading setup-guide"><h2>Try your first placement</h2><p>Start with a body reference and your artwork. Every choice stays editable.</p>
      <ol className="setup-steps">
        <li><Button variant="ghost" disabled={ui.blocked} onClick={() => actions.showSurface('body')}><span>1</span><strong>Choose a reference</strong></Button><p>Body, anatomy and starting proportions.</p></li>
        <li><Button variant="primary" id="browse-art" disabled={ui.blocked} onClick={() => actions.showSurface('artwork')}><span>2</span><strong>Add your artwork</strong></Button><p>A cropped PNG or WebP with a transparent background.</p></li>
        <li><span className="setup-future"><span>3</span><strong>Place and adjust</strong></span><p>Pick a body area, then try the size and angle.</p></li>
      </ol>
    </div>}
    {hasTattoos && <>
    <div data-panel-content="tattoo">
      <PreparedCompositionGuidance app={app} snapshot={snapshot} />
      {!!ui.mappingWarnings?.length && <aside id="mapping-warnings" className="composition-warning" aria-label="Surface mapping limitations">
        <strong>Check surface fit</strong><ul>{ui.mappingWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        <p>Reduce size or move the anchor, then inspect every angle.</p>
      </aside>}
      <div className="panel-intro">
        {selectedAsset && <img className="selection-preview" src={selectedAsset.url} width="48" height="56" alt="" />}
        <div className="selection-description"><h2 id="selection-title" title={title}>{title}</h2>
        <p id="selection-summary">{summary}</p>
        {hasLocked && !items.length && chosen.length === 1 && <p className="locked-size">Width: {chosen[0].width.toFixed(1)} cm (approx.)</p>}
        </div>
        <div className="selection-actions">
          {!instrument && !!chosen.length && <Button variant="secondary" id="selection-detail" aria-label="Detail close-up" title="Detail close-up" aria-pressed={ui.currentView === 'detail'} disabled={ui.blocked || !ui.ready}
            onClick={() => actions.chooseCamera('detail')}><Focus size={17} aria-hidden="true" /><span>Detail</span></Button>}
          <Button variant="ghost" className="selection-lock" id="lock-selection" aria-label="Lock in place" title="Lock in place" hidden={!items.length} disabled={disabled} onClick={() => actions.lockSelection(true)}><LockKeyhole size={18} aria-hidden="true" /></Button>
        </div>
      </div>
      {!mixedLocks && <Button variant="secondary" id="unlock-selection" hidden={!hasLocked} disabled={ui.blocked || !hasLocked} onClick={() => actions.lockSelection(false)}>Unlock to adjust</Button>}
      <div id="tattoo-controls" hidden={!items.length}>
        {instrument && <nav className="adjustment-tools" aria-label="Tattoo adjustment">
          {[['place','Place'],['size','Size'],['rotate','Rotate'],['view','View'],['more','More']].map(([id,label]) => <Button key={id} variant="ghost" aria-pressed={ui.adjustmentTool === id} onClick={() => actions.setAdjustmentTool(id)}>{label}</Button>)}
        </nav>}
        {instrument && <nav className="context-camera" aria-label="Phone camera views">
          <Button variant="secondary" disabled={ui.blocked} aria-pressed={ui.currentView === 'body'} onClick={() => actions.chooseCamera('body')}><Orbit size={16} aria-hidden="true" />Orbit</Button>
          <Button variant="secondary" disabled={ui.blocked} aria-pressed={ui.currentView === 'detail'} onClick={() => actions.chooseCamera('detail')}><Focus size={16} aria-hidden="true" />Detail</Button>
          <Select id="context-camera-angle" aria-label="Phone camera angle" value={['front','side','back'].includes(ui.currentView) ? ui.currentView : 'angle'} disabled={ui.blocked} onValueChange={actions.chooseCamera}
            items={[{value:'angle',label:'Angles',disabled:true},{value:'front',label:'Front'},{value:'side',label:'Side'},{value:'back',label:'Back'}]} />
        </nav>}
        <div className="primary-transforms">
          {[['width', items.length > 1 ? 'Reference width (approx.)' : 'Width (approx.)', .5, 40, .1], ['rotation', 'Rotation', -180, 180, 1]].map(([id, label, min, max, step]) => <div key={id} className="primary-transform" data-tool={id === 'width' ? 'size' : 'rotate'} role="group" aria-label={`${label} adjustment`} aria-describedby={chosen.length > 1 ? 'selection-summary selection-adjustment-scope' : undefined}>
            {range(id, label, min, max, step)}
          </div>)}
        </div>
        <div className="placement-row"><Field label="Body area">
          <Select id="region" aria-label="Body area" value={tattoo?.region || 'leftUpperArm'} disabled={disabled || !canReanchor} onValueChange={actions.setRegion}
            items={[...REGIONS.map(region => ({value: region.id, label: region.label})), {value: 'custom', label: 'Custom · tap on body'}]} />
        </Field>
        <Button id="place-on-body" className="secondary placement-action" aria-label={ui.placing ? 'Stop placing' : 'Place on body'} title={ui.placing ? 'Stop placing (Escape)' : 'Place on body'} disabled={disabled || !canReanchor} aria-pressed={ui.placing} onClick={actions.togglePlace}><Crosshair size={19} aria-hidden="true" /><span>{ui.placing ? 'Stop placing' : 'Place on body'}</span></Button></div>
        {chosen.length > 1 && <p id="selection-adjustment-scope" className="hint group-reference">
          {items.length > 1 ? `Reference design: ${tattoo.name}. Width scales editable designs proportionally; rotation applies the same angle change.` : 'Only the editable tattoo changes.'}
          {' Locked tattoos stay in place.'}{!canReanchor && items.length > 1 && ' Choose one tattoo to change its body area.'}
        </p>}
        {mixedLocks && <Button variant="ghost" className="selection-unlock-inline" id="unlock-selection" disabled={ui.blocked} onClick={() => actions.lockSelection(false)}>Unlock {lockedCount} locked {lockedCount === 1 ? 'tattoo' : 'tattoos'}</Button>}
        <details className="control-details advanced-tattoo" open={instrument && ui.adjustmentTool === 'more' || undefined}>
          <summary>More adjustments</summary>
          <Field label="Tattoo name">
            <input id="layer-name" maxLength="120" value={nameDraft} disabled={ui.blocked || items.length !== 1 || chosen.length !== 1}
              onChange={event => setNameDraft(event.target.value)}
              onBlur={() => { if (!ui.blocked && nameDraft !== name && items.length === 1 && chosen.length === 1) actions.renameLayer(nameDraft); }}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          </Field>
          {range('offsetX', 'Across surface', -20, 20, .1)}
          {range('offsetY', 'Along surface', -20, 20, .1)}
          <div className="nudge" aria-label="Move selected tattoos">
            <Button variant="ghost" data-nudge="-0.5,0" aria-label="Move left half a centimeter" disabled={disabled} onClick={() => actions.nudge(-.5, 0)}>←</Button>
            <Button variant="ghost" data-nudge="0,0.5" aria-label="Move up half a centimeter" disabled={disabled} onClick={() => actions.nudge(0, .5)}>↑</Button>
            <Button variant="ghost" data-nudge="0,-0.5" aria-label="Move down half a centimeter" disabled={disabled} onClick={() => actions.nudge(0, -.5)}>↓</Button>
            <Button variant="ghost" data-nudge="0.5,0" aria-label="Move right half a centimeter" disabled={disabled} onClick={() => actions.nudge(.5, 0)}>→</Button>
            <span>0.5 cm</span>
          </div>
          {range('opacity', 'Ink intensity', .1, 1, .01)}
          <label className="check"><input id="flip" type="checkbox" checked={!!tattoo?.flip} disabled={disabled} onChange={event => actions.setFlip(event.target.checked)} /> Mirror selected artwork</label>
          <p className="hint">Placement is a visual guide.</p>
        </details>
      </div>
    </div>
    {!instrument && <TattooCollection app={app} snapshot={snapshot} inline />}
    </>}
    {!instrument && hasTattoos && <><Button variant="secondary" id="browse-art" disabled={ui.blocked} onClick={() => actions.showSurface('artwork')}>Add artwork</Button>
      <div className="alternative-action"><Button id="save-alternative" disabled={ui.blocked} onClick={actions.saveAlternative}>Save alternative…</Button><p className="hint">Your original study is kept. Try another arrangement in a copy.</p></div></>}
  </section>;
}

export function compositionPanelPropsEqual(previous, next) {
  const a = previous.snapshot, b = next.snapshot;
  return previous.app === next.app && previous.instrument === next.instrument && a.study === b.study &&
    a.workspace.assets === b.workspace.assets &&
    a.ui.blocked === b.ui.blocked && a.ui.placing === b.ui.placing &&
    a.ui.ready === b.ui.ready && a.ui.currentView === b.ui.currentView && a.ui.adjustmentTool === b.ui.adjustmentTool &&
    (a.ui.mappingWarnings || []).length === (b.ui.mappingWarnings || []).length &&
    (a.ui.mappingWarnings || []).every((warning, index) => warning === b.ui.mappingWarnings[index]) &&
    a.selection?.canReanchor === b.selection?.canReanchor &&
    a.runtimeCapabilities?.preparedComposition?.projectId === b.runtimeCapabilities?.preparedComposition?.projectId;
}

export const CompositionPanel = memo(CompositionPanelView, compositionPanelPropsEqual);

export function TattooCollection({app, snapshot, inline = false}) {
  const {workspace, study, ui} = snapshot, actions = app.actions;
  const disabled = ui.blocked || !editable(study).length;
  const menuAction = closeMenuThen;
  return <section data-surface-content="collection">
    {!inline && <><div className="collection-heading"><h2>Tattoos</h2><Button variant="primary" id="collection-add" disabled={ui.blocked} onClick={() => actions.showSurface('artwork')}>Add artwork</Button></div>
    <p className="hint">Choose a tattoo to adjust it. Use checkboxes to select a group.</p></>}
    <details className="control-details study-layers" open={!inline || undefined} data-left-content="layers">
      <summary>Tattoos in this study <span>{study.tattoos.length}</span></summary>
        <details className="layer-menu">
          <summary>Layer actions</summary>
          <div className="layer-menu-content glass-surface">
            <div className="small-actions">
              <Button variant="ghost" id="select-all" disabled={ui.blocked} onClick={event => menuAction(event, actions.selectAll)}>Select all</Button>
              <Button variant="ghost" id="select-none" disabled={ui.blocked} onClick={event => menuAction(event, actions.clearSelection)}>Clear selection</Button>
            </div>
            <div className="layer-tools">
              <Button variant="ghost" id="duplicate-layers" disabled={disabled} onClick={event => menuAction(event, actions.duplicateLayers)}>Duplicate</Button>
              <Button variant="ghost" id="remove-layers" disabled={disabled} onClick={event => menuAction(event, actions.removeLayers)}>Remove</Button>
            </div>
            <p className="hint">Select several tattoos to edit together.</p>
          </div>
        </details>
      <div id="layers" className="layers">
        {study.tattoos.length ? study.tattoos.map((layer, index) => {
          const asset = workspace.assets.find(candidate => candidate.id === layer.assetId);
          const selected = study.selectedIds.includes(layer.id);
          return <div key={layer.id} className={`layer${selected ? ' selected' : ''}${!layer.visible ? ' hidden-layer' : ''}`} data-layer={layer.id}>
            <label className="layer-selection"><img src={asset?.url} width="44" height="44" alt="" /><input type="checkbox" data-select={layer.id} checked={selected} disabled={ui.blocked}
              aria-label={`Select ${layer.name}`} onChange={event => actions.selectLayer(layer.id, event.target.checked)} /></label>
            <div className="layer-description">
              <Button variant="ghost" className="layer-title" title={layer.name} disabled={ui.blocked} onClick={() => actions.focusLayer(layer.id)}>{layer.name}</Button>
              <small>{layer.existing ? 'Existing' : 'New'} · {layer.width.toFixed(1)} cm (approx.){layer.locked ? ' · Locked' : ''}</small>
            </div>
            <div className="layer-actions">
              <Button variant="ghost" data-action="visible" data-id={layer.id} title={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`} aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                disabled={ui.blocked} onClick={() => actions.layerAction(layer.id, 'visible')}>{layer.visible ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}</Button>
              <Button variant="ghost" data-action="locked" data-id={layer.id} title={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`} aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`} disabled={ui.blocked}
                onClick={() => actions.layerAction(layer.id, 'locked')}>{layer.locked ? <LockKeyhole size={16} aria-hidden="true" /> : <LockKeyholeOpen size={16} aria-hidden="true" />}</Button>
              <details className="layer-order"><summary aria-label={`Order ${layer.name}`}>Order</summary><div className="layer-order-actions">
              <Button variant="ghost" data-action="up" data-id={layer.id} aria-label={`Move ${layer.name} up`}
                disabled={ui.blocked || index === 0} onClick={() => actions.layerAction(layer.id, 'up')}><ArrowUp size={16} aria-hidden="true" /></Button>
              <Button variant="ghost" data-action="down" data-id={layer.id} aria-label={`Move ${layer.name} down`}
                disabled={ui.blocked || index === study.tattoos.length - 1} onClick={() => actions.layerAction(layer.id, 'down')}><ArrowDown size={16} aria-hidden="true" /></Button>
              </div></details>
            </div>
          </div>;
        }) : <div className="empty">No tattoos added.<br /><br />Add artwork, choose a body area, then adjust its approximate size.</div>}
      </div>
    </details>
    {!inline && !!study.selectedIds.length && <Button className="collection-adjust" variant="secondary" disabled={ui.blocked} onClick={() => actions.showSurface('composition')}>Adjust {study.selectedIds.length === 1 ? 'selected tattoo' : `${study.selectedIds.length} selected tattoos`}</Button>}
  </section>;
}
