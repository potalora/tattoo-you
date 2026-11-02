import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyController} from '../studio/study-controller.js';
import {BODY_DEFAULTS, project, addTattoo, copy} from '../studio/model.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function fixture(options = {}) {
  const original = project('Original', {...BODY_DEFAULTS, bodyModelId: options.modelId || 'makehuman-v1'});
  const layer = addTattoo(original, {id: 'art', name: 'Existing ink'}, true);
  layer.region = 'custom';
  layer.placement = {faceIndex: 70000, barycentric: [.2, .3, .5]};
  original.notes = 'Keep the original anchors';
  const state = {
    workspace: {revision: 0, projects: [original], activeProjectId: original.id, assets: [{id: 'art'}]},
    convertingBody: false, ready: true, currentView: 'detail', conflict: false,
  };
  const events = [], messages = [], writes = [], persisted = [], restored = [], reads = [], nameRequests = [];
  let camera = {position: [1, 1, 3], target: [0, 1, 0]};
  let stored = copy(state.workspace);
  let flushCount = 0, sceneCount = 0;
  state.studio = {
    getCamera: () => copy(camera),
    restoreCamera(value) { restored.push(copy(value)); camera = copy(value); },
  };
  let controller;
  const services = {
    render() { events.push('render'); },
    async renderScene() {
      events.push('scene');
      try { return (await options.renderScene?.(controller.active(), ++sceneCount)) !== false; }
      catch { return false; }
    },
    scheduleSave() { events.push('schedule'); },
    async flush() {
      const attempt = ++flushCount;
      if (state.conflict) return false;
      const payload = copy(state.workspace);
      writes.push(payload);
      if (payload.revision !== stored.revision) { state.conflict = true; return false; }
      if ((await options.beforeSave?.(payload, attempt, state)) === false) return false;
      stored = {...payload, revision: payload.revision + 1};
      persisted.push(copy(stored));
      if (options.ackLostAt === attempt) return false;
      state.workspace.revision = stored.revision;
      return true;
    },
    say(message) { messages.push(message); },
    async api(path) {
      reads.push(path);
      assert.equal(path, 'workspace');
      return options.latest ? options.latest(copy(stored)) : copy(stored);
    },
    async askName(title, value) {
      nameRequests.push({title, value});
      return options.useSuggestedName ? value : Object.hasOwn(options, 'name') ? options.name : 'Alternative';
    },
    placeMode(value) { events.push(['place', value]); },
    async chooseCamera(name) {
      state.currentView = name;
      camera = {position: [.5, 1, 3], target: [0, 1, 0]};
      events.push(['view', name]);
      return services.renderScene();
    },
    setInteractionBlocked(value) { events.push(['blocked', value]); },
    setLoading(value) { events.push(['loading', value]); },
    setCameraSelection(name) { events.push(['selected-camera', name]); },
  };
  controller = createStudyController(state, services);
  return {state, original, controller, services, events, messages, writes, persisted, restored, reads, nameRequests};
}

function assertReleased(f) {
  assert.equal(f.state.convertingBody, false);
  assert.equal(f.state.ready, true);
  assert.deepEqual(f.events.filter(event => Array.isArray(event) && event[0] === 'blocked').at(-1), ['blocked', false]);
}

test('mutation owns history, rolls back rejection, and honors non-scene changes', () => {
  const f = fixture(), before = copy(f.original);
  assert.equal(f.controller.mutate(study => { study.notes = 'Artist notes'; }, {scene: false}), true);
  assert.equal(f.controller.hist().past.length, 1);
  assert.deepEqual(f.controller.hist().past[0], before);
  assert.deepEqual(f.events, ['render', 'schedule']);
  const changed = copy(f.original);
  assert.equal(f.controller.mutate(study => { study.body.mass = 99; throw Error('Rejected'); }), false);
  assert.deepEqual(f.original, changed);
  assert.equal(f.controller.hist().past.length, 1);
  assert.equal(f.messages.at(-1), 'Rejected');
  f.state.convertingBody = true;
  assert.equal(f.controller.mutate(study => { study.name = 'Blocked'; }), false);
  assert.deepEqual(f.original, changed);
});

