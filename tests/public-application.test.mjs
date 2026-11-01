import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../studio/application.js';
import {project} from '../studio/model.js';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {createLocalApi} from '../studio/local-api.js';

function setup({empty = false} = {}) {
  const study = project('Kept study');
  let saved = {revision: 0, projects: empty ? [] : [study], activeProjectId: empty ? null : study.id, assets: []};
  const calls = [], downloads = [];
  const api = async (path, method = 'GET', body) => {
    calls.push([path, method]);
    if (path === 'workspace' && method === 'GET') return structuredClone(saved);
    if (path === 'workspace' && method === 'PUT') {
      saved = {...saved, ...structuredClone(body), revision: saved.revision + 1};
      return structuredClone(saved);
    }
    if (path === 'backup') return {version: 3, ...structuredClone(saved)};
    throw Error('Unexpected request: ' + path);
  };
  const app = createApplication({api, storageMode: 'browser',
    browser: {location: {search: ''}, document: {body: {}}, Blob, confirm: () => true},
    fileServices: {download: (name, blob) => downloads.push({name, blob})},
  });
  return {app, calls, downloads, get saved() { return saved; }};
}

test('public initialization creates one saved study without fetching the private archive', async t => {
  const h = setup({empty: true}); t.after(() => h.app.dispose());
  await h.app.initialize();
  assert.deepEqual(h.calls, [['workspace', 'GET'], ['workspace', 'PUT']]);
  assert.equal(h.saved.projects.length, 1);
  assert.equal(h.saved.activeProjectId, h.saved.projects[0].id);
  assert.equal(h.app.getSnapshot().ui.storageMode, 'browser');
  assert.equal(h.app.getSnapshot().ui.saveLabel, 'Saved in this browser');
});

test('workspace export is available after storage loads without a working renderer', async t => {
  const h = setup(); t.after(() => h.app.dispose());
  await h.app.initialize();
  assert.equal(h.app.getSnapshot().ui.ready, false);
  assert.equal(h.app.getSnapshot().ui.dataBlocked, false);
  await h.app.actions.exportBackup();
  assert.equal(h.downloads.length, 1);
  const backup = JSON.parse(await h.downloads[0].blob.text());
  assert.deepEqual(backup.projects, h.saved.projects);
  assert.match(h.app.getSnapshot().ui.dataStatus, /download started/i);
});

test('oversized backup is rejected before reading it and preserves the workspace', async t => {
  const h = setup(); t.after(() => h.app.dispose()); await h.app.initialize();
  let reads = 0;
  const before = h.app.getSnapshot().workspace;
  const result = await h.app.actions.restoreBackup({size: 161 * 1024 * 1024, text: async () => { reads++; return '{}'; }});
  assert.equal(result, false); assert.equal(reads, 0);
  assert.match(h.app.getSnapshot().ui.dataStatus, /160 MiB/);
  assert.deepEqual(h.app.getSnapshot().workspace, before);
});


const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('Timed out waiting for viewport startup');
}
function localApplication({indexedDB = new IDBFactory(), deniedLocalStorage = false} = {}) {
  const browser = {location: {search: ''}, document: {body: {inert: false}}, Blob, confirm: () => true};
  if (deniedLocalStorage) Object.defineProperty(browser, 'localStorage', {
    get() { throw new DOMException('Site storage denied', 'SecurityError'); },
  });
  const localApi = createLocalApi({indexedDB, browser: {decodeImage: async () => ({width: 1, height: 1})}});
  const calls = [], downloads = [], updates = [];
  const api = Object.assign(async (path, method, payload) => {
    calls.push({path, method: method || 'GET', payload: structuredClone(payload)});
    return localApi(path, method, payload);
  }, {exportWorkspace: localApi.exportWorkspace});
  const app = createApplication({api, browser,
    createStudio: async () => ({
      update: async (...args) => { updates.push(structuredClone(args)); },
      view() {}, restoreCamera() {}, setPlaceMode() {}, setQuality() {}, dispose() {},
    }),
    observeLayout: () => ({measure: () => ({x: 0, y: 0, width: 800, height: 700}), dispose() {}}),
    fileServices: {download: (name, blob) => downloads.push({name, blob})},
  });
  return {app, api, localApi, calls, downloads, updates, browser,
    async mount() {
      app.attachViewport({}, {});
      await until(() => app.getSnapshot().ui.ready || app.getSnapshot().ui.error);
    },
    async dispose() { app.dispose(); await localApi.close(); },
  };
}

test('a denied localStorage getter does not prevent mounting and saving an IndexedDB study', async t => {
  let h;
  assert.doesNotThrow(() => { h = localApplication({deniedLocalStorage: true}); });
  t.after(() => h.dispose());
  await h.mount();
  assert.equal(h.app.getSnapshot().ui.ready, true);
  h.app.actions.setNotes('Saved without localStorage');
  assert.equal(await h.app.flush(), true);
  assert.equal((await h.localApi('workspace')).projects[0].notes, 'Saved without localStorage');
});

