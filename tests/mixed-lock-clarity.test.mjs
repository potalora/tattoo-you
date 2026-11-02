import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadJsx} from './helpers/load-jsx.mjs';

const {CompositionPanel} = await loadJsx(new URL('../studio/ui/composition-panel.jsx', import.meta.url));

function renderSelection(lockedStates, {blocked = false, instrument = true} = {}) {
  const tattoos = lockedStates.map((locked, index) => ({
    id: `tattoo-${index}`, name: `Design ${index + 1}`, assetId: 'art',
    width: 8 + index, rotation: 0, opacity: .9, region: 'chest', visible: true, locked,
  }));
  return renderToStaticMarkup(React.createElement(CompositionPanel, {
    app: {actions: {}}, instrument,
    snapshot: {
      workspace: {assets: [{id: 'art', url: '/art.png'}]},
      study: {id: 'study', tattoos, selectedIds: tattoos.map(tattoo => tattoo.id)},
      selection: {canReanchor: lockedStates.filter(locked => !locked).length === 1},
      ui: {blocked, adjustmentTool: 'size', mappingWarnings: []},
    },
  }));
}

const button = html => /<button\b[^>]*id="unlock-selection"[^>]*>.*?<\/button>/.exec(html)?.[0];

test('mixed selections keep edits available and offer a scoped inline unlock action', () => {
  for (const instrument of [true, false]) {
    const html = renderSelection([false, true], {instrument});
    const unlock = button(html);
    assert.match(unlock, /class="[^"]*\bselection-unlock-inline\b/);
    assert.match(unlock, />Unlock 1 locked tattoo<\/button>$/);
    assert.doesNotMatch(unlock, /\bsecondary\b|hidden=|disabled=/);
    assert.equal((html.match(/id="unlock-selection"/g) || []).length, 1);
    assert.match(html, /<p id="selection-summary">2 selected · 1 editable · 1 locked<\/p>/);
    assert.match(html, /<p id="selection-adjustment-scope"[^>]*>Only the editable tattoo changes\. Locked tattoos stay in place\.<\/p><button[^>]*id="unlock-selection"/);
    assert.ok(html.indexOf('id="width"') < html.indexOf('id="unlock-selection"'));
    assert.doesNotMatch(html, /Unlock to adjust/);
    assert.match(html, /<div id="tattoo-controls">/);
    assert.doesNotMatch(/<input\b[^>]*id="width"[^>]*>/.exec(html)[0], /disabled=/);
    assert.match(html, /Only the editable tattoo changes\. Locked tattoos stay in place\./);
    assert.match(html, /aria-describedby="selection-summary selection-adjustment-scope"/);
  }
});

test('mixed unlock labels count only locked tattoos and obey the blocked state', () => {
  const html = renderSelection([true, false, true], {blocked: true});
  assert.match(button(html), />Unlock 2 locked tattoos<\/button>$/);
  assert.match(button(html), /disabled=""/);
  assert.match(html, /3 selected · 1 editable · 2 locked/);
});

test('fully locked selections retain the clear prerequisite before hidden adjustments', () => {
  for (const locked of [[true], [true, true]]) {
    const html = renderSelection(locked);
    const unlock = button(html);
    assert.match(unlock, /\bsecondary\b/);
    assert.match(unlock, />Unlock to adjust<\/button>$/);
    assert.doesNotMatch(unlock, /selection-unlock-inline|hidden=|disabled=/);
    assert.equal((html.match(/id="unlock-selection"/g) || []).length, 1);
    assert.ok(html.indexOf('id="unlock-selection"') < html.indexOf('id="tattoo-controls"'));
    assert.match(html, /<div id="tattoo-controls" hidden="">/);
  }
});

test('an editable selection keeps its existing hidden unlock control', () => {
  const html = renderSelection([false]);
  assert.match(button(html), /hidden=""/);
  assert.equal((html.match(/id="unlock-selection"/g) || []).length, 1);
  assert.doesNotMatch(html, /selection-unlock-inline/);
});
