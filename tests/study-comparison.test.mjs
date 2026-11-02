import test from 'node:test';
import assert from 'node:assert/strict';
import {captureStudyComparison, compatibleComparisonStudies} from '../studio/study-comparison.js';

const clone = value => structuredClone(value);
const camera = {position: [1, 2, 3], target: [0, 1, 0]};
function fixture({failSnapshot = 0, failRestore = false} = {}) {
  const a = {id: 'a', name: 'Study A', body: {bodyModelId: 'body', body: 'male', stature: 175, skin: 'monk05'}, tattoos: [{id: 'ink-a', visible: true}], selectedIds: ['ink-a'], camera: {position: [8, 8, 8]}, updatedAt: 'today'};
  const b = {...clone(a), id: 'b', name: 'Study B', tattoos: [{id: 'ink-b', visible: false}], camera: {position: [9, 9, 9]}};
  const events = [], draws = [];
  let pose = clone(camera), view = 'detail', current, snapshots = 0, updates = 0;
  const state = {ready: true, lastRenderOK: true, reviewing: true, workspace: {activeProjectId: 'a', projects: [a, b], assets: [{id: 'asset'}]}, history: {past: ['untouched']}};
  state.studio = {
    async update(body, tattoos, assets, selectedIds) {updates++; events.push(['update', clone({body, tattoos, assets, selectedIds})]); if (failRestore && updates === 3) throw Error('restore failed'); current = tattoos[0]?.id; body.stature = 999; assets.length = 0;},
    getCamera: () => clone(pose), getViewName: () => view,
    restoreCamera(value, options = {}) {pose = clone(value); view = options.viewName || 'custom'; events.push(['camera', clone(value), options]);},
    getCaptureRegion: () => ({x: .1, y: .2, width: .6, height: .5}),
    async snapshot() {snapshots++; events.push(['snapshot', current, clone(pose)]); if (snapshots === failSnapshot) throw Error('capture failed'); return `data:image/png;base64,${current}`;},
  };
  const browser = {
    Image: class {constructor() {this.width = 1000; this.height = 800;} async decode() {}},
    document: {createElement(tag) {assert.equal(tag, 'canvas'); const canvas = {width: 0, height: 0, getContext: () => ({drawImage(...args) {draws.push(args.slice(1));}}), toDataURL: () => `data:image/png;base64,crop-${draws.length}`}; return canvas;}},
  };
  return {a, b, state, events, draws, browser, targetId: 'b', active: () => state.workspace.projects.find(p => p.id === state.workspace.activeProjectId)};
}

test('compatibility requires the same complete body and excludes the active study', () => {
  const f = fixture();
  const variants = ['bodyModelId', 'body', 'stature', 'skin'].map(key => ({...clone(f.b), id: key, body: {...f.b.body, [key]: 'different'}}));
  const reordered = {...clone(f.b), id: 'reordered', body: Object.fromEntries(Object.entries(f.b.body).reverse())};
  assert.deepEqual(compatibleComparisonStudies([f.a, f.b, ...variants, reordered], f.a).map(p => p.id), ['b', 'reordered']);
});

test('captures use one exact pose and viewport crop, restore selection, and leave domain and history untouched', async () => {
  const f = fixture(), before = clone({workspace: f.state.workspace, history: f.state.history});
  const result = await captureStudyComparison(f.state, f);
  assert.deepEqual({workspace: f.state.workspace, history: f.state.history}, before);
  assert.deepEqual(f.events.filter(e => e[0] === 'snapshot').map(e => e[2]), [camera, camera, camera]);
  assert.deepEqual(f.events.filter(e => e[0] === 'update').map(e => e[1].selectedIds), [[], [], ['ink-a']]);
  assert.deepEqual(f.draws, [[100, 160, 600, 400, 0, 0, 600, 400], [100, 160, 600, 400, 0, 0, 600, 400]]);
  assert.equal(result.a.id, 'a'); assert.equal(result.b.id, 'b'); assert.equal(result.view, 'detail');
  assert.deepEqual(result.camera, camera); assert.equal(result.a.image, 'data:image/png;base64,crop-1');
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.camera.position) && Object.isFrozen(result.a));
  assert.equal(f.state.lastRenderOK, true);
  assert.equal(f.state.studio.getViewName(), 'detail');
  assert.ok(f.events.filter(event => event[0] === 'camera').every(event => event[2].silent === true && event[2].viewName === 'detail'));
});

