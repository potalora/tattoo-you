import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../studio/application.js';
import {project, addTattoo, MAX_TATTOOS} from '../studio/model.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
}
async function until(predicate, label = 'application state') {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(`Timed out waiting for ${label}`);
}
function hostNode() {
  return {
    children: [], dataset: {},
    appendChild(node) { this.children.push(node); node.parentNode = this; return node; },
    removeChild(node) { this.children = this.children.filter(child => child !== node); node.parentNode = null; },
  };
}
function harness({full = false, extraStudy = false, initialGate, engineGate, deleteGate, initialQuality, qualityGate, failBackup = false, failRestore = false, beforePut = async () => {}, update = async () => {}, dispose = () => {}} = {}) {
  const study = project('Original study');
  study.notes = 'Original notes';
  const asset = {id: 'artwork', name: 'A rose', url: '/rose.png', width: 100, height: 150};
  if (full) for (let index = 0; index < MAX_TATTOOS; index++) addTattoo(study, asset);
  const persisted = {revision: 0, projects: [study, ...(extraStudy ? [project('Another study')] : [])], activeProjectId: study.id, assets: [asset]};
  const calls = [], engines = [], layouts = [], downloads = [], timers = new Map();
  let timerId = 0;
  const clock = {setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }};
  const browser = {location: {search: ''}, document: {body: {inert: false}}, Blob: globalThis.Blob, confirm: () => true};
  const api = async (path, method = 'GET', payload) => {
    calls.push({path, method, payload: payload === undefined ? undefined : structuredClone(payload)});
    if (path === 'workspace' && method === 'GET') {
      if (initialGate) await initialGate.promise;
      return structuredClone(persisted);
    }
    if (path === 'workspace' && method === 'PUT') {
      await beforePut(payload);
      persisted.projects = structuredClone(payload.projects);
      persisted.activeProjectId = payload.activeProjectId;
      return {revision: ++persisted.revision};
    }
    if (path === 'assets/artwork' && method === 'DELETE') {
      if (deleteGate) await deleteGate.promise;
      persisted.assets = persisted.assets.filter(asset => asset.id !== 'artwork');
      return {deleted: 'artwork', revision: ++persisted.revision};
    }
    if (path === 'assets' && method === 'POST') return {id: 'uploaded-artwork', url: '/new.png', ...payload};
    if (path === 'backup') {
      if (failBackup) throw Error('Backup server unavailable');
      return {version: 3, assets: structuredClone(persisted.assets)};
    }
    if (path === 'restore' && method === 'POST') {
      if (failRestore) throw Error('Restore server unavailable');
      return structuredClone(persisted);
    }
    throw Error(`Unexpected API request ${method} ${path}`);
  };
  const createStudio = async (host, options) => {
    const canvas = {style: {}, remove() { this.parentNode?.removeChild(this); }};
    host.appendChild(canvas);
    const engine = {
      options, canvas, renderer: {domElement: canvas}, updates: [], views: [], lighting: [], qualities: [], disposed: 0,
      async update(...args) { this.updates.push(structuredClone(args)); await update(...args); },
      view(name) { this.views.push(name); },
      restoreCamera(camera) { this.restoredCamera = structuredClone(camera); },
      getCamera() { return {position: [0, 1, 4], target: [0, 1, 0]}; },
      getAnchor() { return {faceIndex: 1, barycentric: [.2, .3, .5]}; },
      refreshLayout() { this.refreshed = (this.refreshed || 0) + 1; },
      setPlaceMode(value) { this.placing = value; },
      setLighting(value) { this.lighting.push(value); },
      async setQuality(value) { this.qualities.push(value); if (qualityGate) await qualityGate.promise; },
      raytrace() { this.traces = (this.traces || 0) + 1; },
      cancelRaytrace() { this.cancelled = (this.cancelled || 0) + 1; },
      dispose() { this.disposed++; canvas.remove(); return dispose(this); },
    };
    engines.push(engine);
    if (engineGate) await engineGate.promise;
    return engine;
  };
  const observeLayout = options => {
    const layout = {options, disposed: 0, measure: () => ({x: 0, y: 0, width: 800, height: 700}), dispose() { this.disposed++; }};
    layouts.push(layout);
    return layout;
  };
  const app = createApplication({createStudio, api, browser, observeLayout, clock, initialQuality,
    regions: [{id: 'leftUpperArm', label: 'Left upper arm'}],
    fileServices: {
      raster: async () => ({width: 100, height: 100, dataUrl: 'data:image/png;base64,test'}),
      download: (name, blob) => downloads.push({name, blob}),
    },
  });
  const host = hostNode();
  const attach = () => app.attachViewport(host, {});
  const mount = async () => { const release = attach(); await until(() => app.getSnapshot().ui.ready, 'ready viewport'); return release; };
  return {app, host, attach, mount, persisted, study, asset, calls, engines, layouts, downloads, timers, browser};
}

test('explicit initial high quality is applied before rendering the study', async t => {
  const qualityGate = deferred(), h = harness({initialQuality: 'high', qualityGate});
  t.after(() => h.app.dispose());
  assert.equal(h.app.getSnapshot().ui.quality, 'high');
  h.attach();
  await until(() => h.engines[0]?.qualities.length, 'initial quality application');
  assert.deepEqual(h.engines[0].qualities, ['high']);
  assert.equal(h.engines[0].updates.length, 0, 'quality resize must complete before study rendering');
  qualityGate.resolve();
  await until(() => h.app.getSnapshot().ui.ready);
  assert.ok(h.engines[0].updates.length > 0);
});

test('high quality survives workspace reset and renderer recovery', async t => {
  let broken = false;
  const h = harness({initialQuality: 'high', update: async () => { if (broken) throw Error('GPU unavailable'); }});
  t.after(() => h.app.dispose()); t.mock.method(console, 'error', () => {});
  await h.mount();
  await h.app.actions.restoreBackup({size: 100, text: async () => JSON.stringify({version: 3})});
  assert.equal(h.app.getSnapshot().ui.quality, 'high');
  broken = true;
  h.attach(); await until(() => Boolean(h.app.getSnapshot().ui.error), 'failed replacement renderer');
  broken = false;
  await h.mount();
  assert.equal(h.app.getSnapshot().ui.quality, 'high');
  assert.deepEqual(h.engines.map(engine => engine.qualities), [['high'], ['high'], ['high']]);
});