test('histories stay isolated by study and follow replaced workspace state', () => {
  const f = fixture();
  f.controller.hist().push(f.original);
  const firstHistory = f.controller.hist();
  const other = project('Other');
  f.state.workspace.projects.push(other);
  f.state.workspace.activeProjectId = other.id;
  assert.notEqual(f.controller.hist(), firstHistory);
  assert.equal(f.controller.hist().past.length, 0);
  const replacement = {...copy(other), notes: 'Restored through undo'};
  f.controller.setProject(replacement);
  assert.equal(f.controller.active(), replacement);
  assert.deepEqual(f.events, ['render', 'scene', 'schedule']);
  f.state.workspace = {projects: [f.original], activeProjectId: f.original.id};
  assert.equal(f.controller.active(), f.original);
  assert.equal(f.controller.hist(), firstHistory);
  f.controller.clearHistory();
  assert.notEqual(f.controller.hist(), firstHistory);
  assert.equal(f.controller.hist().past.length, 0);
});

test('comparison owns interaction while pre-save is pending and preserves original data', async () => {
  const entered = deferred(), gate = deferred();
  const f = fixture({beforeSave: async (payload, attempt) => {
    if (attempt === 1) { entered.resolve(); await gate.promise; }
  }});
  const before = copy(f.original), comparing = f.controller.useBodyModel('blender-studio-v1');
  await entered.promise;
  assert.equal(f.state.convertingBody, true);
  assert.equal(f.state.ready, false);
  assert.equal(await f.controller.useBodyModel('atelier-v1'), false);
  assert.equal(await f.controller.changeAnatomy('female'), false);
  assert.equal(await f.controller.saveAlternative(), false);
  assert.equal(f.controller.mutate(study => { study.body.mass = 99; }), false);
  assert.deepEqual(f.original, before);
  gate.resolve();
  assert.equal(await comparing, true);
  const created = f.controller.active();
  assert.notEqual(created.id, before.id);
  assert.equal(created.body.bodyModelId, 'blender-studio-v1');
  assert.deepEqual(created.tattoos, before.tattoos.map(layer => ({...layer, placement: null})));
  assert.deepEqual(created.selectedIds, before.selectedIds);
  assert.deepEqual(f.original, before);
  assert.deepEqual(f.persisted.at(-1).projects, f.state.workspace.projects);
  assert.deepEqual(created.camera, {position: [.5, 1, 3], target: [0, 1, 0]});
  assertReleased(f);
});

test('comparison render failures never persist the temporary study and restore camera', async () => {
  for (const failAt of [1, 2]) {
    const f = fixture({renderScene: async (study, attempt) => attempt !== failAt});
    const before = copy(f.original);
    assert.equal(await f.controller.useBodyModel('blender-studio-v1'), false);
    assert.deepEqual(f.state.workspace.projects, [before]);
    assert.equal(f.state.workspace.activeProjectId, before.id);
    assert.ok(f.persisted.every(write => write.projects.length === 1));
    assert.deepEqual(f.restored, [{position: [1, 1, 3], target: [0, 1, 0]}]);
    assert.equal(f.state.currentView, 'detail');
    assert.ok(f.events.some(event => JSON.stringify(event) === '["selected-camera","detail"]'));
    assertReleased(f);
  }
});

test('comparison pre-save failure creates no copy and releases loading state', async () => {
  const f = fixture({beforeSave: async () => false}), before = copy(f.original);
  assert.equal(await f.controller.useBodyModel('blender-studio-v1'), false);
  assert.deepEqual(f.state.workspace.projects, [before]);
  assert.equal(f.events.includes('scene'), false);
  assert.deepEqual(f.events.filter(event => Array.isArray(event) && event[0] === 'loading'), [['loading', true], ['loading', false]]);
  assertReleased(f);
});

test('copy save rejection persists the restored original', async () => {
  const f = fixture({beforeSave: async (payload, attempt) => attempt !== 2}), before = copy(f.original);
  assert.equal(await f.controller.useBodyModel('blender-studio-v1'), false);
  assert.deepEqual(f.state.workspace.projects, [before]);
  assert.equal(f.writes.length, 3);
  assert.deepEqual(f.persisted.at(-1).projects, [before]);
  assert.equal(f.state.workspace.revision, 2);
  assert.deepEqual(f.reads, ['workspace']);
  assertReleased(f);
});