test('capture errors still restore active contents and the exact original camera', async () => {
  const f = fixture({failSnapshot: 2});
  await assert.rejects(captureStudyComparison(f.state, f), /capture failed/);
  assert.equal(f.events.at(-1)[1], 'ink-a');
  assert.deepEqual(f.events.at(-1)[2], camera);
  assert.equal(f.state.lastRenderOK, true);
});

test('restoration failure fails closed and still attempts camera restoration', async () => {
  const f = fixture({failRestore: true});
  await assert.rejects(captureStudyComparison(f.state, f), /restore failed/);
  assert.equal(f.state.lastRenderOK, false);
  assert.deepEqual(f.events.at(-1), ['camera', camera, {viewName: 'detail', silent: true}]);
});

test('incompatible studies and unlocked interactions are refused before touching the renderer', async () => {
  const f = fixture(); f.b.body.stature++;
  await assert.rejects(captureStudyComparison(f.state, f), /same body/);
  assert.deepEqual(f.events, []);
  f.b.body = clone(f.a.body); f.state.reviewing = false;
  await assert.rejects(captureStudyComparison(f.state, f), /reviewing/);
  assert.deepEqual(f.events, []);
});

test('waits for successful pending render and refuses failed or unavailable previews', async () => {
  const f = fixture(); let resolve;
  f.state.renderTask = new Promise(done => {resolve = done;}); f.state.lastRenderOK = false;
  const pending = captureStudyComparison(f.state, f);
  assert.deepEqual(f.events, []);
  f.state.lastRenderOK = true; resolve(true); await pending;
  for (const variant of ['failed', 'unready']) {
    const g = fixture(); if (variant === 'failed') g.state.renderTask = Promise.resolve(false); else g.state.ready = false;
    await assert.rejects(captureStudyComparison(g.state, g), /Preview/);
    assert.deepEqual(g.events, []);
  }
});

test('only one comparison can own a renderer at a time', async () => {
  const f = fixture(); let resolve;
  f.state.renderTask = new Promise(done => {resolve = done;});
  const first = captureStudyComparison(f.state, f);
  await assert.rejects(captureStudyComparison(f.state, f), /already/);
  resolve(true); await first;
});

test('loss of preview ownership rejects captures and marks the preview unavailable', async () => {
  const f = fixture();
  const snapshot = f.state.studio.snapshot;
  f.state.studio.snapshot = async () => {const result = await snapshot(); f.state.workspace.activeProjectId = 'b'; return result;};
  await assert.rejects(captureStudyComparison(f.state, f), /lost ownership/);
  assert.equal(f.state.lastRenderOK, false);
  assert.equal(f.events.filter(e => e[0] === 'update').length, 1);
});

test('a changed viewport cannot silently produce mismatched comparison images', async () => {
  const f = fixture(); let images = 0;
  f.browser.Image = class {constructor() {this.width = ++images === 1 ? 1000 : 900; this.height = 800;} async decode() {}};
  await assert.rejects(captureStudyComparison(f.state, f), /viewport changed/);
  assert.equal(f.events.at(-1)[1], 'ink-a');
  assert.equal(f.state.lastRenderOK, true);
});

test('image decode failure restores the original study and releases the renderer for a retry', async () => {
  const f = fixture(), Image = f.browser.Image;
  f.browser.Image = class {async decode() {throw Error('decode failed');}};
  await assert.rejects(captureStudyComparison(f.state, f), /decode failed/);
  assert.equal(f.events.at(-1)[1], 'ink-a');
  f.browser.Image = Image;
  assert.equal((await captureStudyComparison(f.state, f)).b.id, 'b');
});

test('floating point controls normalization does not reject an unchanged camera pose', async () => {
  const f = fixture();
  f.state.studio.getCamera = () => ({position: [1 + Number.EPSILON, 2, 3], target: [0, 1, 0]});
  const restore = f.state.studio.restoreCamera;
  f.state.studio.restoreCamera = (pose, options) => {
    restore(pose, options);
    f.state.studio.getCamera = () => ({position: [pose.position[0] + Number.EPSILON, 2, 3], target: [0, 1, 0]});
  };
  assert.equal((await captureStudyComparison(f.state, f)).a.id, 'a');
});