test('default or invalid initial quality remains automatic and a later choice survives remount', async t => {
  for (const initialQuality of [undefined, 'invalid']) {
    const h = harness({initialQuality}); t.after(() => h.app.dispose());
    await h.mount();
    assert.equal(h.app.getSnapshot().ui.quality, 'auto');
    assert.deepEqual(h.engines[0].qualities, ['auto']);
    h.app.actions.setQuality('efficient');
    await h.mount();
    assert.equal(h.app.getSnapshot().ui.quality, 'efficient');
    assert.deepEqual(h.engines[1].qualities, ['efficient']);
  }
});

test('application snapshots are cached, deeply immutable copies and subscriptions unsubscribe', async t => {
  const h = harness(); t.after(() => h.app.dispose());
  const initial = h.app.getSnapshot();
  assert.equal(h.app.getSnapshot(), initial);
  let notifications = 0;
  const unsubscribe = h.app.subscribe(() => { notifications++; });
  await h.app.initialize();
  const loaded = h.app.getSnapshot();
  assert.notEqual(loaded, initial); assert.equal(loaded, h.app.getSnapshot());
  assert.ok(Object.isFrozen(loaded)); assert.ok(Object.isFrozen(loaded.study.body)); assert.ok(Object.isFrozen(loaded.workspace.projects));
  assert.throws(() => { loaded.study.body.stature = 190; }, TypeError);
  assert.throws(() => { loaded.workspace.assets.push({id: 'injected'}); }, TypeError);
  assert.equal(h.persisted.projects[0].body.stature, h.study.body.stature);
  assert.equal(notifications, 1); unsubscribe();
  h.app.actions.setArtSearch('rose');
  assert.equal(notifications, 1); assert.equal(loaded.ui.artSearch, '');
  assert.equal(h.app.getSnapshot().ui.artSearch, 'rose');
});

test('capacity failure leaves study, history, navigation and placement focus unchanged', async t => {
  const h = harness({full: true}); t.after(() => h.app.dispose()); await h.mount();
  h.app.actions.showSurface('artwork');
  const before = h.app.getSnapshot();
  const renders = h.engines[0].updates.length;
  assert.equal(h.app.actions.addArtwork(h.asset.id), false);
  const after = h.app.getSnapshot();
  assert.deepEqual(after.study, before.study); assert.equal(after.ui.surface, 'artwork');
  assert.equal(after.ui.focusPlacement, before.ui.focusPlacement);
  assert.equal(after.ui.canUndo, before.ui.canUndo); assert.equal(h.engines[0].updates.length, renders);
  assert.match(after.ui.status, /hold 16 tattoos/); assert.doesNotMatch(after.ui.status, /Added to study/);
  assert.equal(h.app.hasUnsavedChanges(), false); assert.equal(h.timers.size, 0);
});

test('import mode changes preserve stage framing, status and study history', async t => {
  const h = harness(); t.after(() => h.app.dispose()); await h.mount();
  h.app.actions.showSurface('artwork');
  h.engines[0].options.onStats({warnings: ['Temporary renderer warning']});
  h.engines[0].options.onStats({warnings: []});
  const engine = h.engines[0], before = h.app.getSnapshot(), camera = engine.getCamera();
  assert.match(before.ui.status, /^Drag to orbit/, 'fixture starts with the unobtrusive stage status');
  const updates = engine.updates.length, views = [...engine.views], refreshed = engine.refreshed, calls = h.calls.length;
  for (const existing of [true, false, true, false]) {
    h.app.actions.setImportExisting(existing);
    const next = h.app.getSnapshot();
    assert.equal(next.ui.importExisting, existing, 'the import panel receives the checkbox state');
    assert.equal(next.ui.status, before.ui.status, 'import guidance must not reveal or resize the stage status');
    assert.equal(next.ui.surface, before.ui.surface); assert.equal(next.ui.panelState, before.ui.panelState);
    assert.equal(next.study, before.study); assert.equal(next.workspace, before.workspace);
    assert.equal(next.ui.canUndo, before.ui.canUndo); assert.equal(next.ui.canRedo, before.ui.canRedo);
  }
  await tick();
  assert.equal(engine.updates.length, updates); assert.deepEqual(engine.views, views);
  assert.deepEqual(engine.getCamera(), camera); assert.equal(engine.refreshed, refreshed);
  assert.equal(h.calls.length, calls); assert.equal(h.app.hasUnsavedChanges(), false);
  engine.options.onStats({warnings: ['Existing renderer warning']});
  h.app.actions.setImportExisting(true);
  assert.equal(h.app.getSnapshot().ui.status, 'Existing renderer warning', 'checkbox does not replace an existing warning either');
});

test('UI-only commands and renderer telemetry reuse the immutable domain snapshot', async t => {
  const h = harness(); t.after(() => h.app.dispose()); await h.mount();
  const before = h.app.getSnapshot(), engine = h.engines[0];
  const events = [
    () => h.app.actions.setArtSearch('rose'),
    () => h.app.actions.showSurface('body'),
    () => h.app.actions.togglePanel(),
    () => h.app.actions.openDialog('help'),
    () => h.app.actions.closeDialog(),
    () => h.app.actions.setImportExisting(true),
    () => h.app.actions.setLighting('neutral'),
    () => h.app.actions.setQuality('efficient'),
    () => engine.options.onStats({renderer: 'WebGPU', warnings: ['Test warning']}),
    () => engine.options.onStats({renderer: 'WebGPU', warnings: []}),
    () => engine.options.onPreview({phase: 'rendering', samples: 10}),
    () => engine.options.onMeasurements({waist: 80}),
  ];
  let previous = before, notifications = 0;
  const unsubscribe = h.app.subscribe(() => { notifications++; });
  for (const event of events) {
    event();
    const next = h.app.getSnapshot();
    assert.notEqual(next, previous); assert.notEqual(next.ui, previous.ui);
    assert.equal(next.workspace, before.workspace); assert.equal(next.study, before.study);
    assert.equal(next.workspace.assets, before.workspace.assets);
    assert.ok(Object.isFrozen(next.ui)); assert.ok(Object.isFrozen(next.study.body));
    previous = next;
  }
  unsubscribe();
  assert.equal(notifications, events.length);
  assert.equal(before.ui.artSearch, ''); assert.equal(before.ui.surface, 'composition');
  assert.deepEqual(before.ui.stats, {}); assert.deepEqual(before.ui.preview, {phase: 'idle'});
  assert.deepEqual(before.ui.measurements, {});
  assert.equal(previous.ui.artSearch, 'rose'); assert.equal(previous.ui.stats.renderer, 'WebGPU');
  assert.equal(previous.ui.preview.samples, 10); assert.equal(previous.ui.measurements.waist, 80);
});

