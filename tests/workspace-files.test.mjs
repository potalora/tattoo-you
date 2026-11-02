import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceFiles} from '../studio/workspace-files.js';
import {createStudyController} from '../studio/study-controller.js';
import {project, addTattoo, deleteSelection, MAX_TATTOOS, copy} from '../studio/model.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function fixture(overrides = {}, browser = {}) {
  const study = project('Personal study');
  const state = {
    workspace: {revision: 2, projects: [study], activeProjectId: study.id, assets: []},
    studio: {}, renderTask: null, lastRenderOK: true,
  };
  const messages = [], events = [], calls = [], downloads = [];
  const active = () => state.workspace.projects.find(value => value.id === state.workspace.activeProjectId);
  const controller = createStudyController(state, {
    render() {}, renderScene() {}, scheduleSave() {}, say: message => messages.push(message),
  });
  const services = {
    async api(path, method, payload) {
      calls.push({path, method, payload});
      return {id: 'asset-' + calls.length, name: payload?.name};
    },
    active, mutate: controller.mutate, async flush() { events.push('flush'); return true; },
    invalidateArtworkHistory: id => controller.invalidateArtworkHistory(id),
    say: message => messages.push(message), setInteractionBlocked: value => events.push(['blocked', value]),
    setDataStatus: value => events.push(['data-status', value]),
    showSurface: value => events.push(['surface', value]), focusPlacement: () => events.push('focus'),
    publish: () => events.push('publish'), confirm: () => { events.push('confirm'); return true; },
    download: (name, blob) => downloads.push({name, blob}),
    raster: async () => ({width: 12, height: 18, dataUrl: 'data:image/png;base64,test'}),
    ...overrides,
    browser,
  };
  const files = createWorkspaceFiles(state, services);
  return {state, study, services, files, messages, events, calls, downloads, controller};
}

test('imports retain successful files, report failures, and leave existing ink editable for placement', async () => {
  const f = fixture({raster: async file => {
    if (file.name === 'invalid.jpg') throw Error('Use a transparent PNG');
    return {width: 12, height: 18, dataUrl: 'data:image/png;base64,test'};
  }});
  await f.files.uploadFiles([{name: 'heart.png'}, {name: 'invalid.jpg'}, {name: 'flower.webp'}], {existing: true});
  assert.equal(f.state.workspace.assets.length, 2);
  assert.deepEqual(f.calls.map(call => call.payload.name), ['heart', 'flower']);
  assert.equal(f.study.tattoos.length, 2);
  assert.ok(f.study.tattoos.every(layer => layer.existing && !layer.locked));
  assert.deepEqual(f.events, [['blocked', true], 'flush', 'flush', ['blocked', false], 'publish', ['surface', 'composition'], 'focus']);
  assert.match(f.messages.at(-1), /2 artwork imported; 2 added/);
  assert.match(f.messages.at(-1), /Position your existing tattoos/);
  assert.match(f.messages.at(-1), /1 file failed.*invalid\.jpg/);
});

test('full study imports to library without altering selection, navigating, or reporting an added layer', async () => {
  const f = fixture({getInteractionBlocked: () => true});
  for (let i = 0; i < MAX_TATTOOS; i++) addTattoo(f.study, {id: 'existing', name: 'Existing'});
  const before = copy(f.study);
  await f.files.uploadFiles([{name: 'new.png'}]);
  assert.deepEqual(f.study, before);
  assert.equal(f.state.workspace.assets.length, 1);
  assert.equal(f.controller.hist().past.length, 0);
  assert.deepEqual(f.events, [['blocked', true], 'flush', ['blocked', true], 'publish']);
  assert.match(f.messages.at(-1), /1 artwork imported; 0 added/);
  assert.match(f.messages.at(-1), /full \(16 tattoos\).*1 artwork kept/);
  assert.ok(!f.messages.some(message => message.startsWith('Added to study')));
});

test('asset API failure restores interaction and refreshes library without navigating', async () => {
  const f = fixture({api: async () => { throw Error('Server unavailable'); }});
  await f.files.uploadFiles([{name: 'heart.png'}]);
  assert.equal(f.study.tattoos.length, 0);
  assert.equal(f.state.workspace.assets.length, 0);
  assert.deepEqual(f.events, [['blocked', true], 'flush', ['blocked', false], 'publish']);
  assert.match(f.messages.at(-1), /0 artwork imported; 0 added.*1 file failed.*Server unavailable/);
});

test('referenced artwork cannot be deleted from any study', async () => {
  const f = fixture();
  const other = project('Other');
  addTattoo(other, {id: 'shared', name: 'Shared'});
  f.state.workspace.projects.push(other);
  await f.files.removeArtwork('shared');
  assert.deepEqual(f.events, [['blocked', true], ['blocked', false]]);
  assert.deepEqual(f.calls, []);
  assert.match(f.messages.at(-1), /belongs to a study/);
});