test('lost comparison acknowledgement reconciles exact committed copy before rollback', async () => {
  const f = fixture({ackLostAt: 2}), before = copy(f.original);
  assert.equal(await f.controller.useBodyModel('blender-studio-v1'), false);
  assert.equal(f.persisted.length, 3);
  assert.equal(f.persisted[1].projects.length, 2);
  assert.deepEqual(f.persisted.at(-1).projects, [before]);
  assert.deepEqual(f.state.workspace.projects, [before]);
  assert.equal(f.state.workspace.revision, 3);
  assert.equal(f.state.conflict, false);
  assertReleased(f);
});

test('acknowledgement reconciliation never adopts another tab’s revision or selection', async () => {
  for (const mismatch of ['projects', 'active']) {
    const f = fixture({ackLostAt: 2, latest: latest => {
      if (mismatch === 'projects') latest.projects[0].name = 'Another tab';
      else latest.activeProjectId = 'another-study';
      latest.revision = 900;
      return latest;
    }});
    const before = copy(f.original);
    assert.equal(await f.controller.useBodyModel('blender-studio-v1'), false);
    assert.equal(f.state.workspace.revision, 1);
    assert.equal(f.state.conflict, true);
    assert.deepEqual(f.state.workspace.projects, [before]);
    assertReleased(f);
  }
});

test('existing conflict skips comparison acknowledgement reconciliation', async () => {
  const f = fixture({beforeSave: async (payload, attempt, state) => {
    if (attempt === 2) { state.conflict = true; return false; }
  }});
  const before = copy(f.original);
  assert.equal(await f.controller.useBodyModel('blender-studio-v1'), false);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.state.workspace.projects, [before]);
  assert.equal(f.state.conflict, true);
  assertReleased(f);
});

test('anatomy comparison resets incompatible anchors; compatible anatomy retains them', async () => {
  for (const modelId of ['blender-studio-v1', 'makehuman-v1']) {
    const f = fixture({modelId}), before = copy(f.original);
    assert.equal(await f.controller.changeAnatomy('female'), true);
    const current = f.controller.active();
    assert.equal(current.body.body, 'female');
    if (modelId === 'blender-studio-v1') {
      assert.equal(f.state.workspace.projects.length, 2);
      assert.deepEqual(f.original, before);
      assert.equal(current.tattoos[0].placement, null);
    } else {
      assert.equal(f.state.workspace.projects.length, 1);
      assert.equal(current.id, before.id);
      assert.deepEqual(current.tattoos, before.tattoos);
      assert.equal(f.controller.hist().past.length, 1);
    }
  }
});

test('unsupported and unchanged body choices cause no scene updates or saves', async () => {
  const f = fixture(), before = copy(f.original);
  for (const id of ['future-v9', '__proto__', '', null, undefined, {}, 'makehuman-v1']) {
    assert.equal(await f.controller.useBodyModel(id), false);
  }
  assert.equal(await f.controller.useBodyModel('mhr-v1', 'female'), false);
  assert.deepEqual(f.state.workspace.projects, [before]);
  assert.deepEqual(f.writes, []);
  assert.equal(f.events.includes('scene'), false);
});

test('project switching blocks edits until preview and saved camera are restored', async () => {
  const entered = deferred(), gate = deferred();
  const f = fixture({renderScene: async () => { entered.resolve(); await gate.promise; }});
  const other = project('Other');
  other.camera = {position: [0, 1, 4], target: [0, 1, 0]};
  f.state.workspace.projects.push(other);
  const before = copy(other), switching = f.controller.switchProject(other.id);
  await entered.promise;
  assert.equal(f.state.ready, false);
  assert.equal(f.controller.mutate(study => { study.body.mass = 99; }), false);
  assert.equal(await f.controller.switchProject(f.original.id), false);
  gate.resolve();
  assert.equal(await switching, true);
  assert.deepEqual(other, before);
  assert.deepEqual(f.restored, [other.camera]);
  assert.equal(f.state.workspace.activeProjectId, other.id);
  assertReleased(f);
});