test('domain edits, persistence acknowledgements and study switches invalidate cached domain copies', async t => {
  const h = harness({extraStudy: true}); t.after(() => h.app.dispose()); await h.mount();
  const before = h.app.getSnapshot(), originalStature = before.study.body.stature;
  const nextStudyId = before.workspace.projects[1].id;
  h.app.actions.editBody('stature', originalStature + 3);
  h.app.actions.endGesture('stature');
  const edited = h.app.getSnapshot();
  assert.notEqual(edited.workspace, before.workspace); assert.notEqual(edited.study, before.study);
  assert.equal(edited.study.body.stature, originalStature + 3);
  assert.equal(before.study.body.stature, originalStature);
  assert.equal(await h.app.flush(), true);
  const saved = h.app.getSnapshot();
  assert.notEqual(saved.workspace, edited.workspace);
  assert.equal(saved.workspace.revision, h.persisted.revision);
  assert.equal(edited.workspace.revision, before.workspace.revision);
  h.app.actions.setArtSearch('after saving');
  assert.equal(h.app.getSnapshot().workspace, saved.workspace);
  assert.equal(await h.app.actions.switchProject(nextStudyId), true);
  const switched = h.app.getSnapshot();
  assert.notEqual(switched.workspace, saved.workspace); assert.notEqual(switched.study, saved.study);
  assert.equal(switched.study.id, nextStudyId); assert.equal(switched.workspace.activeProjectId, nextStudyId);
  assert.equal(saved.study.id, before.study.id); assert.equal(saved.workspace.activeProjectId, before.study.id);
  assert.equal(before.study.camera, null);
  assert.equal(switched.workspace.projects[0].body.stature, originalStature + 3);
  assert.ok(Object.isFrozen(switched.workspace.projects[0].camera));
});

test('body and skin gestures produce one undo step and notes are owned before blur', async t => {
  const h = harness(); t.after(() => h.app.dispose()); await h.mount();
  const original = h.app.getSnapshot().study.body.stature;
  h.app.actions.editBody('stature', 181); h.app.actions.editBody('stature', 184); h.app.actions.editBody('stature', 188);
  h.app.actions.undo(); assert.equal(h.app.getSnapshot().study.body.stature, original); assert.equal(h.app.getSnapshot().ui.canUndo, false);
  h.app.actions.redo(); assert.equal(h.app.getSnapshot().study.body.stature, 188);
  const originalTone = h.app.getSnapshot().study.body.skin;
  h.app.actions.setSkinColor('#aabbcc'); h.app.actions.setSkinColor('#112233');
  h.app.actions.endGesture('skin-color'); h.app.actions.undo();
  assert.equal(h.app.getSnapshot().study.body.skin, originalTone);
  h.app.actions.setNotes('Typed without blur'); h.app.actions.setNotes('Typed without blur, then refined');
  assert.equal(h.app.getSnapshot().study.notes, 'Typed without blur, then refined');
  await h.app.flush();
  assert.equal(h.persisted.projects[0].notes, 'Typed without blur, then refined');
  h.app.actions.undo(); assert.equal(h.app.getSnapshot().study.notes, 'Original notes');
  h.app.actions.redo(); assert.equal(h.app.getSnapshot().study.notes, 'Typed without blur, then refined');
});

test('persisted domain actions update the workspace while UI changes keep one canvas and renderer', async t => {
  const h = harness(); t.after(() => h.app.dispose()); await h.mount();
  const engine = h.engines[0], canvas = h.host.children[0], renders = engine.updates.length;
  h.app.actions.showSurface('body'); h.app.actions.togglePanel(); h.app.actions.setArtSearch('rose');
  h.app.actions.openDialog('help'); h.app.actions.closeDialog();
  engine.options.onStats({renderer: 'WebGPU', kernel: 'WASM', pixelRatio: 1});
  engine.options.onPreview({phase: 'rendering', samples: 10});
  engine.options.onMeasurements({waist: 80});
  h.app.actions.setLighting('neutral'); h.app.actions.setQuality('efficient');
  assert.equal(h.engines.length, 1); assert.equal(h.host.children.length, 1); assert.equal(h.host.children[0], canvas);
  assert.equal(engine.updates.length, renders); assert.equal(engine.disposed, 0);
  assert.deepEqual(engine.lighting, ['neutral']); assert.deepEqual(engine.qualities, ['auto', 'efficient']);
  assert.equal(h.app.actions.addArtwork(h.asset.id), true);
  h.app.actions.renameLayer('My rose'); h.app.actions.editTattoo('width', 12); h.app.actions.endGesture('width');
  h.app.actions.setSkinColor('#ABCDEF'); h.app.actions.endGesture('skin-color');
  h.app.actions.editBody('mass', 72); h.app.actions.endGesture('mass'); h.app.actions.setNotes('Ask about fit.');
  assert.equal(await h.app.flush(), true);
  const saved = h.persisted.projects[0];
  assert.equal(saved.tattoos.length, 1); assert.equal(saved.tattoos[0].name, 'My rose'); assert.equal(saved.tattoos[0].width, 12);
  assert.equal(saved.body.skinColor, '#abcdef'); assert.equal(saved.body.mass, 72); assert.equal(saved.notes, 'Ask about fit.');
  assert.equal(h.app.hasUnsavedChanges(), false); assert.equal(h.host.children[0], canvas);
});

test('unmount before delayed workspace initialization prevents renderer creation', async () => {
  const gate = deferred(), h = harness({initialGate: gate});
  const release = h.attach(); release(); gate.resolve();
  await h.app.initialize(); await tick();
  assert.equal(h.engines.length, 0); assert.equal(h.layouts.length, 0); assert.equal(h.host.children.length, 0);
  assert.equal(h.app.getSnapshot().ui.ready, false); h.app.dispose();
});

test('unmount during delayed renderer creation disposes its late result once', async () => {
  const gate = deferred(), h = harness({engineGate: gate});
  const release = h.attach(); await until(() => h.engines.length === 1, 'pending renderer');
  const engine = h.engines[0]; release(); release();
  assert.equal(h.layouts[0].disposed, 1); assert.equal(engine.disposed, 0);
  gate.resolve(); await until(() => engine.disposed === 1, 'late renderer disposal');
  assert.equal(h.host.children.length, 0); assert.equal(h.app.getSnapshot().ui.ready, false);
  engine.options.onPreview({phase: 'complete', samples: 32});
  assert.equal(h.app.getSnapshot().ui.preview.phase, 'idle');
  h.app.dispose(); assert.equal(engine.disposed, 1);
});

