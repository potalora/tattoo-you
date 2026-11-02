import React, {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {animate, motion, useMotionValue} from 'motion/react';
import {StudioMotionProvider, useStudioReducedMotion, useStudioCompact, UI_SPRING} from './motion.jsx';
import {sheetDragHeight, sheetSnapState} from './sheet-gesture.js';
import {CompositionPanel, TattooCollection} from './composition-panel.jsx';
import {JourneyDialogs} from './journey-panels.jsx';
import {ArtworkPanel} from './artwork-panel.jsx';
import {BodyPanel} from './body-panel.jsx';
import {ArtworkPreview} from './artwork-preview.jsx';
import {Undo2, Redo2, Download, Check, Clock3, CircleAlert, Ellipsis, Orbit, Focus, UserRound, MoveHorizontal, RotateCcw, Columns2, Plus} from 'lucide-react';
import {Button, Select, Dialog, DialogContent, DialogTitle, DialogDescription, closeMenuThen} from './primitives.jsx';
import {bindStudyMenuDismissal} from './study-menu.js';

export function Header({app, snapshot, headerRef, studyRef, instrument = false}) {
  const {ui} = snapshot, a = app.actions;
  return <header ref={headerRef} className="masthead">
    {instrument && <div className="instrument-brand"><span>tattoo you</span><small>placement studio</small></div>}
    <StudyCard app={app} snapshot={snapshot} studyRef={studyRef} />
    {!instrument && <div className="studio-wordmark">tattoo you</div>}
    <div className="header-right">
      {instrument && <div className="instrument-history" aria-label="Edit history">
        <Button variant="ghost" id="instrument-undo" aria-label="Undo" title="Undo (⌘Z)" disabled={ui.blocked || !ui.canUndo} onClick={a.undo}><Undo2 size={18} aria-hidden="true" /></Button>
        <Button variant="ghost" id="instrument-redo" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={ui.blocked || !ui.canRedo} onClick={a.redo}><Redo2 size={18} aria-hidden="true" /></Button>
      </div>}
      {instrument && <Button variant="secondary" id="compare-studies" aria-label="Compare studies" title="Compare placements" disabled={ui.blocked || !ui.ready || !snapshot.study?.tattoos.length} onClick={a.openComparison}><Columns2 size={18} aria-hidden="true" /><span>Compare</span></Button>}
      <Button variant="ghost" id="save-image" className="save-image" aria-label={instrument ? 'Review reference' : 'Export image'} title={instrument ? 'Review and download a reference' : 'Download a reference image'} disabled={ui.blocked || !ui.ready || (instrument && !snapshot.study?.tattoos.length)} onClick={instrument ? a.reviewReference : a.saveImage}>
        <Download size={16} aria-hidden="true" /><span className="save-label-wide">{ui.reviewBusy ? 'Preparing…' : instrument ? 'Reference' : 'Export image'}</span><span className="save-label-compact" aria-hidden="true">{instrument ? 'Reference' : 'Export'}</span>
      </Button>
    </div>
  </header>;
}

export function StudyCard({app, snapshot, studyRef}) {
  const {study, workspace, ui} = snapshot, a = app.actions;
  const menu = closeMenuThen;
  const saveState = ui.saveError || ui.saveFailure ? 'error' : /^Saved(?: |$)/.test(ui.saveLabel) ? 'saved' : 'pending';
  const SaveIcon = saveState === 'error' ? CircleAlert : saveState === 'saved' ? Check : Clock3;
  return <section ref={studyRef} className="study-card glass-surface" aria-label="Current study">
    <div className="study-picker"><Select id="project-select" aria-label="Current study" title={study?.name} value={study?.id || ''} disabled={ui.blocked}
      onValueChange={a.switchProject} items={(workspace?.projects || []).map(p => ({value: p.id, label: p.name}))} /></div>
    <div className="study-save" data-save-state={saveState} role="status" title={ui.saveLabel} style={saveState === 'error' ? {color: 'var(--danger)'} : undefined}><SaveIcon size={14} aria-hidden="true" /><span id="save-status" className="sr-only">{ui.saveLabel}</span><span className="save-status-short" aria-hidden="true">{saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Unsaved' : 'Saving…'}</span><span className="storage-scope">{ui.storageMode === 'browser' || /this browser/.test(ui.saveLabel || '') ? 'This browser' : 'Shared workspace'}</span>
    </div>
    <details ref={bindStudyMenuDismissal} className="project-menu"><summary aria-label="Study actions"><Ellipsis size={20} aria-hidden="true" /></summary>
      <div className="project-actions glass-surface">
        <Button variant="ghost" id="new-project" disabled={ui.blocked} onClick={e => menu(e, a.newProject)}>New study</Button>
        <Button variant="ghost" id="rename-project" disabled={ui.blocked} onClick={e => menu(e, a.renameProject)}>Rename</Button>
        <Button variant="ghost" id="duplicate-project" disabled={ui.blocked} onClick={e => menu(e, a.saveAlternative)}>Save alternative…</Button>
        <Button variant="ghost" id="direct-export" disabled={ui.blocked || !study?.tattoos.length} onClick={e => menu(e, a.saveImage)}>Download PNG now</Button>
        <Button variant="ghost" id="notes-open" disabled={ui.blocked} onClick={e => menu(e, () => a.openDialog('notes'))}>Notes…</Button>
        <div className="menu-history" hidden={!ui.canUndo && !ui.canRedo}>
          <Button variant="ghost" id="undo" disabled={ui.blocked || !ui.canUndo} title="Undo (⌘Z)" onClick={e => menu(e, a.undo)}><Undo2 size={16} aria-hidden="true" />Undo</Button>
          <Button variant="ghost" id="redo" disabled={ui.blocked || !ui.canRedo} title="Redo (⇧⌘Z)" onClick={e => menu(e, a.redo)}><Redo2 size={16} aria-hidden="true" />Redo</Button>
        </div>
        <div className="menu-divider" />
        <Button variant="ghost" id="help-open" onClick={e => menu(e, () => a.openDialog('help'))}>Help and shortcuts</Button>
        <Button variant="ghost" id="data-open" onClick={e => menu(e, () => a.openDialog('data'))}>Backup or move device…</Button>
        <Button variant="destructive" id="delete-project" disabled={ui.blocked} onClick={e => menu(e, a.deleteProject)}>Delete study</Button>
      </div>
    </details>
    <div className="save-recovery" hidden={!ui.saveFailure && ui.retry.hidden}>
      <div className="save-recovery-copy" role="status"><strong>Unsaved changes</strong><p>{ui.saveFailure || ui.saveLabel}</p></div>
      <Button variant="secondary" id="retry-save" hidden={ui.retry.hidden} disabled={ui.dataBlocked} onClick={a.retrySave}>{ui.retry.text}</Button>
    </div>
  </section>;
}

export function CameraDock({app, snapshot, dockRef, dockGroupRef, statusRef}) {
  const {ui} = snapshot, a = app.actions;
  const instrument = ui.presentation === 'instrument';
  const compact = useStudioCompact(), reduce = useStudioReducedMotion(), expanded = compact && ui.panelState === 'expanded';
  const contextual = compact && instrument && ui.surface === 'composition' && snapshot.selection?.editableCount > 0 && ui.panelState !== 'collapsed';
  const hideCamera = expanded || contextual || (compact && ui.placing);
  const statusText = ui.placing ? 'Tap visible skin to place this tattoo.' : ui.previewError ? 'Preview unavailable. Try again to reload the preview.' : ui.saveFailure && ui.status === ui.saveFailure ? '' : ui.status;
  const idle = !ui.placing && /^Drag to orbit/.test(statusText || '');
  const camera = (name, label, Icon) => <Button key={name} variant="ghost" data-camera={name} aria-pressed={ui.currentView === name}
    disabled={ui.blocked || !ui.ready} onClick={() => a.chooseCamera(name)}><Icon size={17} aria-hidden="true" /><span>{label}</span></Button>;
  return <div className="stage-bottom" ref={dockGroupRef} data-placing={ui.placing ? 'true' : undefined} data-contextual={contextual ? 'true' : undefined}>
    <p id="status" ref={statusRef} className="glass-surface" role="status" data-idle={idle} hidden={!statusText}><span>{statusText}</span>{ui.placing && <Button variant="secondary" id="stage-stop-placing" className="stage-stop-placing" onClick={a.stopPlacing}>Stop placing</Button>}</p>
    <motion.div className="stage-toolbar" initial={false} inert={hideCamera || undefined} aria-hidden={hideCamera || undefined}
      animate={{height: compact ? hideCamera ? 0 : 56 : 'auto', opacity: hideCamera ? 0 : 1}}
      transition={reduce || !compact ? {duration: 0} : UI_SPRING}
      style={{pointerEvents: hideCamera ? 'none' : undefined, overflow: compact ? 'hidden' : undefined}}>
      <nav className="camera-bar glass-surface" ref={dockRef} aria-label="Camera views">
      {camera('body', 'Orbit', Orbit)}{camera('detail', 'Detail', Focus)}{instrument ? <Select id="camera-angle" aria-label="Camera angle" value={['front','side','back'].includes(ui.currentView) ? ui.currentView : 'angle'} disabled={ui.blocked || !ui.ready} onValueChange={a.chooseCamera} items={[{value:'angle',label:'Angles',disabled:true},{value:'front',label:'Front'},{value:'side',label:'Side'},{value:'back',label:'Back'}]} /> : <>{camera('front', 'Front', UserRound)}{camera('side', 'Side', MoveHorizontal)}{camera('back', 'Back', RotateCcw)}</>}
    </nav></motion.div>
    <p className="interaction-hint">Drag to orbit · scroll or pinch to zoom</p>
  </div>;
}

function useInspectorSheet(panelRef, panelState, setPanelState, blocked) {
  const compact = useStudioCompact(), reduce = useStudioReducedMotion();
  const height = useMotionValue(0), normalRef = useRef(null), expandedRef = useRef(null), collapsedRef = useRef(null);
  const spring = useRef(null), gesture = useRef(null);
  const [stops, setStops] = useState(null), [dragging, setDragging] = useState(false);
  const snap = target => {
    spring.current?.stop();
    if (reduce) height.set(target);
    else spring.current = animate(height, target, UI_SPRING);
  };
  useLayoutEffect(() => {
    const panel = panelRef.current, workspace = panel?.parentElement;
    if (!compact || !panel) {
      spring.current?.stop(); gesture.current = null; setDragging(false); setStops(null); height.set(0);
      panel?.style.removeProperty('height'); workspace?.style.removeProperty('--sheet-live-height');
      return;
    }
    // The stylesheet owns dvh, safe-area and short-screen sizing. These inert
    // probes resolve its lengths without a second JS breakpoint/sizing table.
    const syncDock = value => workspace?.style.setProperty('--sheet-live-height', `${value}px`);
    const unsubscribe = height.on('change', syncDock);
    const measure = () => {
      const collapsed = collapsedRef.current.getBoundingClientRect().height;
      const normal = Math.max(collapsed, normalRef.current.getBoundingClientRect().height);
      const expanded = Math.max(normal, expandedRef.current.getBoundingClientRect().height);
      const next = {collapsed, normal, expanded};
      if (!height.get()) height.set(next[panelState]);
      syncDock(height.get());
      setStops(old => old && Object.keys(next).every(key => old[key] === next[key]) ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    [normalRef, expandedRef, collapsedRef].forEach(ref => observer.observe(ref.current));
    return () => {
      observer.disconnect(); unsubscribe(); spring.current?.stop(); gesture.current = null;
      workspace?.style.removeProperty('--sheet-live-height');
    };
  }, [compact, height, panelRef]);
  useLayoutEffect(() => {
    if (blocked && gesture.current) { gesture.current = null; setDragging(false); }
    if (compact && stops && !gesture.current) snap(stops[panelState]);
    return () => spring.current?.stop();
  }, [compact, stops, panelState, reduce, blocked]);
  const pan = {
    onPanStart() {
      if (!compact || !stops || blocked) return;
      spring.current?.stop(); gesture.current = {height: height.get()}; setDragging(true);
    },
    onPan(event, info) {
      if (gesture.current && !blocked) height.set(sheetDragHeight(gesture.current.height, info.offset.y, stops));
    },
    onPanEnd(event, info) {
      if (!gesture.current) return;
      gesture.current = null; setDragging(false);
      const state = sheetSnapState(height.get(), info.velocity.y, stops);
      if (setPanelState(state) !== false) snap(stops[state]);
    },
  };
  const probeStyle = {position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: 0, overflow: 'hidden'};
  const probes = <div aria-hidden="true" style={{position: 'absolute', pointerEvents: 'none'}}>
    <div ref={normalRef} style={{...probeStyle, height: 'var(--sheet-height)'}} />
    <div ref={expandedRef} style={{...probeStyle, height: 'var(--expanded-height)'}} />
    <div ref={collapsedRef} style={{...probeStyle, height: 'var(--collapsed-height,70px)'}} />
  </div>;
  return {height: compact && stops ? height : undefined, dragging, pan, probes};
}

export function Inspector({app, snapshot, panelRef, instrument = false}) {
  const {study, workspace, ui} = snapshot, a = app.actions;
  const sheet = useInspectorSheet(panelRef, ui.panelState, a.setPanelState, ui.blocked || ui.placing), reduce = useStudioReducedMotion();
  const scrollRef = useRef(null), scrollPositions = useRef(new Map());
  const scrollKey = `${study?.id}:${ui.surface}`;
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollPositions.current.get(scrollKey) || 0; }, [scrollKey]);
  useLayoutEffect(() => { if (instrument && ui.surface === 'composition' && scrollRef.current) scrollRef.current.scrollTop = 0; }, [instrument, ui.adjustmentTool]);
  useEffect(() => { if (ui.focusPlacement) document.querySelector('#region')?.focus(); }, [ui.focusPlacement, instrument]);
  const labels = {normal: 'Expand', expanded: 'Canvas', collapsed: 'Controls'};
  return <motion.aside ref={panelRef} id="study-controls" tabIndex={-1} className={`controls-panel glass-surface ${ui.panelState === 'normal' ? '' : ui.panelState}`}
    style={{height: sheet.height}} data-sheet-dragging={sheet.dragging ? 'true' : undefined}
    data-panel-side="right" data-panel-state={ui.panelState} data-surface={ui.surface} data-lighting={ui.lighting || 'studio'} aria-label="Study controls">
    {sheet.probes}
    <motion.div className="sheet-drag-handle" aria-hidden="true" {...sheet.pan}><span /></motion.div>
    <div className="controls-top">
      <nav className="surface-tabs" aria-label="Workspace">
        <Button variant="ghost" data-surface="composition" data-left="layers" data-panel="tattoo" aria-pressed={ui.surface === 'composition'} onClick={() => a.showSurface('composition')}>{instrument ? 'Adjust' : 'Composition'} <span id="layer-count">{study?.tattoos.length || 0}</span></Button>
        {instrument && <Button variant="ghost" data-surface="collection" aria-pressed={ui.surface === 'collection'} onClick={() => a.showSurface('collection')}>Tattoos <span>{study?.tattoos.length || 0}</span></Button>}
        {!instrument && <Button variant="ghost" data-surface="artwork" data-left="library" aria-pressed={ui.surface === 'artwork'} onClick={() => a.showSurface('artwork')}>Artwork <span id="asset-count">{workspace?.assets.length || 0}</span></Button>}
        <Button variant="ghost" data-surface="body" data-panel="body" aria-pressed={ui.surface === 'body'} onClick={() => a.showSurface('body')}>Body</Button>
        {instrument && <Button variant="ghost" data-surface="artwork" aria-label="Add artwork" title="Add artwork" aria-pressed={ui.surface === 'artwork'} onClick={() => a.showSurface('artwork')}><Plus size={18} aria-hidden="true" /><span className="add-art-label">Add</span></Button>}
      </nav>
      <Button variant="ghost" id="controls-toggle" disabled={ui.blocked || ui.placing} aria-label={`${labels[ui.panelState]} panel`} aria-expanded={ui.panelState !== 'collapsed'} onClick={a.togglePanel}>{labels[ui.panelState]}</Button>
    </div>
    <div className="controls-scroll" ref={scrollRef} onScroll={event => scrollPositions.current.set(scrollKey, event.currentTarget.scrollTop)}>
      {study && <>
        <motion.div className="react-surface" initial={false} animate={{opacity: ui.surface === 'composition' ? 1 : 0}} transition={reduce ? {duration: 0} : {duration: .16}} hidden={ui.surface !== 'composition'}><CompositionPanel app={app} snapshot={snapshot} instrument={instrument} /></motion.div>
        {instrument && <div className="react-surface" hidden={ui.surface !== 'collection'}><TattooCollection app={app} snapshot={snapshot} /></div>}
        <motion.div className="react-surface" initial={false} animate={{opacity: ui.surface === 'artwork' ? 1 : 0}} transition={reduce ? {duration: 0} : {duration: .16}} hidden={ui.surface !== 'artwork'}><ArtworkPanel app={app} snapshot={snapshot} /></motion.div>
        <motion.div className="react-surface" initial={false} animate={{opacity: ui.surface === 'body' ? 1 : 0}} transition={reduce ? {duration: 0} : {duration: .16}} hidden={ui.surface !== 'body'}><BodyPanel app={app} snapshot={snapshot} /></motion.div>
      </>}
    </div>
    <div className="history-bar">
      <span>Approximate preview · fit with your artist</span>
      <span id="engine">{ui.stats.renderer ? `${ui.stats.renderer} + ${ui.stats.kernel}` : 'Preparing 3D'}</span>
    </div>
  </motion.aside>;
}

function NameDialog({app, request}) {
  const [value, setValue] = useState(request.value), inputRef = useRef(null);
  return <Dialog open onOpenChange={open => { if (!open) app.actions.resolveName(null); }}>
    <DialogContent id="name-dialog" showCloseButton={false} initialFocus={inputRef} aria-describedby={request.description ? 'name-dialog-description' : undefined}>
      <form id="name-form" onSubmit={event => { event.preventDefault(); if (value.trim()) app.actions.resolveName(value.trim()); }}>
        <DialogTitle id="name-dialog-title" render={<h2 />}>{request.title}</DialogTitle>
        {request.description && <DialogDescription id="name-dialog-description">{request.description}</DialogDescription>}
        <label className="field" htmlFor="study-name">Study name</label>
        <input ref={inputRef} id="study-name" type="text" maxLength={120} required autoComplete="off" value={value}
          onFocus={event => event.target.select()} onChange={event => setValue(event.target.value)} />
        <div className="layer-tools">
          <Button id="name-cancel" onClick={() => app.actions.resolveName(null)}>Cancel</Button>
          <Button type="submit" variant="primary">{request.submitLabel || 'Save name'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function WorkspaceDialogs({app, ui, study}) {
  const a = app.actions;
  const helpTitleRef = useRef(null);
  return <>
    {ui.nameRequest && <NameDialog app={app} request={ui.nameRequest} />}
    <Dialog open={ui.dialog === 'notes'} onOpenChange={open => { if (!open) a.closeDialog(); }}>
      <DialogContent id="notes-dialog">
        <DialogTitle render={<h2 />}>Study notes</DialogTitle>
        <DialogDescription>Ideas and questions for your artist.</DialogDescription>
        <label className="field" htmlFor="project-notes">Study notes</label>
        <textarea id="project-notes" rows="5" placeholder="Add a note…"
          value={study?.notes || ''} disabled={ui.blocked} onChange={event => a.setNotes(event.target.value)} onBlur={() => a.endGesture('notes')} />
        <p className="hint">Notes save automatically.</p>
      </DialogContent>
    </Dialog>
    <Dialog open={ui.dialog === 'data'} onOpenChange={open => { if (!open) a.closeDialog(); }}>
      <DialogContent id="data-dialog">
        <DialogTitle id="data-dialog-title" render={<h2 />}>Backup or move device</DialogTitle>
        <DialogDescription>{ui.storageMode === 'browser'
          ? 'Studies save in this browser. Download a backup before clearing browser data or moving to another device.'
          : 'Studies save in this server workspace. Browsers using this server share it. Download a backup to keep a separate copy.'}</DialogDescription>
        <Button id="export-backup" variant="primary" disabled={ui.dataBlocked} onClick={a.exportBackup}>Download backup</Button>
        <label className="secondary upload-import" htmlFor="import-backup">Restore backup<input id="import-backup" type="file" accept=".json,application/json" disabled={ui.dataBlocked}
          onChange={async event => { const input = event.currentTarget; try { await a.restoreBackup(input.files[0]); } finally { input.value = ''; } }} /></label>
        <p className="hint">This backup contains every study and artwork. Restoring replaces the destination workspace, including its studies and artwork. A safety backup download starts first.</p>
        <ol className="workspace-transfer"><li>Download the backup on this device and check that the file is saved.</li><li>Transfer that JSON file to the other device, such as through Files or AirDrop.</li><li>Open tattoo you on the destination and choose Backup or move device.</li><li>Choose Restore backup and confirm replacement. Device copies do not sync automatically.</li></ol>
        <p id="data-status" role="status">{ui.dataStatus}</p>
        <div className="workspace-links"><Button variant="ghost" id="data-help-open" onClick={() => a.openDialog('help')}>Help and shortcuts</Button>
          {ui.storageMode !== 'browser' && <a href="../">Open flash archive</a>}</div>
      </DialogContent>
    </Dialog>
    <Dialog open={ui.dialog === 'help'} onOpenChange={open => { if (!open) a.closeDialog(); }}>
      <DialogContent id="help-dialog" initialFocus={helpTitleRef} aria-describedby={undefined}>
        <DialogTitle ref={helpTitleRef} id="help-dialog-title" tabIndex={-1} render={<h2 />}>Using tattoo you</DialogTitle>
        <ol>
          <li>Import a transparent PNG or WebP, up to 20 MB. Crop it to the design without skin or background.</li>
          <li>Choose a body area, then adjust width and rotation. Use Place on body for a precise position.</li>
          <li>Lock tattoos to keep them in place. Save an alternative to try another arrangement.</li>
        </ol>
        <p>Drag to orbit; scroll or pinch to zoom. With the preview focused, arrow keys orbit and +/− zoom.</p>
        <p>⌘/Ctrl Z: undo · Shift ⌘/Ctrl Z: redo · Delete: remove unlocked tattoos · Escape: stop placing.</p>
        <p className="hint">Check placement from several angles and confirm the fit with your artist.</p>
        {ui.storageMode === 'browser' && <p className="hint">Studies stay in this browser. Keep a downloaded backup. <a href="../privacy.html">Privacy and storage</a> · <a href="../THIRD-PARTY-NOTICES.txt">Credits</a></p>}
      </DialogContent>
    </Dialog>
  </>;
}

export function PreviewRecovery({app, snapshot}) {
  const {ui} = snapshot;
  const failed = !!(ui.error || ui.previewError);
  const confirmedSaved = !!snapshot.study && ui.hasUnsavedChanges === false && !ui.saveError && !ui.saveFailure && /^Saved(?: |$)/.test(ui.saveLabel || '');
  return <div id="loading" className="loading glass-surface" hidden={!ui.loading && !failed}>
    <h2>{ui.previewError ? 'Preview unavailable' : ui.error ? 'Could not open the studio' : 'Loading studio'}</h2>
    <p>{failed ? 'The preview could not load. Try again to reload the studio and body reference.' : 'Loading body reference and artwork.'}</p>
    {ui.previewError && <p>{ui.hasUnsavedChanges ? 'Some changes are not saved. Download a backup before trying again; reloading discards unsaved changes.' : confirmedSaved ? 'Your study is saved. You can download a backup while the preview is unavailable.' : 'Backup and recovery options remain available while the preview is unavailable.'}</p>}
    {failed && <details className="preview-error-details"><summary>Technical details</summary><p>{ui.previewError || ui.error}</p></details>}
    {failed && <Button id="reload-app" variant="primary" onClick={() => location.reload()}>Try again</Button>}
    {failed && <Button id="recover-workspace" variant="secondary" disabled={ui.dataBlocked} onClick={() => app.actions.openDialog('data')}>Back up your workspace</Button>}
  </div>;
}

/** Recovery layout remains available when renderer startup disposes its observer. */
export function observeRecoveryHeaderBounds(root, header, study) {
  const elements = [header, study].filter(Boolean);
  const measure = () => {
    const bottom = Math.max(0, ...elements.map(element => element.getBoundingClientRect().bottom));
    root.style.setProperty('--recovery-header-bottom', `${bottom}px`);
  };
  measure();
  const observer = new ResizeObserver(measure);
  elements.forEach(element => observer.observe(element));
  window.addEventListener('resize', measure);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', measure);
    root.style.removeProperty('--recovery-header-bottom');
  };
}

function StudioApp({app}) {
  const snapshot = useSyncExternalStore(app.subscribe, app.getSnapshot);
  const instrument = snapshot.ui.presentation === 'instrument';
  const {study, ui} = snapshot;
  const visibleTattoos = study?.tattoos.filter(t => t.visible).length || 0;
  const viewportRef = useRef(null), headerRef = useRef(null), studyRef = useRef(null), panelRef = useRef(null), dockRef = useRef(null), dockGroupRef = useRef(null), statusRef = useRef(null);
  useLayoutEffect(() => observeRecoveryHeaderBounds(document.documentElement, headerRef.current, studyRef.current), []);
  useEffect(() => app.attachViewport(viewportRef.current, {
    root: document.documentElement, header: headerRef.current, study: studyRef.current, panel: panelRef.current,
    dock: dockRef.current, dockGroup: dockGroupRef.current, status: statusRef.current,
  }), [app]);
  useEffect(() => {
    const keydown = event => {
      const current = app.getSnapshot();
      if (!current.ui.ready || current.ui.blocked || current.ui.dialog || current.ui.nameRequest) return;
      if (event.defaultPrevented || document.activeElement?.closest('input,textarea,select,[role=combobox],[role=listbox],[role=option]') || document.querySelector('dialog[open]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); app.actions[event.shiftKey ? 'redo' : 'undo'](); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); app.actions.removeLayers(); }
      if (event.key === 'Escape') app.actions.stopPlacing();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [app]);
  return <>
    <a className="skip-link" href="#study-controls">Skip to study controls</a>
    <Header app={app} snapshot={snapshot} headerRef={headerRef} studyRef={studyRef} instrument={instrument} />
    <main className="workspace">
      <section className="stage" aria-label="Interactive tattoo composition">
        <div id="viewport" ref={viewportRef} aria-busy={ui.rendering} />
        <div className={instrument ? "stage-top sr-only" : "stage-top"}><h1 id="stage-title">{study?.name || 'Study'}</h1><p id="stage-meta">{study ? `${study.body.stature.toFixed(1)} cm · ${visibleTattoos} visible tattoo${visibleTattoos === 1 ? '' : 's'}` : 'Approximate body reference'}</p></div>
        <CameraDock app={app} snapshot={snapshot} dockRef={dockRef} dockGroupRef={dockGroupRef} statusRef={statusRef} />
        <PreviewRecovery app={app} snapshot={snapshot} />
      </section>
      <Inspector app={app} snapshot={snapshot} panelRef={panelRef} instrument={instrument} />
    </main>
    <footer><span id="footer-stats">{ui.storageMode === 'browser' ? 'Public beta · saved in this browser' : ui.stats.renderer ? `${ui.stats.renderer.toUpperCase()} · ${ui.stats.kernel.toUpperCase()} GEOMETRY · LOCAL SQLITE` : 'Saved to workspace'}</span></footer>
    <WorkspaceDialogs app={app} ui={ui} study={study} /><JourneyDialogs app={app} snapshot={snapshot} /><ArtworkPreview app={app} />
  </>;
}

export function mountStudio(element, app) {
  const theme = app.getSnapshot().ui.theme;
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  const root = createRoot(element);
  root.render(<StudioMotionProvider><StudioApp app={app} /></StudioMotionProvider>);
  return () => { root.unmount(); app.dispose(); };
}