test('denied IndexedDB startup publishes actionable recovery instead of preventing app construction', async t => {
  t.mock.method(console, 'error', () => {});
  let h;
  assert.doesNotThrow(() => {
    h = localApplication({deniedLocalStorage: true, indexedDB: {open() {throw new DOMException('Denied', 'SecurityError');}}});
  });
  t.after(() => h.dispose());
  await h.mount();
  const snapshot = h.app.getSnapshot();
  assert.equal(snapshot.ui.ready, false);
  assert.equal(snapshot.ui.loading, false);
  assert.equal(snapshot.ui.saveError, true);
  assert.equal(snapshot.ui.dataBlocked, true);
  assert.match(snapshot.ui.error, /storage.*blocked or denied/i);
  assert.match(snapshot.ui.error, /allow site storage.*reload/i);
  assert.equal(h.updates.length, 0);
});

for (const scenario of ['empty studies', 'no active selection']) {
  test(`restoring a backup with ${scenario} atomically saves an editable active study`, async t => {
    const h = localApplication(); t.after(() => h.dispose()); await h.mount();
    h.app.actions.setNotes('Original workspace');
    assert.equal(await h.app.flush(), true);
    const before = await h.localApi('workspace');
    const backup = {version: 3, projects: scenario === 'empty studies' ? [] : [project('Imported study'), project('Second study')], activeProjectId: null, assets: []};
    const missingSelections = [];
    const unsubscribe = h.app.subscribe(() => {
      const snapshot = h.app.getSnapshot();
      if (snapshot.ui.ready && !snapshot.study) missingSelections.push(snapshot.workspace);
    });
    assert.equal(await h.app.actions.restoreBackup({text: async () => JSON.stringify(backup)}), true);
    unsubscribe();
    const restored = h.app.getSnapshot();
    assert.ok(restored.study, 'the restored workspace must immediately have an editable study');
    assert.equal(restored.study.name, scenario === 'empty studies' ? 'My first study' : 'Imported study');
    assert.equal(restored.workspace.activeProjectId, restored.study.id);
    assert.equal(restored.workspace.projects.length, scenario === 'empty studies' ? 1 : 2);
    assert.equal(restored.ui.canUndo, false);
    assert.equal(restored.ui.blocked, false);
    assert.equal(h.browser.document.body.inert, false);
    assert.deepEqual(missingSelections, [], 'subscribers must never receive an invalid restored selection');
    assert.match(restored.ui.dataStatus, /restored and saved in this browser/i);
    const saved = await h.localApi('workspace');
    assert.equal(saved.revision, before.revision + 1, 'normalization must be part of the single restore commit');
    assert.deepEqual(saved.projects, restored.workspace.projects);
    assert.equal(saved.activeProjectId, restored.study.id);
    assert.equal(h.calls.filter(call => call.path === 'restore').length, 1);
    const safetyBackup = JSON.parse(await h.downloads[0].blob.text());
    assert.deepEqual(safetyBackup.projects, before.projects);
    h.app.actions.setNotes('Editable after restore');
    assert.equal(await h.app.flush(), true);
    assert.equal((await h.localApi('workspace')).projects[0].notes, 'Editable after restore');
  });
}

test('startup selects and saves the first existing study when the saved selection is null', async t => {
  const h = localApplication(); t.after(() => h.dispose());
  const study = project('Unselected saved study');
  await h.localApi('workspace', 'PUT', {revision: 0, projects: [study], activeProjectId: null});
  await h.mount();
  assert.equal(h.app.getSnapshot().ui.ready, true);
  assert.equal(h.app.getSnapshot().study.id, study.id);
  assert.equal((await h.localApi('workspace')).activeProjectId, study.id);
});

test('failed startup normalization keeps the readable workspace available for backup while blocking edits', async t => {
  t.mock.method(console, 'error', () => {});
  const h = localApplication(); t.after(() => h.dispose());
  await h.localApi('assets', 'POST', {
    name: 'Preserved artwork', width: 1, height: 1,
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  });
  const study = project('Preserved study');
  study.notes = 'Keep these notes even when storage is full';
  await h.localApi('workspace', 'PUT', {revision: (await h.localApi('workspace')).revision, projects: [study], activeProjectId: null});
  const before = await h.localApi('backup');
  const put = IDBObjectStore.prototype.put;
  t.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
    if (this.name === 'workspace') throw new DOMException('Full device', 'QuotaExceededError');
    return put.apply(this, args);
  });
  await h.mount();
  const snapshot = h.app.getSnapshot();
  assert.equal(snapshot.ui.ready, false);
  assert.equal(snapshot.ui.dataBlocked, false);
  assert.match(snapshot.ui.error, /storage is full/i);
  assert.deepEqual(snapshot.workspace.projects, before.projects);
  assert.equal(snapshot.workspace.activeProjectId, null);
  h.app.actions.setNotes('Must not change saved notes');
  await h.app.actions.exportBackup();
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(JSON.parse(await h.downloads[0].blob.text()), before);
  assert.deepEqual(await h.localApi('backup'), before);
});