test('replacement mount waits for a cancelled pending renderer to be disposed', async t => {
  const gate = deferred(), h = harness({engineGate: gate});
  t.after(() => h.app.dispose());
  h.attach(); await until(() => h.engines.length === 1, 'first pending renderer');
  h.attach(); await tick();
  assert.equal(h.engines.length, 1, 'new creation cannot overlap the cancelled renderer');
  gate.resolve(); await until(() => h.app.getSnapshot().ui.ready, 'replacement viewport');
  assert.equal(h.engines.length, 2); assert.equal(h.engines[0].disposed, 1); assert.equal(h.layouts[0].disposed, 1);
  assert.equal(h.engines[1].disposed, 0); assert.equal(h.host.children.length, 1); assert.equal(h.host.children[0], h.engines[1].canvas);
  h.engines[0].options.onStats({renderer: 'obsolete'});
  assert.notEqual(h.app.getSnapshot().ui.stats.renderer, 'obsolete', 'cancelled callbacks cannot overwrite the new viewport');
});

test('viewport release publishes unavailable state and remount owns exactly one canvas', async t => {
  const h = harness(); const release = await h.mount();
  t.after(() => h.app.dispose());
  const first = h.engines[0]; release();
  assert.equal(first.disposed, 1); assert.equal(h.host.children.length, 0);
  assert.equal(h.app.getSnapshot().ui.ready, false, 'immutable snapshot must report the renderer is unavailable');
  await h.mount();
  assert.equal(h.engines.length, 2); assert.equal(h.host.children.length, 1); assert.equal(h.engines[1].disposed, 0);
  h.app.dispose(); assert.equal(h.engines[1].disposed, 1); assert.equal(h.host.children.length, 0);
});

test('failed first render disposes its renderer and layout immediately', async t => {
  t.mock.method(console, 'error', () => {});
  const h = harness({update: async () => { throw Error('Initial body failed'); }});
  t.after(() => h.app.dispose());
  h.attach(); await until(() => Boolean(h.app.getSnapshot().ui.error), 'initial render error');
  assert.match(h.app.getSnapshot().ui.error, /could not be rendered/);
  assert.equal(h.app.getSnapshot().ui.ready, false);
  assert.equal(h.engines[0].disposed, 1, 'failed initialization must release allocated renderer resources');
  assert.equal(h.layouts[0].disposed, 1, 'failed initialization must release observers');
  assert.equal(h.host.children.length, 0);
});

test('obsolete initialization failure cannot publish after deferred disposal and replacement mount', async t => {
  t.mock.method(console, 'error', () => {});
  const gate = deferred();
  let updates = 0;
  const h = harness({
    update: async () => { if (++updates === 1) throw Error('Initial body failed'); },
    dispose: engine => engine === h.engines[0] ? gate.promise : undefined,
  });
  t.after(() => h.app.dispose());
  h.attach(); await until(() => h.engines[0]?.disposed === 1, 'failed renderer disposal');
  h.attach();
  assert.equal(h.app.getSnapshot().ui.loading, true);
  const errors = [];
  const unsubscribe = h.app.subscribe(() => { if (h.app.getSnapshot().ui.error) errors.push(h.app.getSnapshot().ui.error); });
  gate.resolve(); await until(() => h.app.getSnapshot().ui.ready, 'replacement after failed renderer');
  unsubscribe();
  const recovered = h.app.getSnapshot();
  assert.equal(h.engines.length, 2); assert.equal(h.engines[0].disposed, 1); assert.equal(h.engines[1].disposed, 0);
  assert.equal(h.host.children.length, 1); assert.equal(h.host.children[0], h.engines[1].canvas);
  assert.equal(recovered.ui.error, ''); assert.equal(recovered.ui.saveError, false); assert.equal(recovered.ui.loading, false);
  assert.deepEqual(errors, [], 'obsolete failure must never reach replacement subscribers, even transiently');
});

test('replacement initialization clears a previously published viewport failure', async t => {
  t.mock.method(console, 'error', () => {});
  let updates = 0;
  const h = harness({update: async () => { if (++updates === 1) throw Error('Initial body failed'); }});
  t.after(() => h.app.dispose());
  h.attach(); await until(() => Boolean(h.app.getSnapshot().ui.error), 'published viewport failure');
  assert.equal(h.app.getSnapshot().ui.saveError, false); assert.equal(h.app.getSnapshot().ui.loading, false);
  assert.equal(h.app.getSnapshot().ui.previewError, 'Initial body failed', 'keep the original preview diagnostic');
  h.attach();
  const opening = h.app.getSnapshot();
  assert.equal(opening.ui.loading, true); assert.equal(opening.ui.error, ''); assert.equal(opening.ui.saveError, false);
  await until(() => h.app.getSnapshot().ui.ready, 'recovered viewport');
  assert.equal(h.app.getSnapshot().ui.error, ''); assert.equal(h.app.getSnapshot().ui.saveError, false);
});

test('application disposal destroys artwork preview adapter and clears pending saves', async () => {
  const h = harness(); await h.mount();
  let destroyed = 0; h.app.setArtworkPreview({destroy() { destroyed++; }});
  h.app.actions.setNotes('Pending save'); assert.equal(h.timers.size, 1);
  h.app.dispose(); h.app.dispose();
  assert.equal(destroyed, 1); assert.equal(h.engines[0].disposed, 1); assert.equal(h.layouts[0].disposed, 1); assert.equal(h.timers.size, 0);
});

test('backup failures appear in the open dialog and failed restores preserve the original study', async t => {
  for (const scenario of ['invalid-json', 'wrong-version', 'export-unavailable', 'restore-unavailable']) {
    const h = harness({failBackup: scenario === 'export-unavailable', failRestore: scenario === 'restore-unavailable'});
    t.after(() => h.app.dispose()); await h.mount(); h.app.actions.openDialog('data');
    const before = h.app.getSnapshot().study;
    const result = scenario === 'export-unavailable'
      ? await h.app.actions.exportBackup()
      : await h.app.actions.restoreBackup({text: async () => scenario === 'invalid-json' ? '{invalid' : JSON.stringify({version: scenario === 'wrong-version' ? 2 : 3})});
    assert.equal(result, false, scenario);
    const snapshot = h.app.getSnapshot();
    assert.equal(snapshot.ui.dialog, 'data'); assert.match(snapshot.ui.dataStatus, /^Backup did not complete: /, scenario);
    assert.doesNotMatch(snapshot.ui.dataStatus, /Workspace exported/, 'pre-restore backup success cannot mask the later restore failure');
    if (scenario === 'wrong-version') assert.match(snapshot.ui.dataStatus, /Choose an INKFORM workspace backup/);
    if (scenario.endsWith('unavailable')) assert.match(snapshot.ui.dataStatus, /server unavailable/);
    assert.deepEqual(snapshot.study, before); assert.equal(snapshot.ui.blocked, false); assert.equal(h.browser.document.body.inert, false);
    assert.equal(h.downloads.length, scenario === 'restore-unavailable' ? 1 : 0, scenario);
  }
});

