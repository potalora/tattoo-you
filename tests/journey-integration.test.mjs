import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../studio/application.js';
import {project, copy} from '../studio/model.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
async function harness(t, {captureComparison} = {}) {
  const a = project('A'), b = {...copy(a), id: 'b', name: 'B'};
  a.tattoos = [{id: 'shared-ink', visible: true}]; b.tattoos = copy(a.tattoos);
  const workspace = {revision: 0, projects: [a, b], activeProjectId: a.id, assets: []};
  const timers = new Map(); let id = 0, options;
  const studio = {update: async () => {}, setQuality() {}, view() {}, setPlaceMode() {}, getMappingWarnings: () => [], dispose() {}};
  const app = createApplication({
    browser: {location: {search: ''}, document: {body: {inert: false}}},
    clock: {setTimeout(callback) {timers.set(++id, callback); return id;}, clearTimeout(id) {timers.delete(id);}},
    api: async () => workspace,
    createStudio: async (_host, received) => {options = received; return studio;},
    observeLayout: () => ({measure: () => null, dispose() {}}),
    captureComparison,
  });
  t.after(() => app.dispose());
  app.attachViewport({}, {});
  for (let attempt = 0; attempt < 30 && !app.getSnapshot().ui.ready; attempt++) await tick();
  assert.ok(app.getSnapshot().ui.ready);
  app.actions.openComparison();
  return {app, a, workspace, options, timers};
}

test('comparison owns mutation and camera-save guards through asynchronous capture', async t => {
  const gate = deferred(); let context;
  const h = await harness(t, {captureComparison: async (state) => {context = state; await gate.promise; return {a: {id: state.workspace.activeProjectId}, b: {id: 'b'}};}});
  const before = copy(h.workspace), capturing = h.app.actions.compareStudies();
  assert.equal(context.reviewing, true); assert.equal(h.app.getSnapshot().ui.blocked, true);
  h.app.actions.setNotes('must be blocked');
  assert.equal(h.app.actions.closeDialog(), false);
  h.options.onCamera({position: [9, 9, 9], target: [1, 1, 1]}, {custom: true});
  assert.deepEqual(h.workspace, before); assert.equal(h.timers.size, 0);
  gate.resolve(); assert.equal(await capturing, true);
  assert.equal(context.reviewing, false); assert.equal(h.app.getSnapshot().ui.blocked, false);
});

test('temporary B renderer stats cannot overwrite active A warning attribution or status', async t => {
  const gate = deferred();
  const h = await harness(t, {captureComparison: async () => {await gate.promise; return {a: {id: 'a'}, b: {id: 'b'}};}});
  const before = h.app.getSnapshot().ui;
  const capturing = h.app.actions.compareStudies();
  h.options.onStats({warnings: ['B-only distorted mapping'], mappingWarnings: [{tattooId: 'shared-ink', message: 'B-only distorted mapping'}]});
  const during = h.app.getSnapshot().ui;
  gate.resolve(); await capturing;
  assert.deepEqual(during.mappingWarnings, before.mappingWarnings);
  assert.equal(during.status, before.status);
});
