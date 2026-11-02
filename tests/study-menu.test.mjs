import test from 'node:test';
import assert from 'node:assert/strict';
import {bindStudyMenuDismissal} from '../studio/ui/study-menu.js';
import {loadJsx} from './helpers/load-jsx.mjs';

const {closeMenuThen} = await loadJsx(new URL('../studio/ui/primitives.jsx', import.meta.url));

function fixture(t) {
  const document = new EventTarget();
  const trigger = {focus() { document.activeElement = trigger; }};
  const action = {}, destination = {};
  const menu = {
    open: true, ownerDocument: document,
    contains(target) { return [menu, trigger, action].includes(target); },
    querySelector(selector) { assert.equal(selector, ':scope > summary'); return trigger; },
    removeAttribute(name) { assert.equal(name, 'open'); menu.open = false; },
  };
  document.activeElement = action;
  const cleanup = bindStudyMenuDismissal(menu);
  t.after(() => cleanup?.());
  const dispatch = (type, properties = {}) => {
    const event = new Event(type, {cancelable: true, bubbles: true});
    for (const [name, value] of Object.entries(properties)) Object.defineProperty(event, name, {value});
    document.dispatchEvent(event);
    return event;
  };
  return {document, trigger, action, destination, menu, cleanup, dispatch};
}

test('Escape dismisses an open Study actions disclosure and restores its visible trigger', t => {
  const {document, trigger, menu, dispatch} = fixture(t);
  const event = dispatch('keydown', {key: 'Escape'});
  assert.equal(menu.open, false);
  assert.equal(document.activeElement, trigger);
  assert.equal(event.defaultPrevented, true, 'the handled Escape must not also stop placement');
});

test('outside pointer dismissal leaves focus and default interaction with the destination', t => {
  const {document, trigger, destination, menu, dispatch} = fixture(t);
  document.activeElement = destination;
  const event = dispatch('pointerdown', {target: destination});
  assert.equal(menu.open, false);
  assert.equal(document.activeElement, destination);
  assert.notEqual(document.activeElement, trigger);
  assert.equal(event.defaultPrevented, false);
});

test('pointer inside keeps menu actions usable and dialog focus wins after action cleanup', t => {
  const {document, trigger, action, destination, menu, dispatch} = fixture(t);
  dispatch('pointerdown', {target: action});
  assert.equal(menu.open, true);
  assert.equal(document.activeElement, action);
  const result = closeMenuThen({currentTarget: {closest: () => menu}}, () => {
    assert.equal(menu.open, false);
    assert.equal(document.activeElement, trigger);
    document.activeElement = destination;
    return 'opened dialog';
  });
  assert.equal(result, 'opened dialog');
  assert.equal(document.activeElement, destination);
  dispatch('keydown', {key: 'Escape'});
  assert.equal(document.activeElement, destination, 'closed menu must not reclaim focus from a dialog');
});

test('unrelated keys and a closed disclosure do not consume keyboard input', t => {
  const {document, action, menu, dispatch} = fixture(t);
  assert.equal(dispatch('keydown', {key: 'Tab'}).defaultPrevented, false);
  assert.equal(menu.open, true);
  dispatch('keydown', {key: 'Escape', defaultPrevented: true});
  assert.equal(menu.open, true, 'an Escape already handled by another control keeps its priority');
  menu.open = false;
  assert.equal(dispatch('keydown', {key: 'Escape'}).defaultPrevented, false);
  assert.equal(document.activeElement, action);
});

test('unmount cleanup releases dismissal listeners', t => {
  const {document, action, menu, cleanup, dispatch} = fixture(t);
  cleanup?.();
  dispatch('keydown', {key: 'Escape'});
  dispatch('pointerdown', {target: {}});
  assert.equal(menu.open, true);
  assert.equal(document.activeElement, action);
});