test('group reanchoring is rejected while single editable plus locked layers can place',async t=>{
 const h=harness();t.after(()=>h.app.dispose());await h.mount();
 h.app.actions.addArtwork(h.asset.id);h.app.actions.addArtwork(h.asset.id);h.app.actions.selectAll();
 const before=h.app.getSnapshot().study.tattoos;
 assert.equal(h.app.getSnapshot().selection?.canReanchor,false);
 assert.equal(await h.app.actions.setRegion('leftUpperArm'),false);
 h.app.actions.togglePlace();h.engines[0].options.onPlace({faceIndex:99,barycentric:[1,0,0]});
 assert.deepEqual(h.app.getSnapshot().study.tattoos,before);
 h.app.actions.layerAction(before[0].id,'locked');
 assert.equal(h.app.getSnapshot().selection.canReanchor,true);
 await h.app.actions.setRegion('leftUpperArm');
 assert.deepEqual(h.app.getSnapshot().study.tattoos[0],{...before[0],locked:true});
 assert.equal(h.app.getSnapshot().study.tattoos[1].placement.faceIndex,1);
});

test('preview failure preserves saved storage status and backup; retry recovers',async t=>{
 t.mock.method(console,'error',()=>{});let broken=true;
 const h=harness({update:async()=>{if(broken)throw Error('GPU failure');}});t.after(()=>h.app.dispose());
 h.attach();await until(()=>!h.app.getSnapshot().ui.loading);
 const failed=h.app.getSnapshot();assert.equal(failed.ui.saveError,false);assert.equal(failed.ui.saveLabel,'Saved in this browser');
 assert.equal(failed.ui.hasUnsavedChanges,false);assert.match(failed.ui.status,/Preview unavailable/);assert.doesNotMatch(failed.ui.status,/Opening|saved study is safe/i);
 assert.match(failed.ui.previewError,/rendered|GPU/);assert.equal(await h.app.actions.saveImage(),false);
 await h.app.actions.exportBackup();assert.equal(h.downloads.length,1);
 broken=false;await h.mount();assert.equal(h.app.getSnapshot().ui.previewError,'');
});

test('preview failure reports terminal status while retaining unsaved edits and the save cause',async t=>{
 t.mock.method(console,'error',()=>{});let unavailable=false,broken=false;
 const h=harness({beforePut:async()=>{if(unavailable)throw Error('Quota full');},update:async()=>{if(broken)throw Error('GPU unavailable');}});t.after(()=>h.app.dispose());await h.mount();
 unavailable=true;h.app.actions.setNotes('Open edits');assert.equal(await h.app.flush(),false);
 h.engines[0].options.onError(Error('Device lost'));
 let failed=h.app.getSnapshot();assert.equal(failed.ui.hasUnsavedChanges,true);assert.equal(failed.ui.saveFailure,'Quota full');assert.match(failed.ui.status,/Preview unavailable/);assert.doesNotMatch(failed.ui.status,/saved study is safe|Opening/i);
 broken=true;h.attach();await until(()=>!h.app.getSnapshot().ui.loading);
 failed=h.app.getSnapshot();assert.equal(failed.study.notes,'Open edits');assert.equal(failed.ui.hasUnsavedChanges,true);assert.equal(failed.ui.saveFailure,'Quota full');assert.match(failed.ui.status,/Preview unavailable/);assert.match(failed.ui.previewError,/GPU unavailable/);
});

test('save cause and error survive later feedback, edits and pending retries until all edits persist',async t=>{
 let mode='okay';const firstRetry=deferred(),secondRetry=deferred();let retryWrites=0;
 const h=harness({beforePut:async()=>{if(mode==='fail')throw Error('Workspace unavailable');if(mode==='retry')await (++retryWrites===1?firstRetry:secondRetry).promise;}});t.after(()=>h.app.dispose());await h.mount();
 h.app.actions.setNotes('First edit');assert.equal(h.app.getSnapshot().ui.hasUnsavedChanges,true);
 mode='fail';assert.equal(await h.app.flush(),false);
 h.app.actions.addArtwork(h.asset.id);h.app.actions.setNotes('Second edit');
 let ui=h.app.getSnapshot().ui;assert.equal(ui.saveFailure,'Workspace unavailable');assert.equal(ui.saveError,true);assert.equal(ui.hasUnsavedChanges,true);assert.match(ui.status,/Added to study/);
 mode='retry';const saving=h.app.actions.retrySave();await tick();
 ui=h.app.getSnapshot().ui;assert.equal(ui.saveFailure,'Workspace unavailable');assert.equal(ui.saveError,true);assert.equal(ui.hasUnsavedChanges,true);assert.match(ui.saveLabel,/Unsaved/);assert.equal(ui.retry.hidden,false);
 h.app.actions.setNotes('Newest edit');firstRetry.resolve();await until(()=>retryWrites===2);
 ui=h.app.getSnapshot().ui;assert.equal(ui.saveFailure,'Workspace unavailable');assert.equal(ui.saveError,true);assert.equal(ui.hasUnsavedChanges,true);assert.doesNotMatch(ui.saveLabel,/^Saved/);
 secondRetry.resolve();assert.equal(await saving,true);
 ui=h.app.getSnapshot().ui;assert.equal(ui.saveFailure,'');assert.equal(ui.saveError,false);assert.equal(ui.hasUnsavedChanges,false);assert.equal(ui.retry.hidden,true);assert.equal(h.persisted.projects[0].notes,'Newest edit');
});

test('study naming requests identify creation, rename and a separate alternative',async t=>{
 const h=harness();t.after(()=>h.app.dispose());await h.mount();
 const before=h.app.getSnapshot().study;
 for(const [action,label]of [['newProject','Create study'],['renameProject','Rename study'],['saveAlternative','Create alternative']]){
  const pending=h.app.actions[action]();const request=h.app.getSnapshot().ui.nameRequest;
  assert.equal(request.submitLabel,label);
  if(action==='saveAlternative')assert.match(request.description,/original.*kept/i);
  h.app.actions.resolveName(null);await pending;assert.deepEqual(h.app.getSnapshot().study,before);
 }
});