test('artwork deletion requires successful flush and confirmation before DELETE', async () => {
  for (const mode of ['unsaved', 'cancelled', 'accepted', 'failed']) {
    const f = fixture({
      flush: async () => mode !== 'unsaved',
      confirm: () => mode !== 'cancelled',
      ...(mode === 'failed' ? {api: async () => { throw Error('Delete failed'); }} : {}),
    });
    f.state.workspace.assets = [{id: 'remove', name: 'Remove'}, {id: 'keep', name: 'Keep'}];
    await f.files.removeArtwork('remove');
    if (mode === 'accepted') {
      assert.deepEqual(f.calls, [{path: 'assets/remove', method: 'DELETE', payload: {revision: 2}}]);
      assert.deepEqual(f.state.workspace.assets, [{id: 'keep', name: 'Keep'}]);
      assert.deepEqual(f.events, [['blocked', true], 'publish', ['blocked', false]]);
      assert.equal(f.messages.at(-1), 'Artwork removed from library.');
    } else {
      assert.equal(f.state.workspace.assets.length, 2);
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.events, [['blocked', true], ['blocked', false]]);
      if (mode === 'unsaved') assert.match(f.messages.at(-1), /Save the workspace/);
      if (mode === 'failed') assert.equal(f.messages.at(-1), 'Delete failed');
    }
  }
});

test('backup freezes open studies before fetching artwork and blocks overlapping mutations', async () => {
  const gate = deferred();
  const f = fixture({api: async path => { assert.equal(path, 'backup'); return gate.promise; }});
  f.study.notes = 'Notes before export';
  const exporting = f.files.exportBackup();
  assert.deepEqual(f.events[0], ['blocked', true]);
  f.study.notes = 'Unsaved artist notes';
  gate.resolve({version: 3, revision: 2, assets: [{id: 'full-image', dataUrl: 'data:image/png;base64,kept'}], projects: []});
  await exporting;
  assert.equal(f.downloads[0].name, 'inkform-workspace.json');
  const backup = JSON.parse(await f.downloads[0].blob.text());
  assert.equal(backup.projects[0].notes, 'Notes before export');
  assert.equal(backup.activeProjectId, f.study.id);
  assert.equal(backup.assets[0].dataUrl, 'data:image/png;base64,kept');
  assert.deepEqual(f.events, [['blocked', true], ['data-status', 'Workspace download started, including artwork and open edits. Keep the file as a separate backup.'], ['blocked', false]]);
});

test('browser backup resolves the exact artwork versions held by the open workspace', async () => {
  const gate = deferred();
  let captured;
  const api = async () => { throw Error('Must not replace open artwork with a newer database snapshot'); };
  api.exportWorkspace = async workspace => { captured = workspace; await gate.promise; return {version:3, assets:[{id:'original', dataUrl:'data:image/png;base64,original'}]}; };
  const f = fixture({api});
  f.state.workspace.assets = [{id:'original',url:'blob:original-version'}];
  const exporting = f.files.exportBackup();
  f.state.workspace.assets[0].url = 'blob:new-version';
  gate.resolve();
  await exporting;
  assert.equal(captured.assets[0].url, 'blob:original-version');
  const backup = JSON.parse(await f.downloads[0].blob.text());
  assert.equal(backup.assets[0].dataUrl, 'data:image/png;base64,original');
  assert.deepEqual(backup.projects, captured.projects);
});

test('backup refuses a snapshot missing artwork referenced by open studies', async () => {
  const f = fixture({api: async () => ({version: 3, assets: []})});
  addTattoo(f.study, {id: 'removed-in-other-tab', name: 'Keep this'});
  await assert.rejects(f.files.exportBackup(), /missing artwork/i);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.study.tattoos.length, 1);
  assert.deepEqual(f.events.at(-1), ['blocked', false]);
});

function captureFixture({decode = async () => {}, snapshot, nullBlob = false, readError = false, wasBlocked = false} = {}) {
  const labels = [], draws = [], canvases = [];
  const browser = {
    Image: class {width = 1000; height = 800; async decode() { await decode(); }},
    FileReader: class {
      async readAsDataURL(blob) {
        if (readError) { this.error = Error('Preview read failed'); this.onerror(); return; }
        this.result = 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64');
        this.onload();
      }
    },
    document: {createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = {
        getContext() { return {
          measureText: text => ({width: text.length * 6}), fillRect() {},
          drawImage(...args) { draws.push(args); }, fillText: text => labels.push(text),
        }; },
        toBlob(callback, type) { assert.equal(type, 'image/png'); callback(nullBlob ? null : new Blob(['image'], {type})); },
      };
      canvases.push(canvas);
      return canvas;
    }},
  };
  const f = fixture({getInteractionBlocked: () => wasBlocked}, browser);
  f.state.studio.snapshot = snapshot || (async () => 'data:image/png;base64,traced');
  return {...f, labels, draws, canvases};
}

