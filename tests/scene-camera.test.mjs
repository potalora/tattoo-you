import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PerspectiveCamera} from 'three';
import {OrbitControls} from '../studio/vendor/OrbitControls.js';
import {restoreCameraPose, constrainCameraToFloor} from '../studio/camera-floor.js';

// Exercise the scene-owned camera closure with real controls, without creating
// a second renderer or requiring a browser/GPU for notification lifecycle tests.
const source = await readFile(new URL('../studio/scene.js', import.meta.url), 'utf8');
const method = source.match(/restoreCamera\(v.*?(?=,renderer,dispose)/s)[0];
const listener = source.match(/listen\(controls,'change',(.*)\);\n/)[1];
function fixture(t) {
  const root = {addEventListener() {}, removeEventListener() {}};
  const element = {style: {}, addEventListener() {}, removeEventListener() {}, ownerDocument: root, getRootNode: () => root};
  const camera = new PerspectiveCamera(34, 1, .01, 20), controls = new OrbitControls(camera, element);
  Object.assign(controls, {enableDamping: true, dampingFactor: .09, minDistance: .22, maxDistance: 4.5, maxPolarAngle: Math.PI * .91});
  restoreCameraPose(camera, controls, {position: [.4, 1.2, 2.8], target: [0, 1.13, 0]});
  const timers = new Map(), notifications = []; let timerId = 0, canceled = 0, renders = 0;
  const scope = {camera, controls, restoreCameraPose, constrainCameraToFloor, disposed: false, applyingCamera: false,
    updatingControls: false, floorCollision: false, customCamera: false, viewName: 'body', cameraTimer: null,
    cameraMotion: {cancel() {canceled++;}}, requestRender() {renders++;},
    setTimeout(callback) {timers.set(++timerId, callback); return timerId;}, clearTimeout(id) {timers.delete(id);},
    options: {onCamera: (...args) => notifications.push(args)}};
  const api = new Function('scope', `with (scope) { return {${method}, onChange: ${listener}}; }`)(scope);
  controls.addEventListener('change', api.onChange);
  t.after(() => controls.dispose());
  return {camera, controls, timers, notifications, scope, api,
    flush() {const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback();},
    readPose: () => ({position: camera.position.toArray(), target: controls.target.toArray()}),
    get canceled() {return canceled;}, get renders() {return renders;}};
}
const pose = {position: [.3, 1.4, 2.2], target: [0, 1.1, 0]};
function nearPose(actual, expected) {
  for (const key of ['position', 'target']) for (let i = 0; i < 3; i++) assert.ok(Math.abs(actual[key][i] - expected[key][i]) < 1e-10);
}

test('exact restore preserves a validated named view and callback metadata without animation', t => {
  const f = fixture(t);
  f.api.restoreCamera(pose, {viewName: 'detail'});
  nearPose(f.readPose(), pose);
  assert.equal(f.scope.viewName, 'detail'); assert.equal(f.scope.customCamera, false);
  assert.equal(f.canceled, 1); assert.ok(f.renders > 0);
  f.flush(); assert.equal(f.notifications.length, 1); assert.deepEqual(f.notifications[0][1], {custom: false});
});

test('silent restore clears pre-existing and internally generated callbacks after comparison', t => {
  const f = fixture(t);
  f.controls.rotateLeft(.1); assert.equal(f.timers.size, 1);
  f.api.restoreCamera(pose, {viewName: 'front', silent: true});
  nearPose(f.readPose(), pose); assert.equal(f.scope.viewName, 'front');
  assert.equal(f.timers.size, 0); f.flush(); assert.deepEqual(f.notifications, []);
  // A subsequent genuine orbit still changes identity and persists normally.
  f.controls.rotateLeft(.1); f.flush();
  assert.equal(f.scope.viewName, 'custom'); assert.deepEqual(f.notifications.at(-1)[1], {custom: true});
});

test('legacy pose-only restoration remains custom and invalid semantic names fail to custom', t => {
  const f = fixture(t);
  for (const options of [undefined, {viewName: 'unknown'}]) {
    f.api.restoreCamera(pose, options);
    nearPose(f.readPose(), pose);
    assert.equal(f.scope.viewName, 'custom'); assert.equal(f.scope.customCamera, true);
  }
});