test('empty and null-active restores immediately adopt a usable editable study',async t=>{
 for(const empty of [true,false]){
  const h=harness();t.after(()=>h.app.dispose());await h.mount();
  h.persisted.activeProjectId=null;if(empty)h.persisted.projects=[];
  assert.equal(await h.app.actions.restoreBackup({size:20,text:async()=>JSON.stringify({version:3})}),true);
  assert.ok(h.app.getSnapshot().study);h.app.actions.editBody('stature',180);h.app.actions.endGesture('stature');
  assert.equal(await h.app.flush(),true);assert.equal(h.persisted.projects[0].body.stature,180);
  const creating=h.app.actions.newProject();h.app.actions.resolveName('New after restore');assert.equal(await creating,true);
 }
});

test('mapping warnings persist across UI messages but clear with composition and study changes',async t=>{
 const h=harness({extraStudy:true});t.after(()=>h.app.dispose());await h.mount();h.app.actions.addArtwork(h.asset.id);await tick();
 const engine=h.engines[0];engine.options.onStats({warnings:['Seam crossing']});
 h.app.actions.setNotes('Discuss fit');h.app.actions.openDialog('workspace');
 assert.deepEqual(h.app.getSnapshot().ui.mappingWarnings,['Seam crossing']);
 h.app.actions.layerAction(h.app.getSnapshot().study.tattoos[0].id,'visible');
 assert.deepEqual(h.app.getSnapshot().ui.mappingWarnings,[]);
 await h.app.actions.switchProject(h.persisted.projects[1].id);assert.deepEqual(h.app.getSnapshot().ui.mappingWarnings,[]);
});

test('invalid numeric gesture preserves redo, dirty state and selection',async t=>{
 const h=harness();t.after(()=>h.app.dispose());await h.mount();
 h.app.actions.editBody('stature',180);h.app.actions.endGesture('stature');h.app.actions.undo();await h.app.flush();
 const before=h.app.getSnapshot();assert.equal(before.ui.canRedo,true);
 assert.equal(h.app.actions.editBody('stature',999),false);
 const after=h.app.getSnapshot();assert.deepEqual(after.study,before.study);assert.equal(after.ui.canRedo,true);
 assert.equal(after.ui.canUndo,before.ui.canUndo);assert.equal(h.app.hasUnsavedChanges(),false);
});

test('new study at capacity rejects before requesting a name or mutating cameras',async t=>{
 const h=harness();for(let i=1;i<100;i++)h.persisted.projects.push(project('Full '+i));
 t.after(()=>h.app.dispose());await h.mount();const before=h.app.getSnapshot();
 assert.equal(await h.app.actions.newProject(),false);const after=h.app.getSnapshot();
 assert.equal(after.ui.nameRequest,null);assert.deepEqual(after.workspace,before.workspace);assert.equal(h.app.hasUnsavedChanges(),false);
});

test('committed empty restore renders adopted study and resets history despite initialization save failure',async t=>{
 for(const conflict of [false,true]){
  let rejectWrites=false;
  const h=harness({beforePut:async()=>{
   if(!rejectWrites)return;
   if(conflict){const winner=project('Saved by other tab');h.persisted.projects=[winner];h.persisted.activeProjectId=winner.id;h.persisted.revision++;}
   throw Object.assign(Error(conflict?'Revision conflict':'Quota full'),conflict?{status:409}:{});
  }});t.after(()=>h.app.dispose());await h.mount();
  h.app.actions.addArtwork(h.asset.id);await h.app.flush();await until(()=>!h.app.getSnapshot().ui.rendering);
  assert.equal(h.app.getSnapshot().ui.canUndo,true);
  h.persisted.projects=[];h.persisted.activeProjectId=null;rejectWrites=true;
  assert.equal(await h.app.actions.restoreBackup({size:20,text:async()=>JSON.stringify({version:3})}),true);
  const adopted=h.app.getSnapshot();assert.equal(adopted.study.name,'My first study');assert.equal(adopted.ui.canUndo,false);
  assert.deepEqual(h.engines[0].updates.at(-1)[1],[], 'the new study owns the pixels before interaction returns');
  assert.equal(adopted.ui.saveError,true);assert.equal(adopted.ui.ready,true);assert.equal(adopted.ui.previewError,'');
  assert.match(adopted.ui.dataStatus,/restored.*not saved/i);assert.doesNotMatch(adopted.ui.dataStatus,/Backup did not complete/);
  rejectWrites=false;assert.equal(await h.app.actions.retrySave(),true);
  const recovered=h.app.getSnapshot();assert.equal(recovered.ui.saveError,false);
  assert.equal(recovered.study.name,conflict?'Saved by other tab':'My first study');
  assert.deepEqual(h.engines[0].updates.at(-1)[1],recovered.study.tattoos);
 }
});

test('failed geometry update rejects retained decal warning telemetry until matching composition renders',async t=>{
 t.mock.method(console,'error',()=>{});let fail=false;
 const h=harness({update:async()=>{if(fail)throw Error('New geometry unavailable');}});t.after(()=>h.app.dispose());await h.mount();
 h.app.actions.addArtwork(h.asset.id);await until(()=>!h.app.getSnapshot().ui.rendering);
 const engine=h.engines[0],id=h.app.getSnapshot().study.tattoos[0].id;
 engine.getMappingWarnings=()=>[{tattooId:id,message:'Warning from old geometry'}];
 engine.options.onStats({mappingWarnings:engine.getMappingWarnings(),warnings:['Warning from old geometry']});
 assert.deepEqual(h.app.getSnapshot().ui.mappingWarnings,['Warning from old geometry']);
 fail=true;h.app.actions.editBody('stature',180);h.app.actions.endGesture('stature');await until(()=>!h.app.getSnapshot().ui.rendering);
 assert.match(h.app.getSnapshot().ui.status,/Preview unavailable/);assert.equal(h.app.getSnapshot().ui.previewError,'New geometry unavailable');
 assert.deepEqual(h.app.getSnapshot().ui.mappingWarnings,[]);
 engine.options.onStats({mappingWarnings:engine.getMappingWarnings(),warnings:['Warning from old geometry']});
 assert.deepEqual(h.app.getSnapshot().ui.mappingWarnings,[], 'old geometry must not qualify active-composition warnings');
 assert.doesNotMatch(h.app.getSnapshot().ui.status,/Warning from old geometry/);
 assert.equal(await h.app.actions.saveImage(),false);
 fail=false;engine.getMappingWarnings=()=>[{tattooId:id,message:'Current geometry seam'}];await h.app.actions.chooseCamera('front');
 assert.deepEqual(h.app.getSnapshot().ui.mappingWarnings,['Current geometry seam']);
});