test('reference preparation returns a preview of the exact PNG with captured metadata, without downloading', async () => {
  const gate = deferred(), f = captureFixture({decode: () => gate.promise});
  f.state.studio.getViewName = () => 'left';
  f.state.mappingWarnings = ['Seam crossing'];
  f.study.notes = 'Original artist notes';
  const preparing = f.files.prepareReference();
  await new Promise(resolve => setImmediate(resolve));
  f.study.name = 'Later name';
  f.study.notes = 'Later notes';
  f.state.studio.getViewName = () => 'right';
  f.state.mappingWarnings[0] = 'Later warning';
  gate.resolve();
  const prepared = await preparing;
  assert.deepEqual(f.downloads, []);
  assert.equal(prepared.filename, 'inkform-Personal-study-left.png');
  assert.equal(prepared.studyName, 'Personal study');
  assert.equal(prepared.view, 'left');
  assert.equal(prepared.width, 1000);
  assert.equal(prepared.height, 800 + 40 + f.labels.length * 22);
  assert.equal(prepared.blob.type, 'image/png');
  assert.equal(Buffer.from(prepared.dataUrl.split(',')[1], 'base64').toString(), await prepared.blob.text());
  assert.equal(prepared.caption, f.labels.join('\n'));
  assert.match(prepared.caption, /View: Left side/);
  assert.match(prepared.caption, /Original artist notes/);
  assert.match(prepared.caption, /Surface mapping limitation: Seam crossing/);
  assert.doesNotMatch(prepared.caption, /Later/);
  assert.deepEqual(f.events, [['blocked', true], ['blocked', false]]);
});

test('downloading a reviewed reference reuses its exact blob without capturing the edited study again', async () => {
  const f = captureFixture();
  const prepared = await f.files.prepareReference();
  f.study.name = 'Changed after review';
  f.state.studio.snapshot = () => { throw Error('Must not recapture'); };
  f.files.downloadReference(prepared);
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].blob, prepared.blob);
  assert.equal(f.downloads[0].name, 'inkform-Personal-study-custom-view.png');
  assert.match(f.messages.at(-1), /Reference download started/);
});

test('reference preparation restores an already blocked workspace on success and every failure', async () => {
  for (const options of [{}, {snapshot: async () => { throw Error('Snapshot failed'); }}, {readError: true}]) {
    const f = captureFixture({...options, wasBlocked: true});
    if (options.snapshot || options.readError) await assert.rejects(f.files.prepareReference(), /failed/);
    else await f.files.prepareReference();
    assert.deepEqual(f.events, [['blocked', true], ['blocked', true]]);
    assert.deepEqual(f.downloads, []);
  }
});

test('reference freezes capture region and study metadata before asynchronous decoding', async () => {
  const gate = deferred(), f = captureFixture({decode: () => gate.promise});
  const region = {x: .2, y: .1, width: .5, height: .5};
  f.state.studio.getCaptureRegion = () => region;
  f.study.notes = 'Original notes';
  const exporting = f.files.saveImage();
  await new Promise(resolve => setImmediate(resolve));
  Object.assign(region, {x: 0, y: 0, width: 1, height: 1});
  f.study.name = 'Changed later';
  f.study.notes = 'Changed notes';
  gate.resolve();
  await exporting;
  assert.deepEqual(f.draws[0].slice(1), [200, 80, 500, 400, 70, 0, 500, 400]);
  assert.equal(f.canvases[0].width, 640);
  assert.ok(f.labels.includes('Personal study'));
  assert.ok(f.labels.includes('Original notes'));
  assert.ok(!f.labels.some(label => label.includes('Changed')));
  assert.equal(f.downloads[0].name, 'inkform-Personal-study-custom-view.png');
  assert.deepEqual(f.events, [['blocked', true], ['blocked', false]]);
});

test('snapshot, decode, and null-blob failures restore interaction without downloading', async () => {
  for (const options of [
    {snapshot: async () => { throw Error('Snapshot failed'); }},
    {decode: async () => { throw Error('Decode failed'); }},
    {nullBlob: true},
  ]) {
    const f = captureFixture(options);
    await assert.rejects(f.files.saveImage(), /failed|could not be created/);
    assert.deepEqual(f.downloads, []);
    assert.deepEqual(f.events, [['blocked', true], ['blocked', false]]);
  }
});

