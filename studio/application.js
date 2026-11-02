import {createWorkspaceSync} from './workspace-sync.js';
import {createStudyController} from './study-controller.js';
import {createWorkspaceFiles} from './workspace-files.js';
import {observeViewportLayout, resolvePresentation, resolveTheme, COMPACT_LAYOUT_QUERY} from './viewport-layout.js';
import {bodyParams} from './body-controls.js';
import {project, copy, editable, selection, addTattoo, transform, duplicateSelection, deleteSelection} from './model.js';
import {STORAGE_LIMITS} from './storage-limits.js';
import {applyBodyProfile, SHAPE_DEFAULTS} from './body-profiles.js';
import {captureStudyComparison, compatibleComparisonStudies} from './study-comparison.js';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

// Portable backups may have no studies or no active selection. Choose a usable
// study before committing a restore; leave malformed payloads to API validation.
function withActiveStudy(workspace) {
  if (!Array.isArray(workspace.projects) || workspace.activeProjectId != null) return workspace;
  const projects = workspace.projects.length ? workspace.projects : [project('My first study')];
  return {...workspace, projects, activeProjectId: projects[0].id};
}

/** The application owns commands and mutable domain state. Views receive copies. */
export function createApplication({
  createStudio, regions = [], api, browser = globalThis,
  observeLayout = observeViewportLayout, fileServices = {}, clock,
  storageMode = 'browser', runtimeCapabilities = {}, initialQuality = 'auto',
  presentation = resolvePresentation(browser.location?.search || ''),
  captureComparison = captureStudyComparison,
} = {}) {
  const state = {
    workspace: null, studio: null, dirty: false, saving: false, conflict: false,
    saveTask: null, renderTask: null, lastRenderOK: true, rendering: false,
    mappingWarnings: [], renderAgain: false, convertingBody: false, reviewing: false, ready: false, currentView: 'body',
  };
  const ui = {
    theme: resolveTheme(browser.location?.search || ''), presentation, storageMode, storagePersistence: 'unknown',
    loading: true, error: '', previewError: '', mappingWarnings: [], blocked: false, status: 'Opening your workspace…',
    saveLabel: 'Connecting…', saveError: false, saveFailure: '', retry: {hidden: true, text: 'Retry save'},
    surface: new URLSearchParams(browser.location?.search || '').get('panel') === 'body' ? 'body' : 'composition',
    panelState: 'normal', placing: false, adjustmentTool: 'place', artSearch: '', importExisting: false,
    lighting: 'studio', quality: ['auto', 'efficient', 'high'].includes(initialQuality) ? initialQuality : 'auto', stats: {}, preview: {phase: 'idle'},
    measurements: {}, dataStatus: '', dialog: null, nameRequest: null, focusPlacement: 0,
    comparison: null, comparisonTarget: '', reviewBusy: false, reviewError: '', reference: null, referenceDownloaded: false,
  };
  const listeners = new Set(), gestures = new Set();
  let snapshot, controller, files, initialization, viewportGeneration = 0;
  let previewAdapter = null, nameResolve = null, releaseViewport = null;
  let placementPanelState = null, placementTarget = null, statusVersion = 0, failedSaveVersion = null;
  let placementMedia = null, placementMediaListener = null;
  let preparedReference = null;

  const compositionKey = study => study ? JSON.stringify([study.id,study.body,study.tattoos.filter(t => t.visible)]) : '';
  let warningKey = '', renderedWarningKey = '';
  function publish(domainChanged = true) {
    const activeStudy = state.workspace?.projects.find(p => p.id === state.workspace.activeProjectId);
    if (compositionKey(activeStudy) !== warningKey) {
      warningKey = compositionKey(activeStudy); ui.mappingWarnings = []; state.mappingWarnings = [];
    }
    const editableCount = activeStudy ? editable(activeStudy).length : 0;
    if (ui.placing && (editableCount !== 1 || placementTarget !== activeStudy.id + ':' + editable(activeStudy)[0].id)) updatePlacing(false);
    reconcilePlacementLayout();

    const workspace = domainChanged || !snapshot
      ? (state.workspace ? copy(state.workspace) : null)
      : snapshot.workspace;
    const study = domainChanged || !snapshot
      ? workspace?.projects.find(p => p.id === workspace.activeProjectId) || null
      : snapshot.study;
    const history = study && controller ? controller.hist() : null;
    snapshot = freeze({workspace, study, regions, runtimeCapabilities: copy(runtimeCapabilities), selection: {canReanchor: editableCount === 1, editableCount}, ui: copy({
      ...ui, ready: state.ready, currentView: state.currentView,
      hasUnsavedChanges: state.dirty || state.saving || state.conflict,
      blocked: ui.blocked || state.convertingBody || !state.ready, rendering: state.rendering,
      dataBlocked: ui.blocked || state.convertingBody || !state.workspace,
      canUndo: !!history?.past.length, canRedo: !!history?.future.length,
    })});
    for (const listener of listeners) listener();
  }
  // Only proven UI-only events reuse the frozen domain snapshot. Domain owners
  // and ambiguous persistence callbacks retain the default invalidating path.
  const publishUI = () => publish(false);
  const say = message => { ui.status = message; statusVersion++; publish(); };
  const sayUI = message => { ui.status = message; statusVersion++; publishUI(); };
  const setInteractionBlocked = blocked => {
    ui.blocked = blocked;
    if (browser.document?.body) browser.document.body.inert = blocked;
    publish();
  };
  const sync = createWorkspaceSync(state, {
    api, clock, say,
    saveFailed(message) { ui.saveFailure = message; failedSaveVersion = statusVersion + 1; say(message); },
    saveRecovered() {
      if (failedSaveVersion === statusVersion) {
        sayUI(ui.placing ? 'Tap visible skin to anchor the selection. Locked tattoos will not move.' :
          ui.mappingWarnings.length ? ui.mappingWarnings.join(' ') : 'Changes saved. Drag to orbit · choose tattoos to edit.');
      }
      failedSaveVersion = null;
    },
    savedStatus(message, bad = false) {
      if (message === 'Saved to workspace') ui.saveFailure = '';
      ui.saveLabel = ui.saveFailure && message === 'Saving…' ? 'Unsaved · retrying…' :
        storageMode === 'browser' && message === 'Saved to workspace' ? 'Saved in this browser' : message;
      ui.saveError = bad || !!ui.saveFailure; publish();
    },
    persistenceChanged: publish,
    setRetry(value) { ui.retry = {...ui.retry, ...value}; publish(); },
    setRenderBusy() { publish(); },
    setPreviewError(value) { ui.previewError = value; publishUI(); },
    renderedComposition(study) {
      // A pending render can settle after viewport cleanup clears its renderer.
      if (!state.studio || compositionKey(study) !== compositionKey(controller.active())) return;
      renderedWarningKey = compositionKey(study);
      const records = state.studio.getMappingWarnings?.();
      if (records) {
        const visible = new Set(study.tattoos.filter(t => t.visible).map(t => t.id));
        ui.mappingWarnings = [...new Set(records.filter(r => visible.has(r.tattooId)).map(r => r.message))];
        state.mappingWarnings = copy(ui.mappingWarnings); publishUI();
      }
    },
  });
  function compactPlacement() {
    return ui.placing && Boolean(placementMedia?.matches ?? browser.matchMedia?.(COMPACT_LAYOUT_QUERY).matches);
  }
  function reconcilePlacementLayout() {
    if (!ui.placing) return false;
    const next = compactPlacement() ? 'collapsed' : placementPanelState;
    if (next === null || next === ui.panelState) return false;
    ui.panelState = next;
    return true;
  }
  function releasePlacementMedia() {
    if (placementMediaListener) placementMedia?.removeEventListener?.('change', placementMediaListener);
    placementMedia = null; placementMediaListener = null;
  }
  function updatePlacing(value) {
    if (value === ui.placing) return;
    if (value) {
      placementTarget = controller.active().id + ':' + editable(controller.active())[0].id;
      // Preserve the entry stop once, including when placement starts beside a
      // side inspector and later rotates into a sheet.
      placementPanelState = ui.panelState;
      placementMedia = browser.matchMedia?.(COMPACT_LAYOUT_QUERY) || null;
      placementMediaListener = () => { if (reconcilePlacementLayout()) publishUI(); };
      placementMedia?.addEventListener?.('change', placementMediaListener);
    } else {
      releasePlacementMedia(); placementTarget = null;
      if (ui.status === 'Tap visible skin to anchor the selection. Locked tattoos will not move.') {
        ui.status = 'Drag to orbit · choose tattoos to edit.'; statusVersion++;
      }
      if (placementPanelState !== null) { ui.panelState = placementPanelState; placementPanelState = null; }
    }
    ui.placing = value;
    reconcilePlacementLayout();
    state.studio?.setPlaceMode(value);
  }
  function placeMode(value) {
    if (value && editable(controller.active()).length !== 1) {
      say('Choose one tattoo to change its body area. Move, rotate, or scale the group with the adjustment controls.');
      return false;
    }
    updatePlacing(value);
    say(value ? 'Tap visible skin to anchor the selection. Locked tattoos will not move.' : 'Drag to orbit · choose tattoos to edit.');
  }
  function chooseCamera(name) {
    if (!state.studio) return false;
    state.currentView = name;
    state.studio.view(name);
    publish();
    return sync.renderScene();
  }
  function askName(title, value, {submitLabel = 'Save name', description = ''} = {}) {
    if (nameResolve) return Promise.resolve(null);
    ui.nameRequest = {title, value, submitLabel, description};
    const result = new Promise(resolve => { nameResolve = resolve; });
    publishUI();
    return result;
  }
  controller = createStudyController(state, {
    ...sync, api, say, render: publish, askName, placeMode, chooseCamera,
    setInteractionBlocked,
    setLoading(value) { ui.loading = value; publish(); },
    setCameraSelection() { publish(); },
  });
  function showSurface(surface) {
    if (!['composition', 'collection', 'artwork', 'body'].includes(surface)) return;
    ui.surface = surface;
    if (ui.panelState === 'collapsed' && !ui.placing) ui.panelState = 'normal';
    publishUI();
  }
  function focusPlacement() {
    ui.focusPlacement++; ui.adjustmentTool = 'place'; publishUI();
    // Wait for the import's scene update before choosing a useful close-up.
    const studyId = controller.active().id;
    Promise.resolve(state.renderTask || sync.renderScene()).then(ok => {
      if (ok && state.ready && !ui.blocked && !state.reviewing && controller.active().id === studyId) chooseCamera('detail');
    }).catch(error => say(error.message));
  }
  files = createWorkspaceFiles(state, {
    api, ...sync, active: controller.active, mutate: controller.mutate,
    invalidateArtworkHistory: controller.invalidateArtworkHistory, say,
    setInteractionBlocked, getInteractionBlocked: () => ui.blocked,
    getStatus: () => ui.status, setDataStatus(value) { ui.dataStatus = value; publish(); },
    showSurface, focusPlacement, publish, regions,
    browser: {
      document: browser.document, Image: browser.Image, Blob: browser.Blob,
    },
    confirm: message => browser.confirm(message), ...fileServices,
  });
  const canEdit = () => !!state.workspace && state.ready && !ui.blocked && !state.convertingBody;
  const canManageData = () => !!state.workspace && !ui.blocked && !state.convertingBody;
  function mutate(change, options) {
    if (!canEdit()) return false;
    return controller.mutate(change, options);
  }
  function gesture(id, change, options = {}) {
    if (!canEdit()) return false;
    const first = !gestures.has(id), before = first ? copy(controller.active()) : null;
    const accepted = controller.mutate(change, {...options, history: false});
    if (accepted && first) { controller.hist().push(before); gestures.add(id); publish(); }
    return accepted;
  }
  const guarded = fn => (...args) => canEdit() ? fn(...args) : false;
  const report = async (operation, onError = error => say(error.message)) => {
    try { return await operation(); } catch (error) { onError(error); return false; }
  };
  const backupFailure = error => { ui.dataStatus = 'Backup did not complete: ' + error.message; publish(); };

  const actions = {
    showSurface,
    setAdjustmentTool(tool) {
      if (!['place', 'size', 'rotate', 'view', 'more'].includes(tool)) return false;
      if (ui.placing && tool !== 'place') placeMode(false);
      ui.adjustmentTool = tool;
      sayUI(tool === 'place' ? (editable(controller.active()).length === 1 ? 'Choose a body area or Place on body.' : 'Choose one tattoo to change its body area.') : 'Drag to orbit · adjust the selected tattoos.');
      return true;
    },
    setPanelState(value) {
      if (!['collapsed', 'normal', 'expanded'].includes(value)) return false;
      if (ui.placing) return value === ui.panelState;
      if (ui.panelState !== value) { ui.panelState = value; publishUI(); }
      return true;
    },
    togglePanel() {
      if (ui.placing) return false;
      ui.panelState = {normal: 'expanded', expanded: 'collapsed', collapsed: 'normal'}[ui.panelState];
      publishUI();
    },
    setArtSearch(value) { ui.artSearch = value; publishUI(); },
    setImportExisting(value) {
      ui.importExisting = value;
      publishUI();
    },
    addArtwork: guarded(id => {
      const asset = state.workspace.assets.find(a => a.id === id);
      if (!asset) return false;
      const added = mutate(p => addTattoo(p, asset, false));
      if (added) {
        showSurface('composition'); focusPlacement();
        say('Added to study as a new idea. Choose a body area or Place on body, then adjust width.');
      }
      return added;
    }),
    previewArtwork: guarded((id, opener) => {
      const asset = state.workspace.assets.find(a => a.id === id);
      if (!asset) return;
      const query = ui.artSearch.trim().toLocaleLowerCase();
      previewAdapter?.open(asset, state.workspace.assets.filter(a => a.name.toLocaleLowerCase().includes(query)), opener);
    }),
    removeArtwork: guarded(id => files.removeArtwork(id)),
    uploadFiles: guarded(input => files.uploadFiles(input, {existing: ui.importExisting})),
    selectLayer(id, checked) {
      mutate(p => { p.selectedIds = checked ? [...new Set([...p.selectedIds, id])] : p.selectedIds.filter(x => x !== id); }, {history: false});
    },
    layerAction(id, action) {
      mutate(p => {
        const item = p.tattoos.find(t => t.id === id), index = p.tattoos.indexOf(item);
        if (!item) return;
        if (action === 'visible' || action === 'locked') item[action] = !item[action];
        else {
          const next = index + (action === 'up' ? -1 : 1);
          if (next >= 0 && next < p.tattoos.length) [p.tattoos[index], p.tattoos[next]] = [p.tattoos[next], p.tattoos[index]];
        }
      });
    },
    selectAll() { mutate(p => { p.selectedIds = p.tattoos.map(t => t.id); }, {history: false}); },
    clearSelection() { mutate(p => { p.selectedIds = []; }, {history: false}); },
    focusLayer(id) {
      if (!mutate(p => { if (p.tattoos.some(t => t.id === id)) p.selectedIds = [id]; }, {history: false})) return false;
      showSurface('composition');
      say('Adjust this tattoo, or choose another from Tattoos.');
      return true;
    },
    duplicateLayers() { mutate(duplicateSelection); },
    removeLayers() { mutate(deleteSelection); },
    togglePlace: guarded(() => placeMode(!ui.placing)),
    stopPlacing: guarded(() => placeMode(false)),
    renameLayer(value) { mutate(p => { const item = editable(p)[0]; if (item) item.name = value.trim().slice(0, 120) || 'Untitled tattoo'; }); },
    setRegion: guarded(async region => {
      if (editable(controller.active()).length !== 1) return placeMode(true);
      if (region === 'custom') return placeMode(true);
      if (!regions.some(r => r.id === region)) return;
      mutate(p => { for (const item of editable(p)) {
        item.region = region; item.placement = state.studio.getAnchor(region); item.offsetX = 0; item.offsetY = 0;
      } });
      if (await sync.renderScene()) await chooseCamera('detail');
    }),
    editTattoo(key, value) {
      if (!canEdit() || !['width', 'rotation', 'offsetX', 'offsetY', 'opacity'].includes(key) || !Number.isFinite(value)) return false;
      const first = editable(controller.active())[0]; if (!first) return false;
      const change = key === 'width' ? {scale: value / first.width} : key === 'rotation' ? {rotate: value - first.rotation} :
        key === 'offsetX' ? {x: value - first.offsetX} : key === 'offsetY' ? {y: value - first.offsetY} : {opacity: value};
      return gesture(key, p => transform(p, change));
    },
    endGesture(key) { gestures.delete(key); },
    nudge(x, y) { mutate(p => transform(p, {x, y})); },
    setFlip(value) { mutate(p => transform(p, {flip: value})); },
    lockSelection(value) { mutate(p => { for (const item of selection(p)) item.locked = value; }); },
    setNotes(value) { gesture('notes', p => { p.notes = value.slice(0, 5000); }, {scene: false}); },
    editBody(key, value) {
      if (!bodyParams.some(p => p[0] === key) || !Number.isFinite(value)) return false;
      return gesture(key, p => { p.body[key] = value; });
    },
    setBodyProfile(id) { mutate(p => { p.body = applyBodyProfile(p.body, id); }); },
    resetBody() { mutate(p => { p.body = {...p.body, ...SHAPE_DEFAULTS}; }); },
    setSkinTone(id) { mutate(p => { p.body.skin = id; if (id === 'custom' && !/^#[0-9a-f]{6}$/i.test(p.body.skinColor || '')) p.body.skinColor = '#e0c1ad'; }); },
    setSkinColor(hex) {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;
      return gesture('skin-color', p => { p.body.skin = 'custom'; p.body.skinColor = hex.toLowerCase(); });
    },
    changeAnatomy: guarded(value => { gestures.clear(); return controller.changeAnatomy(value); }),
    useBodyModel: guarded(value => { gestures.clear(); return controller.useBodyModel(value); }),
    switchProject: guarded(id => { gestures.clear(); return controller.switchProject(id); }),
    saveAlternative: guarded(() => { gestures.clear(); return controller.saveAlternative(); }),
    async newProject() {
      if (!canEdit() || !controller.hasStudyCapacity()) return false;
      const name = await askName('Name your new study', 'New study', {submitLabel: 'Create study'}); if (!name?.trim() || !canEdit()) return false;
      const next = project(name.trim().slice(0, 120));
      if (!controller.canAddStudy(next)) return false;
      state.workspace.projects.push(next);
      const switched = await controller.switchProject(next.id);
      if (switched) showSurface('artwork');
      else { state.workspace.projects = state.workspace.projects.filter(p => p.id !== next.id); publish(); }
      return switched;
    },
    async renameProject() {
      if (!canEdit()) return;
      const name = await askName('Rename your study', controller.active().name, {submitLabel: 'Rename study'});
      if (name?.trim()) mutate(p => { p.name = name.trim().slice(0, 120); }, {scene: false});
    },
    deleteProject: guarded(async () => {
      const original = controller.active();
      if (!browser.confirm(`Delete “${original.name}”? Artwork stays in your library. Export a backup first if you want to keep this study.`)) return false;
      let next = state.workspace.projects.find(p => p.id !== original.id), created = false;
      if (!next) { next = project(); state.workspace.projects.push(next); created = true; }
      if (!await controller.switchProject(next.id)) {
        if (created) state.workspace.projects = state.workspace.projects.filter(p => p.id !== next.id);
        publish(); return false;
      }
      state.workspace.projects = state.workspace.projects.filter(p => p.id !== original.id);
      gestures.clear(); sync.scheduleSave(); publish(); return true;
    }),
    undo: guarded(() => { gestures.clear(); const p = controller.hist().undo(controller.active()); if (p) controller.setProject(p); }),
    redo: guarded(() => { gestures.clear(); const p = controller.hist().redo(controller.active()); if (p) controller.setProject(p); }),
    chooseCamera: guarded(chooseCamera),
    setLighting: guarded(value => { ui.lighting = value; state.studio.setLighting(value); publishUI(); }),
    setQuality: guarded(value => { ui.quality = value; state.studio.setQuality(value); publishUI(); }),
    raytrace: guarded(() => { ui.lighting = 'studio'; state.studio.setLighting('studio'); publishUI(); return state.studio.raytrace(); }),
    cancelRaytrace: guarded(() => state.studio.cancelRaytrace()),
    saveImage: guarded(() => report(() => files.saveImage())),
    openComparison: guarded(() => {
      placeMode(false);
      const candidates = compatibleComparisonStudies(state.workspace.projects, controller.active());
      ui.comparisonTarget = candidates.some(p => p.id === ui.comparisonTarget) ? ui.comparisonTarget : candidates[0]?.id || '';
      ui.comparison = null; ui.reviewError = ''; ui.dialog = 'compare'; publishUI();
    }),
    setComparisonTarget(id) {
      if (ui.reviewBusy) return false;
      if (!compatibleComparisonStudies(state.workspace.projects, controller.active()).some(p => p.id === id)) return false;
      ui.comparisonTarget = id; ui.comparison = null; ui.reviewError = ''; publishUI(); return true;
    },
    async compareStudies() {
      if (!canEdit() || ui.reviewBusy || !ui.comparisonTarget) return false;
      ui.reviewBusy = true; ui.reviewError = ''; ui.comparison = null;
      state.reviewing = true; ui.blocked = true; publishUI();
      try {
        ui.comparison = await captureComparison(state, {active: controller.active, targetId: ui.comparisonTarget, browser});
        return true;
      } catch (error) {
        ui.reviewError = error.message;
        if (!state.lastRenderOK) ui.previewError = 'Preview could not be restored. Change the view or reload the preview.';
        return false;
      } finally {
        state.reviewing = false; ui.blocked = false; ui.reviewBusy = false; publish();
      }
    },
    async editComparedStudy(id) {
      if (!canEdit() || ui.reviewBusy) return false;
      actions.closeDialog();
      if (id !== controller.active().id) return actions.switchProject(id);
      return true;
    },
    async reviewReference() {
      if (!canEdit() || ui.reviewBusy) return false;
      placeMode(false); preparedReference = null; ui.reference = null; ui.referenceDownloaded = false;
      ui.reviewBusy = true; ui.reviewError = ''; publishUI();
      try {
        preparedReference = await files.prepareReference();
        const {blob, ...preview} = preparedReference;
        ui.reference = preview; ui.dialog = 'reference';
        return true;
      } catch (error) {
        ui.reviewError = error.message; ui.dialog = 'reference'; return false;
      } finally { ui.reviewBusy = false; publishUI(); }
    },
    downloadReference() {
      if (!preparedReference || ui.reviewBusy) return false;
      files.downloadReference(preparedReference);
      ui.referenceDownloaded = true; publishUI(); return true;
    },
    exportBackup: () => canManageData() ? report(() => files.exportBackup(), backupFailure) : false,
    async restoreBackup(file) {
      if (!file || !canManageData()) return false;
      return report(async () => {
        if (file.size > STORAGE_LIMITS.maxRestoreBytes) throw Error('Workspace backups must be smaller than 160 MiB.');
        const backup = JSON.parse(await file.text());
        if (backup.version !== 3) throw Error('Choose an INKFORM workspace backup.');
        if (!browser.confirm('Replace all current studies and artwork with this backup? A download of your current workspace will start first. Keep that file as a separate copy.')) return false;
        setInteractionBlocked(true);
        try {
          if (!await sync.flush()) throw Error('Save or resolve the conflict before restoring a backup.');
          await files.exportBackup();
          const replacement = await api('restore', 'POST', {backup: withActiveStudy(backup), revision: state.workspace.revision});
          const {saved, rendered} = await adoptWorkspace(replacement);
          ui.dataStatus = storageMode === 'browser' ? 'Workspace restored and saved in this browser.' : 'Workspace restored and saved to your private workspace.';
          if (!saved) ui.dataStatus += ' The editable study is open but not saved. Use Retry save or resolve the conflict; the restored backup already committed.';
          if (!rendered) ui.dataStatus += ' Preview could not load; backup remains available. Retry the preview before editing or exporting an image.';
          publish();
          return true;
        } finally { setInteractionBlocked(false); }
      }, backupFailure);
    },
    async retrySave() {
      if (!canManageData()) return false;
      if (!state.conflict) return sync.flush();
      return report(async () => {
        await files.exportBackup();
        if (!browser.confirm('A backup download of your open edits has started. Keep that file, then load the current saved workspace?')) return false;
        setInteractionBlocked(true);
        try {
          const {saved, rendered} = await adoptWorkspace(await api('workspace'));
          ui.dataStatus = saved ? 'Saved copy loaded.' : 'Saved copy loaded. The editable study is open but not saved. Use Retry save or resolve the conflict.';
          if (!rendered) ui.dataStatus += ' Preview could not load; retry the preview before editing or exporting an image.';
          publish(); return true;
        } finally { setInteractionBlocked(false); }
      });
    },
    openDialog(name) { ui.dialog = name; publishUI(); },
    setStoragePersistence(value) { ui.storagePersistence = value === true ? 'granted' : 'not-granted'; publishUI(); },
    closeDialog() {
      if (ui.reviewBusy) return false;
      ui.dialog = null; ui.comparison = null; ui.reference = null; preparedReference = null; ui.referenceDownloaded = false; ui.reviewError = ''; publishUI();
      return true;
    },
    resolveName(value) {
      const resolve = nameResolve; nameResolve = null; ui.nameRequest = null; publishUI(); resolve?.(value);
    },
  };

  async function normalizeSavedWorkspace(workspace) {
    const usable = withActiveStudy(workspace);
    if (usable === workspace) return workspace;
    const {projects, activeProjectId} = usable;
    const saved = await api('workspace', 'PUT', {revision: workspace.revision, projects, activeProjectId});
    return {...workspace, ...saved, projects, activeProjectId};
  }
  async function adoptWorkspace(workspace) {
    // The replacement has committed or was explicitly loaded. Old history and
    // successful-render ownership must end before any follow-up storage work.
    state.lastRenderOK = false; renderedWarningKey = '';
    const usable = withActiveStudy(workspace);
    state.workspace = usable; state.dirty = false; state.conflict = false;
    controller.clearHistory(); gestures.clear(); ui.retry.hidden = true; ui.saveError = false; ui.saveFailure = ''; failedSaveVersion = null;
    ui.saveLabel = storageMode === 'browser' ? 'Saved in this browser' : 'Saved to workspace';
    placeMode(false);
    let saved = true;
    if (usable !== workspace) { sync.scheduleSave(); saved = await sync.flush(); }
    publish();
    let rendered = false;
    try { rendered = !!await chooseCamera('body'); }
    catch (error) { ui.previewError = error.message; say('Preview unavailable. Change the view to retry.'); }
    if (state.studio) state.ready = rendered;
    publish();
    return {saved, rendered};
  }
  async function initialize() {
    if (!initialization) initialization = (async () => {
      // Keep the original readable snapshot exportable if normalization cannot save.
      state.workspace = await api('workspace');
      state.workspace = await normalizeSavedWorkspace(state.workspace);
      ui.saveLabel = storageMode === 'browser' ? 'Saved in this browser' : 'Saved to workspace';
      publish();
    })().catch(error => { initialization = null; throw error; });
    return initialization;
  }
  function attachViewport(host, elements) {
    const priorCleanup = releaseViewport?.();
    const generation = ++viewportGeneration;
    ui.loading = true; ui.error = ''; ui.previewError = '';
    if (!state.workspace) ui.saveLabel = 'Connecting…';
    publish();
    let cancelled = false, engine = null, layout = null, pendingEngine = null, disposalTask = null, cleanupTask = null;
    const live = () => !cancelled && generation === viewportGeneration;
    const disposeEngine = value => {
      if (value && !disposalTask) disposalTask = Promise.resolve(value.dispose()).catch(error => console.error('Renderer cleanup failed', error));
      return disposalTask;
    };
    const cleanup = () => {
      if (cancelled) return cleanupTask;
      cancelled = true; layout?.dispose();
      if (engine) {
        if (state.studio === engine) { state.studio = null; state.ready = false; }
        disposeEngine(engine);
      }
      publish();
      cleanupTask = pendingEngine ? pendingEngine.then(disposeEngine, () => {}) : disposalTask;
      return cleanupTask;
    };
    releaseViewport = cleanup;
    (async () => {
      try {
        await priorCleanup;
        if (!live()) return;
        if (state.renderTask) await state.renderTask;
        await initialize(); if (!live()) return;
        layout = observeLayout({...elements, host, onChange: () => engine?.refreshLayout()});
        pendingEngine = createStudio(host, {
          presentation, getClearViewport: layout.measure, initialBody: controller.active().body,
          onMeasurements(value) { if (live()) { ui.measurements = value; publishUI(); } },
          onCamera(camera, metadata = {}) {
            if (!live() || !state.ready || state.reviewing) return;
            if (metadata.custom) state.currentView = 'custom';
            const old = controller.active().camera;
            if (!old || ['position', 'target'].some(k => camera[k].some((v, i) => Math.abs(v - old[k][i]) > 1e-5))) {
              controller.active().camera = camera; sync.scheduleSave();
            }
          },
          onPlace(anchor) {
            if (!live() || !canEdit() || editable(controller.active()).length !== 1) return;
            mutate(p => { for (const item of editable(p)) { item.placement = copy(anchor); item.region = 'custom'; } });
            say('Anchored to the surface. Use the movement controls to refine the composition.');
          },
          onSelect(id, {additive}) {
            if (!live()) return;
            mutate(p => { p.selectedIds = additive ? (p.selectedIds.includes(id) ? p.selectedIds.filter(x => x !== id) : [...p.selectedIds, id]) : [id]; }, {history: false});
          },
          onStats(value) {
            if (!live() || state.reviewing) return;
            const previous = [...new Set(ui.stats.warnings || [])].join(' ');
            ui.stats = value;
            const warningsAreCurrent = !state.rendering && state.lastRenderOK && renderedWarningKey === compositionKey(controller.active());
            if (warningsAreCurrent) {
              const records = value.mappingWarnings;
              const visible = new Set(controller.active().tattoos.filter(t => t.visible).map(t => t.id));
              ui.mappingWarnings = [...new Set(records ? records.filter(r => visible.has(r.tattooId)).map(r => r.message) : (value.warnings || []))];
              state.mappingWarnings = copy(ui.mappingWarnings);
            }
            if (warningsAreCurrent && ui.mappingWarnings.length) sayUI(ui.mappingWarnings.join(' '));
            else if (previous && ui.status === previous) sayUI('Drag to orbit · choose tattoos to edit.');
            else publishUI();
          },
          onPreview(value) { if (live()) { ui.preview = value; publishUI(); } },
          onError(error) { if (live()) { state.lastRenderOK = false; ui.previewError = error?.message || 'Preview paused.'; sayUI('Preview unavailable. Change the view to retry, or reload the preview. Workspace backup is available.'); } },
        });
        engine = await pendingEngine;
        if (!live()) { await disposeEngine(engine); return; }
        state.studio = engine;
        await engine.setQuality(ui.quality);
        if (!live()) return;
        if (!await sync.renderScene()) throw Error('The body preview could not be rendered.');
        if (!live()) return;
        if (new URLSearchParams(browser.location?.search || '').get('view') === 'studio') await chooseCamera('body');
        else if (controller.active().camera) { state.currentView = 'custom'; engine.restoreCamera(controller.active().camera); }
        else await chooseCamera('body');
        if (!live()) return;
        state.ready = true; ui.loading = false; ui.error = ''; ui.previewError = '';
        if (!state.dirty && !state.conflict && !ui.saveError) ui.saveLabel = storageMode === 'browser' ? 'Saved in this browser' : 'Saved to workspace';
        say(controller.active().tattoos.length ? 'Drag to orbit. Choose Place on body to move selected ink.' : 'Choose artwork to begin your study.');
      } catch (error) {
        if (!live()) return;
        await cleanup();
        if (generation !== viewportGeneration) return;
        console.error(error); ui.error = error.message; ui.loading = false;
        if (state.workspace) ui.previewError ||= error.message;
        else { ui.saveLabel = 'Not connected'; ui.saveError = true; }
        say('Preview unavailable. Try again to reload the preview.');
      }
    })();
    return cleanup;
  }
  publish();
  return {
    actions, initialize, attachViewport,
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setArtworkPreview(adapter) { previewAdapter = adapter; },
    hasUnsavedChanges: () => state.dirty || state.saving || state.conflict,
    flush: sync.flush,
    dispose() {
      updatePlacing(false); releasePlacementMedia();
      releaseViewport?.(); previewAdapter?.destroy(); previewAdapter = null;
      actions.resolveName(null); listeners.clear();
      (clock?.clearTimeout || clearTimeout)(state.saveTimer);
    },
  };
}