test('conflict reload resets old preview and history when empty saved copy normalization cannot save',async t=>{
 let mode='okay';
 const h=harness({beforePut:async()=>{
  if(mode==='conflict'){h.persisted.projects=[];h.persisted.activeProjectId=null;h.persisted.revision++;throw Object.assign(Error('Revision conflict'),{status:409});}
  if(mode==='quota')throw Error('Quota full');
 }});t.after(()=>h.app.dispose());await h.mount();h.app.actions.addArtwork(h.asset.id);await until(()=>!h.app.getSnapshot().ui.rendering);
 mode='conflict';assert.equal(await h.app.flush(),false);assert.equal(h.app.getSnapshot().ui.canUndo,true);
 mode='quota';assert.equal(await h.app.actions.retrySave(),true);
 const adopted=h.app.getSnapshot();assert.equal(adopted.study.name,'My first study');assert.equal(adopted.ui.canUndo,false);
 assert.equal(adopted.ui.saveError,true);assert.match(adopted.ui.dataStatus,/Saved copy loaded.*not saved/);
 assert.deepEqual(h.engines[0].updates.at(-1)[1],[]);
 mode='okay';assert.equal(await h.app.actions.retrySave(),true);assert.equal(h.app.getSnapshot().ui.saveError,false);
});

test('committed restore with failed save and failed new preview blocks editing until preview recovery',async t=>{
 t.mock.method(console,'error',()=>{});let failing=false;
 const h=harness({beforePut:async()=>{if(failing)throw Error('Quota full');},update:async()=>{if(failing)throw Error('Replacement preview failed');}});
 t.after(()=>h.app.dispose());await h.mount();h.app.actions.addArtwork(h.asset.id);await h.app.flush();await until(()=>!h.app.getSnapshot().ui.rendering);
 h.persisted.projects=[];h.persisted.activeProjectId=null;failing=true;
 assert.equal(await h.app.actions.restoreBackup({size:20,text:async()=>JSON.stringify({version:3})}),true);
 assert.equal(h.app.getSnapshot().ui.ready,false);assert.match(h.app.getSnapshot().ui.previewError,/Replacement preview failed/);
 assert.equal(h.app.actions.editBody('stature',180),false);assert.equal(await h.app.actions.saveImage(),false);
 failing=false;await h.mount();assert.equal(h.app.getSnapshot().ui.previewError,'');
 assert.equal(h.app.getSnapshot().study.name,'My first study');assert.deepEqual(h.engines.at(-1).updates.at(-1)[1],[]);
 assert.equal(await h.app.actions.retrySave(),true);
});

test('camera setup failure after committed restore blocks old pixels and reports committed data',async t=>{
 const h=harness();t.after(()=>h.app.dispose());await h.mount();h.persisted.projects=[];h.persisted.activeProjectId=null;
 h.engines[0].view=()=>{throw Error('Camera unavailable');};
 assert.equal(await h.app.actions.restoreBackup({size:20,text:async()=>JSON.stringify({version:3})}),true);
 assert.equal(h.app.getSnapshot().ui.ready,false);assert.match(h.app.getSnapshot().ui.previewError,/Camera unavailable/);
 assert.match(h.app.getSnapshot().ui.dataStatus,/restored.*Preview could not load/);assert.equal(await h.app.actions.saveImage(),false);
});

test('successful retry clears only the current save failure status and preserves newer feedback',async t=>{
 for(const newer of ['none','placement','mapping','action']){
  let unavailable=false;const h=harness({beforePut:async()=>{if(unavailable)throw Error('Browser storage unavailable. Your edits are still open; retry when it returns.');}});
  t.after(()=>h.app.dispose());await h.mount();h.app.actions.addArtwork(h.asset.id);await until(()=>!h.app.getSnapshot().ui.rendering);
  unavailable=true;assert.equal(await h.app.flush(),false);assert.match(h.app.getSnapshot().ui.status,/Browser storage unavailable/);
  if(newer==='placement')h.app.actions.togglePlace();
  if(newer==='mapping')h.engines[0].options.onStats({warnings:['Current seam limitation']});
  if(newer==='action')h.app.actions.addArtwork(h.asset.id);
  const message=h.app.getSnapshot().ui.status;unavailable=false;assert.equal(await h.app.actions.retrySave(),true);
  assert.equal(h.app.getSnapshot().ui.saveError,false);
  if(newer==='none')assert.doesNotMatch(h.app.getSnapshot().ui.status,/Browser storage unavailable/);
  else assert.equal(h.app.getSnapshot().ui.status,message);
 }
});

test('compact placement reveals canvas and restores the previous inspector state on every exit',async t=>{
 const {COMPACT_LAYOUT_QUERY}=await import('../studio/viewport-layout.js');
 for(const previous of ['normal','expanded','collapsed'])for(const exit of ['stop','escape','selection','locked','multi','study']){
  const h=harness({extraStudy:true});t.after(()=>h.app.dispose());await h.mount();
  h.browser.matchMedia=query=>{assert.equal(query,COMPACT_LAYOUT_QUERY);return {matches:true};};
  h.app.actions.addArtwork(h.asset.id);h.app.actions.addArtwork(h.asset.id);
  const [first,second]=h.app.getSnapshot().study.tattoos;
  h.app.actions.setPanelState(previous);h.app.actions.togglePlace();
  assert.equal(h.app.getSnapshot().ui.placing,true);assert.equal(h.app.getSnapshot().ui.panelState,'collapsed');
  if(exit==='stop'||exit==='escape')h.app.actions.stopPlacing(); // Escape routes to this same action in the UI owner.
  if(exit==='selection'){h.app.actions.selectLayer(second.id,false);h.app.actions.selectLayer(first.id,true);}
  if(exit==='locked')h.app.actions.layerAction(second.id,'locked');
  if(exit==='multi')h.app.actions.selectAll();
  if(exit==='study')await h.app.actions.switchProject(h.app.getSnapshot().workspace.projects[1].id);
  assert.equal(h.app.getSnapshot().ui.placing,false,exit);assert.equal(h.app.getSnapshot().ui.panelState,previous,exit);
 }
});

test('side-panel placement leaves inspector geometry unchanged',async t=>{
 const h=harness();t.after(()=>h.app.dispose());await h.mount();h.browser.matchMedia=()=>({matches:false});
 h.app.actions.addArtwork(h.asset.id);h.app.actions.setPanelState('expanded');h.app.actions.togglePlace();
 assert.equal(h.app.getSnapshot().ui.panelState,'expanded');h.app.actions.stopPlacing();assert.equal(h.app.getSnapshot().ui.panelState,'expanded');
});