test('failed project switch restores previous study and camera without saving failed selection', async () => {
  const f = fixture({renderScene: async (study, attempt) => attempt !== 1});
  const other = project('Other');
  f.state.workspace.projects.push(other);
  assert.equal(await f.controller.switchProject(other.id), false);
  assert.equal(f.state.workspace.activeProjectId, f.original.id);
  assert.deepEqual(f.restored, [{position: [1, 1, 3], target: [0, 1, 0]}]);
  assert.equal(f.events.includes('schedule'), false);
  assertReleased(f);
});

test('default alternative identity stays first when a long source name is shortened', async () => {
  const f = fixture({useSuggestedName: true});
  f.original.name = 'A'.repeat(120);
  assert.equal(await f.controller.saveAlternative(), true);
  assert.equal(f.nameRequests[0].value, 'Copy — ' + 'A'.repeat(113));
  assert.equal(f.controller.active().name, 'Copy — ' + 'A'.repeat(113));
  assert.equal(f.original.name, 'A'.repeat(120));
});

test('alternatives of alternatives keep a single identity with the unique number first', async () => {
  const f = fixture({useSuggestedName: true});
  for (const expected of ['Copy — Original', 'Copy 2 — Original', 'Copy 3 — Original']) {
    assert.equal(await f.controller.saveAlternative(), true);
    assert.equal(f.controller.active().name, expected);
  }
  assert.equal(f.original.name, 'Original');
  assert.equal(new Set(f.state.workspace.projects.map(study => study.name)).size, 4);
});

test('legacy alternative sources get a compact suggestion without renaming existing studies', async () => {
  const f = fixture({useSuggestedName: true});
  f.original.name = 'Original — alternative — alternative';
  const before = copy(f.original);
  assert.equal(await f.controller.saveAlternative(), true);
  assert.equal(f.controller.active().name, 'Copy — Original');
  assert.deepEqual(f.original, {...before, camera: {position: [1, 1, 3], target: [0, 1, 0]}});
});

test('earlier alternative prefixes stay only on existing studies when suggesting a short copy name', async () => {
  for (const [name, expected] of [
    ['Alternative — Original', 'Copy 2 — Original'],
    ['Alternative 2 — Original', 'Copy 3 — Original'],
    ['Copy 2 — Alternative — Original — alternative', 'Copy 3 — Original'],
  ]) {
    const f = fixture({useSuggestedName: true});
    f.original.name = name;
    assert.equal(await f.controller.saveAlternative(), true);
    assert.equal(f.controller.active().name, expected);
    assert.equal(f.original.name, name);
  }
});

test('copying a shortened numbered alternative keeps its next number at the front', async () => {
  const f = fixture({useSuggestedName: true});
  f.original.name = 'A'.repeat(120);
  for (const expected of [
    'Copy — ' + 'A'.repeat(113),
    'Copy 2 — ' + 'A'.repeat(111),
    'Copy 3 — ' + 'A'.repeat(111),
  ]) {
    assert.equal(await f.controller.saveAlternative(), true);
    assert.equal(f.controller.active().name, expected);
  }
});

test('default names resolve collisions after shortening and keep Unicode characters whole', async () => {
  const f = fixture({useSuggestedName: true});
  f.original.name = '🌿'.repeat(120);
  f.state.workspace.projects.push(project('Copy — ' + '🌿'.repeat(113)));
  f.state.workspace.projects.push(project('Copy 2 — ' + '🌿'.repeat(111)));
  assert.equal(await f.controller.saveAlternative(), true);
  assert.equal(f.controller.active().name, 'Copy 3 — ' + '🌿'.repeat(111));
  assert.equal(Array.from(f.controller.active().name).length, 120);
});

test('a custom alternative name is kept through the full Unicode name limit', async () => {
  const f = fixture({name: '  ' + '🌿'.repeat(119) + 'é' + '  '});
  assert.equal(await f.controller.saveAlternative(), true);
  assert.equal(f.controller.active().name, '🌿'.repeat(119) + 'é');
});