test('reference download uses actual custom camera view and frozen mapping warning caption',async()=>{
 const f=captureFixture();f.state.currentView='front';f.state.studio.getViewName=()=> 'custom';
 f.state.mappingWarnings=['Seam crossing'];await f.files.saveImage();
 assert.match(f.downloads[0].name,/-custom-view\.png$/);assert.ok(f.labels.includes('View: Custom view'));
 assert.ok(f.labels.some(line=>line.includes('Surface mapping limitation: Seam crossing')));
 assert.match(f.messages.at(-1),/Reference download started/);
});

test('import and delete adopt library revision before the next workspace save',async()=>{
 let revision=2;const f=fixture({api:async(path,method,payload)=>{
  assert.equal(payload.revision,revision);return path==='assets'?{id:'new',name:'New',revision:++revision}:{deleted:'new',revision:++revision};
 }});await f.files.uploadFiles([{name:'new.png'}]);assert.equal(f.state.workspace.revision,3);
 assert.equal(f.state.workspace.assets[0].revision,undefined);
 f.study.tattoos=[];await f.files.removeArtwork('new');assert.equal(f.state.workspace.revision,4);
});


test('successful artwork deletion invalidates affected undo and redo histories across studies only after DELETE succeeds', async () => {
  const gate = deferred();
  const f = fixture({api: async () => gate.promise});
  const removed = {id: 'remove', name: 'Remove'};
  f.state.workspace.assets = [removed];
  f.controller.mutate(study => addTattoo(study, removed));
  f.controller.mutate(deleteSelection);
  const undoHistory = f.controller.hist();

  const redoStudy = project('Redo');
  f.state.workspace.projects.push(redoStudy);
  f.state.workspace.activeProjectId = redoStudy.id;
  f.controller.mutate(study => addTattoo(study, removed));
  const redoHistory = f.controller.hist();
  f.controller.setProject(redoHistory.undo(redoStudy));

  const unrelated = project('Unrelated');
  f.state.workspace.projects.push(unrelated);
  f.state.workspace.activeProjectId = unrelated.id;
  f.controller.mutate(study => { study.notes = 'First'; });
  f.controller.mutate(study => { study.notes = 'Second'; });
  const unrelatedHistory = f.controller.hist();
  f.controller.setProject(unrelatedHistory.undo(unrelated));
  const before = copy({past: unrelatedHistory.past, future: unrelatedHistory.future});

  const deleting = f.files.removeArtwork(removed.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(undoHistory.past.some(study => study.tattoos.length));
  assert.ok(redoHistory.future.some(study => study.tattoos.length));
  assert.equal(f.state.workspace.assets.length, 1);
  gate.resolve();
  await deleting;

  assert.deepEqual([undoHistory.past, undoHistory.future, redoHistory.past, redoHistory.future], [[], [], [], []]);
  assert.deepEqual({past: unrelatedHistory.past, future: unrelatedHistory.future}, before);
  assert.equal(f.state.workspace.assets.length, 0);
  assert.equal(undoHistory.undo(f.study), null);
  assert.equal(redoHistory.redo(redoStudy), null);
});


test('unsaved, cancelled, and failed artwork deletion retain undo and redo history', async () => {
  for (const [mode, wasBlocked] of ['unsaved', 'cancelled', 'failed'].flatMap(mode => [false, true].map(wasBlocked => [mode, wasBlocked]))) {
    const f = fixture({
      getInteractionBlocked: () => wasBlocked,
      flush: async () => mode !== 'unsaved',
      confirm: () => mode !== 'cancelled',
      api: async () => { throw Error('Delete failed'); },
    });
    const removed = {id: 'remove', name: 'Remove'};
    f.state.workspace.assets = [removed];
    f.controller.mutate(study => addTattoo(study, removed));
    f.controller.mutate(deleteSelection);
    f.controller.mutate(study => { study.notes = 'Later'; });
    const history = f.controller.hist();
    f.controller.setProject(history.undo(f.study));
    const before = copy({past: history.past, future: history.future});
    await f.files.removeArtwork(removed.id);
    assert.deepEqual({past: history.past, future: history.future}, before);
    assert.deepEqual(f.state.workspace.assets, [removed]);
    assert.deepEqual(f.events.at(-1), ['blocked', wasBlocked]);
  }
});


test('artwork deletion blocks overlapping edits during flush and DELETE, then restores prior interaction state', async () => {
  for (const wasBlocked of [false, true]) {
    const saving = deferred(), deleting = deferred();
    const f = fixture({
      getInteractionBlocked: () => wasBlocked,
      flush: () => saving.promise,
      api: () => deleting.promise,
    });
    const removal = f.files.removeArtwork('remove');
    assert.deepEqual(f.events, [['blocked', true]]);
    saving.resolve(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.events, [['blocked', true], 'confirm']);
    deleting.resolve();
    await removal;
    assert.deepEqual(f.events.at(-1), ['blocked', wasBlocked]);
  }
});