test('placement follows sheet rotation and never overwrites the original inspector stop',async t=>{
 const {COMPACT_LAYOUT_QUERY}=await import('../studio/viewport-layout.js');
 for(const startsCompact of [false,true])for(const previous of ['normal','expanded','collapsed']){
  const h=harness();t.after(()=>h.app.dispose());await h.mount();
  const media=new EventTarget();media.matches=startsCompact;let added=0,removed=0;
  const add=media.addEventListener.bind(media),remove=media.removeEventListener.bind(media);
  media.addEventListener=(...args)=>{added++;add(...args);};media.removeEventListener=(...args)=>{removed++;remove(...args);};
  h.browser.matchMedia=query=>{assert.equal(query,COMPACT_LAYOUT_QUERY);return media;};
  h.app.actions.addArtwork(h.asset.id);h.app.actions.setPanelState(previous);h.app.actions.togglePlace();
  assert.equal(h.app.getSnapshot().ui.panelState,startsCompact?'collapsed':previous,'entry uses actual layout without replacing original stop');
  const study=h.app.getSnapshot().study;
  for(let cycle=0;cycle<2;cycle++){
   media.matches=true;media.dispatchEvent(new Event('change'));
   assert.equal(h.app.getSnapshot().ui.placing,true);assert.equal(h.app.getSnapshot().ui.panelState,'collapsed','rotating into portrait exposes the stage');
   assert.equal(h.app.actions.setPanelState('expanded'),false,'direct expansion is rejected while placing');
   assert.equal(h.app.actions.togglePanel(),false,'Controls cannot reopen the sheet while placing');
   h.app.actions.showSurface('body');assert.equal(h.app.getSnapshot().ui.panelState,'collapsed','surface navigation cannot reopen it');
   assert.equal(h.app.getSnapshot().study,study,'layout reconciliation does not mutate study/history');
   media.matches=false;media.dispatchEvent(new Event('change'));
   assert.equal(h.app.getSnapshot().ui.panelState,previous,'side layout recovers original stop without replacing it');
  }
  media.matches=true;media.dispatchEvent(new Event('change'));h.app.actions.stopPlacing();
  assert.equal(h.app.getSnapshot().ui.panelState,previous,'Stop restores the first entry stop');assert.equal(added,1);assert.equal(removed,1);
  media.matches=false;media.dispatchEvent(new Event('change'));assert.equal(h.app.getSnapshot().ui.panelState,previous,'ended placement has no live media observer');
  h.app.actions.togglePlace();h.app.dispose();assert.equal(removed,2,'disposing active placement removes its media listener');
 }
});

test('disposing during an in-flight composition render ignores late warning adoption',async t=>{
 const pending=deferred();let waitForRender=false,warningReads=0;
 const errors=[];t.mock.method(console,'error',(...args)=>errors.push(args));
 const h=harness({update:async()=>{if(waitForRender)await pending.promise;}});t.after(()=>h.app.dispose());await h.mount();
 h.engines[0].getMappingWarnings=()=>{warningReads++;return [{tattooId:'old',message:'Disposed geometry warning'}];};
 waitForRender=true;h.app.actions.addArtwork(h.asset.id);await until(()=>h.app.getSnapshot().ui.rendering);
 h.app.dispose();pending.resolve();await until(()=>!h.app.getSnapshot().ui.rendering);
 assert.deepEqual(errors,[], 'renderer disposal must not report a late composition callback as a preview failure');
 assert.equal(warningReads,0, 'late completion must not inspect a disposed renderer');
 assert.equal(h.app.getSnapshot().ui.ready,false);assert.equal(h.app.getSnapshot().ui.blocked,true);
 assert.deepEqual(h.app.getSnapshot().ui.mappingWarnings,[]);
});

test('storage retry and conflict recovery work after empty restore save and replacement preview both fail',async t=>{
 t.mock.method(console,'error',()=>{});
 for(const conflict of [false,true]){
  let failSave=false,failPreview=false;
  const h=harness({beforePut:async()=>{if(failSave)throw Object.assign(Error(conflict?'Revision conflict':'Quota full'),conflict?{status:409}:{});},update:async()=>{if(failPreview)throw Error('Replacement body unavailable');}});
  t.after(()=>h.app.dispose());await h.mount();h.app.actions.addArtwork(h.asset.id);await h.app.flush();await until(()=>!h.app.getSnapshot().ui.rendering);
  h.persisted.projects=[];h.persisted.activeProjectId=null;failSave=true;failPreview=true;
  assert.equal(await h.app.actions.restoreBackup({size:20,text:async()=>JSON.stringify({version:3})}),true);
  const failed=h.app.getSnapshot();assert.equal(failed.ui.ready,false);assert.equal(failed.ui.blocked,true);assert.equal(failed.ui.dataBlocked,false);assert.equal(failed.ui.saveError,true);assert.equal(failed.ui.retry.hidden,false);assert.match(failed.ui.previewError,/Replacement body unavailable/);
  failSave=false;assert.equal(await h.app.actions.retrySave(),true,'storage recovery does not require a working preview');
  assert.equal(h.app.getSnapshot().ui.saveError,false);assert.equal(h.app.getSnapshot().ui.dataBlocked,false);
 }
});

test('pending artwork deletion blocks edits and successful deletion clears history that could restore it', async t => {
  const gate = deferred(), h = harness({deleteGate: gate});
  t.after(() => h.app.dispose()); await h.mount();
  assert.equal(h.app.actions.addArtwork(h.asset.id), true);
  h.app.actions.removeLayers();
  assert.equal(await h.app.flush(), true);
  assert.equal(h.app.getSnapshot().ui.canUndo, true);
  const deletion = h.app.actions.removeArtwork(h.asset.id);
  await until(() => h.calls.some(call => call.path === 'assets/artwork'), 'pending artwork DELETE');
  assert.equal(h.app.getSnapshot().ui.blocked, true);
  assert.equal(h.app.actions.undo(), false);
  assert.equal(h.app.actions.addArtwork(h.asset.id), false);
  assert.equal(h.app.getSnapshot().study.tattoos.length, 0);
  gate.resolve(); await deletion;
  const after = h.app.getSnapshot();
  assert.equal(after.workspace.assets.length, 0);
  assert.equal(after.ui.canUndo, false);
  assert.equal(after.ui.canRedo, false);
  assert.equal(after.ui.blocked, false);
  assert.equal(h.browser.document.body.inert, false);
  h.app.actions.undo();
  assert.equal(h.app.getSnapshot().study.tattoos.length, 0);
  assert.equal(await h.app.flush(), true);
});