test('alternative preserves exact placements and original, including preview failure', async () => {
  for (const previewOK of [true, false]) {
    const f = fixture({name: '  Artist alternative  ', renderScene: async () => previewOK});
    const before = copy(f.original);
    assert.equal(await f.controller.saveAlternative(), true);
    const alternative = f.controller.active();
    assert.notEqual(alternative.id, before.id);
    assert.equal(alternative.name, 'Artist alternative');
    assert.deepEqual(alternative.tattoos, before.tattoos);
    assert.deepEqual(alternative.selectedIds, before.selectedIds);
    assert.deepEqual(f.original, {...before, camera: {position: [1, 1, 3], target: [0, 1, 0]}});
    assert.equal(f.persisted.length, 2);
    assert.match(f.messages.at(-1), previewOK ? /Alternative saved\. Your original/ : /preview could not load/);
    assertReleased(f);
  }
});

test('alternative cancellation or pre-save failure never creates a new study', async () => {
  for (const options of [{name: null}, {name: '   '}, {beforeSave: async () => false}]) {
    const f = fixture(options);
    assert.equal(await f.controller.saveAlternative(), false);
    assert.equal(f.state.workspace.projects.length, 1);
    assert.equal(f.state.workspace.activeProjectId, f.original.id);
    assert.equal(f.state.convertingBody, false);
    assert.equal(f.state.ready, true);
    if (options.beforeSave) assertReleased(f);
  }
});

test('alternative final save failure leaves the unsaved copy open for retry', async () => {
  const f = fixture({beforeSave: async (payload, attempt) => attempt !== 2});
  assert.equal(await f.controller.saveAlternative(), false);
  assert.equal(f.state.workspace.projects.length, 2);
  assert.notEqual(f.state.workspace.activeProjectId, f.original.id);
  assert.equal(f.persisted.length, 1);
  assert.match(f.messages.at(-1), /open but not saved/);
  assertReleased(f);
});

test('rejected commands preserve full bounded history, redo and selection',()=>{
 const f=fixture(), h=f.controller.hist(); h.limit=2;
 f.controller.mutate(p=>{p.notes='one';});f.controller.mutate(p=>{p.notes='two';});
 f.controller.setProject(h.undo(f.controller.active()));
 const before=copy({study:f.controller.active(),past:h.past,future:h.future}), events=[...f.events];
 assert.equal(f.controller.mutate(p=>{p.notes='bad';p.selectedIds=[];throw Error('Rejected');}),false);
 assert.deepEqual({study:f.controller.active(),past:h.past,future:h.future},before);
 assert.deepEqual(f.events,events);
});

test('study capacity rejects copies before naming, camera, flush or rendering side effects',async()=>{
 for(const command of ['saveAlternative','useBodyModel']){
  const f=fixture();for(let i=1;i<100;i++){const p=project('Full '+i);f.state.workspace.projects.push(p);}
  const before=copy(f.state.workspace);
  assert.equal(await f.controller[command]('mhr-v1'),false);
  assert.deepEqual(f.state.workspace,before);assert.deepEqual(f.events,[]);assert.deepEqual(f.writes,[]);
 }
});

test('mutations reject aggregate portable JSON overflow before history or side effects',()=>{
 const f=fixture();const filler='x'.repeat(1000000);
 for(let i=1;i<9;i++){const p=project('Large '+i);p.extra=filler;f.state.workspace.projects.push(p);}
 const before=copy(f.controller.active());
 assert.equal(f.controller.mutate(p=>{p.extra=filler;}),false);
 assert.deepEqual(f.controller.active(),before);assert.equal(f.controller.hist().past.length,0);assert.deepEqual(f.events,[]);
});

test('alternative and model copies reject portable JSON overflow before saving or cameras',async()=>{
 for(const command of ['saveAlternative','useBodyModel']){
  const f=fixture();f.original.extra='x'.repeat(1000000);
  for(let i=1;i<8;i++){const p=project('Large '+i);p.extra='x'.repeat(1000000);f.state.workspace.projects.push(p);}
  const before=copy(f.state.workspace);
  assert.equal(await f.controller[command]('mhr-v1'),false);
  assert.deepEqual(f.state.workspace,before);assert.deepEqual(f.events,[]);assert.deepEqual(f.writes,[]);
 }
});

test('switching to a saved orbit labels its unclassified camera as custom',async()=>{
 const f=fixture(),other=project('Orbit');other.camera={position:[1,1,3],target:[0,1,0]};f.state.workspace.projects.push(other);
 assert.equal(await f.controller.switchProject(other.id),true);assert.equal(f.state.currentView,'custom');
});