test('deleting unused artwork through the application keeps Undo, saving, and backup export valid', async t => {
  const h = localApplication(); t.after(() => h.dispose());
  const asset = await h.localApi('assets', 'POST', {
    name: 'Synthetic artwork', width: 1, height: 1,
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  });
  await h.mount();
  h.app.actions.addArtwork(asset.id);
  assert.equal(await h.app.flush(), true);
  h.app.actions.removeLayers();
  assert.equal(await h.app.flush(), true);
  assert.equal(h.app.getSnapshot().ui.canUndo, true);
  await h.app.actions.removeArtwork(asset.id);
  assert.equal(h.app.getSnapshot().ui.canUndo, false);
  assert.equal(h.app.getSnapshot().ui.blocked, false);
  h.app.actions.undo();
  assert.deepEqual(h.app.getSnapshot().study.tattoos, []);
  h.app.actions.setNotes('Still editable after artwork removal');
  assert.equal(await h.app.flush(), true);
  await h.app.actions.exportBackup();
  const backup = JSON.parse(await h.downloads.at(-1).blob.text());
  assert.deepEqual(backup.assets, []);
  assert.deepEqual(backup.projects[0].tattoos, []);
  assert.equal(backup.projects[0].notes, 'Still editable after artwork removal');
});


for (const empty of [true, false]) {
  test(`conflict recovery normalizes a saved ${empty ? 'empty' : 'unselected'} workspace before publishing it`, async t => {
    const h = localApplication(); t.after(() => h.dispose()); await h.mount();
    const saved = await h.localApi('workspace');
    const imported = project('Saved in another tab');
    await h.localApi('restore', 'POST', {revision: saved.revision, backup: {version: 3, projects: empty ? [] : [imported], activeProjectId: null, assets: []}});
    h.app.actions.setNotes('Keep these open edits in a backup');
    assert.equal(await h.app.flush(), false);
    assert.equal(h.app.getSnapshot().ui.retry.text, 'Resolve conflict');
    const missingSelections = [];
    const unsubscribe = h.app.subscribe(() => {
      if (!h.app.getSnapshot().study) missingSelections.push(h.app.getSnapshot().workspace);
    });
    assert.equal(await h.app.actions.retrySave(), true);
    unsubscribe();
    const recovered = h.app.getSnapshot();
    assert.ok(recovered.study);
    assert.equal(recovered.study.name, empty ? 'My first study' : 'Saved in another tab');
    assert.equal(recovered.workspace.activeProjectId, recovered.study.id);
    assert.equal((await h.localApi('workspace')).activeProjectId, recovered.study.id);
    assert.deepEqual(missingSelections, []);
    assert.equal(recovered.ui.retry.hidden, true);
    assert.equal(h.app.hasUnsavedChanges(), false);
    const safetyBackup = JSON.parse(await h.downloads[0].blob.text());
    assert.equal(safetyBackup.projects[0].notes, 'Keep these open edits in a backup');
    h.app.actions.setNotes('Recovered and editable');
    assert.equal(await h.app.flush(), true);
  });
}

test('real browser persistence normalizes empty restores without private seeding and remains reloadable',async t=>{
 const {IDBFactory}=await import('fake-indexeddb');const {createLocalApi}=await import('../studio/local-api.js');
 for(const empty of [true,false]){
  const api=createLocalApi({indexedDB:new IDBFactory(),name:'empty-restore-'+empty});t.after(()=>api.close());
  const browser={location:{search:''},document:{body:{}},Blob,confirm:()=>true};
  const app=createApplication({api,browser,storageMode:'browser',seedWorkspace:'empty',fileServices:{download(){},seed(){throw Error('Private migration must not run');}}});t.after(()=>app.dispose());
  await app.initialize();const restored=project('Imported without active');
  const backup={version:3,projects:empty?[]:[restored],activeProjectId:null,assets:[]};
  assert.equal(await app.actions.restoreBackup({size:100,text:async()=>JSON.stringify(backup)}),true);
  const actual=app.getSnapshot();assert.ok(actual.study);assert.equal(actual.workspace.activeProjectId,actual.study.id);
  const reloaded=await api('workspace');assert.deepEqual(reloaded.projects,actual.workspace.projects);assert.equal(reloaded.activeProjectId,actual.study.id);
  await app.actions.exportBackup();assert.match(app.getSnapshot().ui.dataStatus,/download started/);
 }
});
