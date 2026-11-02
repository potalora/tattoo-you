import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadJsx} from './helpers/load-jsx.mjs';
import {BODY_DEFAULTS} from '../studio/model.js';

const [{CompositionPanel, TattooCollection}, {ArtworkPanel}, {BodyPanel}, {RangeControl, closeMenuThen}, {StudyCard, Header, Inspector, CameraDock, PreviewRecovery, observeRecoveryHeaderBounds}] = await Promise.all([
  'composition-panel', 'artwork-panel', 'body-panel', 'primitives', 'main',
].map(name => loadJsx(new URL(`../studio/ui/${name}.jsx`, import.meta.url))));

function fixture() {
  const study = {id: 'study', name: 'Study', body: {...BODY_DEFAULTS}, tattoos: [], selectedIds: []};
  const workspace = {projects: [study], activeProjectId: study.id, assets: []};
  return {app: {actions: {}}, snapshot: {study, workspace, ui: {
    blocked: false, placing: false, artSearch: '', importExisting: false,
    lighting: 'studio', quality: 'auto', measurements: {}, preview: {phase: 'idle'},
    stats: {renderer: 'WebGPU', surface: 'Worker', pixelRatio: 1},
  }}};
}

test('instrument header exposes history without losing study, save and reference controls', () => {
  const props = withUI(fixture(), {ready: true, canUndo: true, canRedo: false, saveLabel: 'Saved in this browser', retry: {hidden: true, text: 'Retry save'}});
  const html = renderToStaticMarkup(React.createElement(Header, {...props, instrument: true}));
  assert.match(html, /aria-label="Undo"/);
  assert.match(html, /aria-label="Redo"/);
  assert.match(html, /id="project-select"/);
  assert.match(html, /aria-label="Review reference"/);
  assert.match(html, /aria-label="Compare studies"/);
  assert.match(html, /id="direct-export"/);
  const redo = /<button\b[^>]*aria-label="Redo"[^>]*>/.exec(html)?.[0];
  assert.match(redo || '', /disabled/);
  const original = renderToStaticMarkup(React.createElement(Header, props));
  assert.doesNotMatch(original, /aria-label="Undo"/);
});

test('instrument keeps original layer controls in an independent collection while glass retains its inline disclosure', () => {
  const props = fixture();
  props.snapshot.study.tattoos = [{id: 'layer', name: 'Original design', assetId: 'art', width: 7, visible: true, locked: true}];
  props.snapshot.workspace.assets = [{id: 'art', url: '/art.png'}];
  const instrument = renderToStaticMarkup(React.createElement(CompositionPanel, {...props, instrument: true}));
  assert.doesNotMatch(instrument, /id="layers"|class="control-details study-layers"/);
  const collection = renderToStaticMarkup(React.createElement(TattooCollection, props));
  assert.match(collection, /data-surface-content="collection"/);
  assert.match(collection, /<details\b[^>]*class="control-details study-layers"[^>]*open=""/);
  assert.match(collection, /aria-label="Select Original design"/);
  assert.match(collection, /aria-label="Unlock Original design"/);
  for (const id of ['select-all', 'select-none', 'duplicate-layers', 'remove-layers', 'collection-add']) {
    assert.equal((collection.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  const original = renderToStaticMarkup(React.createElement(CompositionPanel, props));
  assert.match(original, /id="layers"/);
  assert.doesNotMatch(original, /<details\b[^>]*class="control-details study-layers"[^>]*open=""/);
  assert.equal(CompositionPanel.compare(props, {...props, instrument: true}), false);
});

function withUI(props, change) {
  return {...props, snapshot: {...props.snapshot, ui: {...props.snapshot.ui, ...change}}};
}

function withTattoo(props = fixture()) {
  props.snapshot.study.tattoos = [{id: 'ink', assetId: 'art', name: 'Artist reference', width: 7.5,
    rotation: 0, opacity: .9, visible: true, locked: false, region: 'leftUpperArm'}];
  props.snapshot.study.selectedIds = ['ink'];
  props.snapshot.workspace.assets = [{id: 'art', name: 'Artist reference', url: '/art.png'}];
  return props;
}

function findElement(node, predicate) {
  if (!React.isValidElement(node)) return undefined;
  if (predicate(node)) return node;
  return React.Children.toArray(node.props.children).map(child => findElement(child, predicate)).find(Boolean);
}

function assertUniqueIds(html) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
  assert.equal(new Set(ids).size, ids.length, 'Mounted surfaces must not duplicate control or accessible-description ids');
}

test('comparison, reference review and immediate PNG download retain distinct reachable routes', () => {
  const props = withTattoo(withUI(fixture(), {ready: true, retry: {hidden: true}}));
  const calls = [];
  props.app.actions = {
    openComparison: () => calls.push('compare'), reviewReference: () => calls.push('review'),
    saveImage: () => calls.push('download'),
  };
  const header = Header({...props, instrument: true});
  const html = renderToStaticMarkup(header);
  for (const [id, label] of [['compare-studies', 'Compare studies'], ['save-image', 'Review reference']]) {
    const opening = new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`).exec(html)?.[0];
    assert.ok(opening);
    assert.ok(opening.includes(`aria-label="${label}"`));
    assert.doesNotMatch(opening, /\s(?:hidden|disabled)=/);
    findElement(header, node => node.props.id === id).props.onClick();
  }
  const direct = findElement(StudyCard(props), node => node.props.id === 'direct-export');
  assert.equal(direct.props.children, 'Download PNG now');
  assert.equal(direct.props.disabled, false);
  direct.props.onClick({currentTarget: {closest: () => null}});
  findElement(Header(props), node => node.props.id === 'save-image').props.onClick();
  assert.deepEqual(calls, ['compare', 'review', 'download', 'download']);
  for (const change of [{blocked: true}, {ready: false}]) {
    const unavailable = renderToStaticMarkup(React.createElement(Header, {...withUI(props, change), instrument: true}));
    for (const id of ['compare-studies', 'save-image']) {
      assert.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`).exec(unavailable)[0], /\sdisabled=""/);
    }
  }
});

test('instrument contextual tools expose the active adjustment and preserve each editable control', () => {
  for (const tool of ['place', 'size', 'rotate', 'view', 'more']) {
    const props = withTattoo(withUI(fixture(), {ready: true, adjustmentTool: tool}));
    const html = renderToStaticMarkup(React.createElement(CompositionPanel, {...props, instrument: true}));
    assert.match(html, new RegExp(`data-surface-content="composition" data-adjustment="${tool}"`));
    const nav = /<nav\b[^>]*aria-label="Tattoo adjustment"[^>]*>(.*?)<\/nav>/.exec(html)?.[1];
    assert.ok(nav);
    const buttons = [...nav.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)];
    assert.equal(buttons.length, 5);
    for (const [index, label] of ['Place', 'Size', 'Rotate', 'View', 'More'].entries()) {
      assert.equal(buttons[index][2], label);
      assert.ok(buttons[index][1].includes(`aria-pressed="${label.toLowerCase() === tool}"`));
    }
    assert.match(html, /data-tool="size" role="group" aria-label="Width \(approx\.\) adjustment"/);
    assert.match(html, /data-tool="rotate" role="group" aria-label="Rotation adjustment"/);
    const more = /<details\b[^>]*class="control-details advanced-tattoo"[^>]*>/.exec(html)[0];
    assert.equal(/\sopen=""/.test(more), tool === 'more');
    for (const id of ['region', 'place-on-body', 'width', 'rotation', 'layer-name', 'offsetX', 'offsetY', 'opacity', 'flip']) {
      assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${tool}: ${id} retained once`);
    }
    assert.equal(CompositionPanel.compare(props, withUI(props, {adjustmentTool: tool === 'place' ? 'size' : 'place'})), false);
  }
});

test('mounted Instrument inspector and combined adjustment/collection surfaces keep ids unique', () => {
  for (const empty of [false, true]) {
    const props = withUI(empty ? fixture() : withTattoo(), {ready: true, panelState: 'normal', surface: 'composition'});
    const inspector = renderToStaticMarkup(React.createElement(Inspector, {...props, panelRef: {current: null}, instrument: true}));
    assertUniqueIds(inspector);
    const tabs = /<nav\b[^>]*aria-label="Workspace"[^>]*>(.*?)<\/nav>/.exec(inspector)?.[1];
    for (const surface of ['composition', 'collection', 'body', 'artwork']) {
      assert.equal((tabs.match(new RegExp(`data-surface="${surface}"`, 'g')) || []).length, 1);
    }
    const combined = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(CompositionPanel, {...props, instrument: true}),
      React.createElement(TattooCollection, props)));
    assertUniqueIds(combined);
    assert.equal((combined.match(/id="layers"/g) || []).length, 1);
  }
});

function skipped(previous, next) {
  return [CompositionPanel, ArtworkPanel, BodyPanel].map(panel => panel.compare(previous, next));
}

test('memo boundaries skip unrelated notifications, save status and render telemetry', () => {
  const previous = fixture(), next = withUI(previous, {
    status: 'Saved reference', saveLabel: 'Saved', rendering: true,
    measurements: {...previous.snapshot.ui.measurements},
    preview: {...previous.snapshot.ui.preview, elapsedMs: 350},
    stats: {...previous.snapshot.ui.stats, drawCalls: 12, triangles: 24000},
  });
  assert.deepEqual(skipped(previous, next), [true, true, true]);
  assert.deepEqual(skipped(previous, {...previous, app: {actions: {}}}), [false, false, false], 'New action bindings must reach all panels');
});

test('search, import mode and placement updates reach only panels that display them', () => {
  const previous = fixture();
  assert.deepEqual(skipped(previous, withUI(previous, {artSearch: 'rose'})), [true, false, true]);
  assert.deepEqual(skipped(previous, withUI(previous, {importExisting: true})), [true, false, true]);
  assert.deepEqual(skipped(previous, withUI(previous, {placing: true})), [false, true, true]);
  assert.deepEqual(skipped(previous, withUI(previous, {blocked: true})), [false, false, false], 'Transaction blocking must disable every panel');
});

test('first artwork updates body navigation while later tattoo edits leave body controls cached', () => {
  const previous = fixture();
  const study = {...previous.snapshot.study, notes: 'Check this placement', tattoos: [{id: 'new-layer'}]};
  const next = {...previous, snapshot: {...previous.snapshot, study}};
  assert.deepEqual(skipped(previous, next), [false, true, false]);
  const editedLayer = {...study, tattoos: [{id: 'new-layer', width: 8}]};
  assert.equal(BodyPanel.compare(next, {...next, snapshot: {...next.snapshot, study: editedLayer}}), true);
  const changedBody = {...study, body: {...study.body, stature: 180}};
  assert.deepEqual(skipped(previous, {...next, snapshot: {...next.snapshot, study: changedBody}}), [false, true, false]);
  const switchedStudy = {...study, id: 'other-study'};
  assert.deepEqual(skipped(previous, {...next, snapshot: {...next.snapshot, study: switchedStudy}}), [false, true, false], 'Study identity resets body input ownership even if its body object is shared');
});

test('new library assets invalidate library-dependent views', () => {
  const previous = fixture();
  const workspace = {...previous.snapshot.workspace, assets: [{id: 'rose', name: 'Rose'}]};
  assert.deepEqual(skipped(previous, {...previous, snapshot: {...previous.snapshot, workspace}}), [false, false, true]);
});

test('body memo cannot suppress capability, lighting, quality, measurement or preview changes', () => {
  const previous = fixture();
  for (const change of [
    {lighting: 'neutral'}, {quality: 'efficient'}, {measurements: {waist: 80}},
    {preview: {phase: 'rendering', samples: 16}},
    {preview: {phase: 'error', message: 'Preview failed'}},
    {preview: {phase: 'complete', samples: 16, denoised: true}},
    {preview: {phase: 'complete', samples: 16, denoiseWarning: 'Filter unavailable'}},
    {stats: {...previous.snapshot.ui.stats, renderer: 'WebGL 2'}},
    {stats: {...previous.snapshot.ui.stats, surface: 'Main thread'}},
    {stats: {...previous.snapshot.ui.stats, pixelRatio: 2}},
  ]) assert.deepEqual(skipped(previous, withUI(previous, change)), [true, true, false]);
  const completed = withUI(previous, {preview: {phase: 'complete', samples: 16}});
  for (const change of [{samples: 32}, {denoised: true}, {denoiseWarning: 'Filter unavailable'}]) {
    assert.equal(BodyPanel.compare(completed, withUI(completed, {preview: {...completed.snapshot.ui.preview, ...change}})), false);
  }
  const failed = withUI(previous, {preview: {phase: 'error', message: 'First failure'}});
  assert.equal(BodyPanel.compare(failed, withUI(failed, {preview: {phase: 'error', message: 'Different failure'}})), false);
});

test('range controls expose formatted physical units and percentages to assistive technology', () => {
  for (const [value, format, expected] of [
    [7.5, value => `${value.toFixed(1)} cm ≈`, '7.5 cm ≈'],
    [.8, value => `${Math.round(value * 100)}%`, '80%'],
    [175.3, value => `${value.toFixed(1)} cm`, '175.3 cm'],
  ]) {
    const html = renderToStaticMarkup(React.createElement(RangeControl, {
      id: 'range', label: 'Value', value, min: 0, max: 205, step: .1, format,
      onChange() {}, onCommit() {},
    }));
    const input = /<input\b[^>]*type="range"[^>]*>/.exec(html)[0];
    assert.ok(input.includes(`aria-valuetext="${expected}"`));
    assert.ok(html.includes('<label for="range">Value</label>'));
  }
});

test('skin swatches keep their own grid layout without the default secondary-button shell', () => {
  const html = renderToStaticMarkup(React.createElement(BodyPanel, fixture()));
  const swatches = [...html.matchAll(/<button\b[^>]*data-tone="[^"]+"[^>]*>/g)].map(([tag]) => tag);
  assert.equal(swatches.length, 10);
  for (const tag of swatches) {
    assert.doesNotMatch(tag, /class="[^"]*\bsecondary\b/, 'Plain controls must not inherit secondary button margin, border and full width');
    assert.match(tag, /aria-label="Monk \d+"/);
  }
});

test('closing disclosure restores its summary before the action takes focus', () => {
  const calls = [];
  const summary = {focus() { calls.push('summary focus'); }};
  const menu = {
    removeAttribute(name) { assert.equal(name, 'open'); calls.push('closed'); },
    querySelector(selector) { assert.equal(selector, ':scope > summary'); return summary; },
  };
  const event = {currentTarget: {closest(selector) { assert.equal(selector, 'details'); return menu; }}};
  assert.equal(closeMenuThen(event, () => { calls.push('dialog focus'); return 'result'; }), 'result');
  assert.deepEqual(calls, ['closed', 'summary focus', 'dialog focus'], 'Menu cleanup must not steal focus back from the action');
  assert.equal(closeMenuThen({currentTarget: {closest: () => null}}, () => 42), 42);
});

function previewMarkup(preview) {
  return renderToStaticMarkup(React.createElement(BodyPanel, withUI(fixture(), {preview})));
}

function announcement(html) {
  return /<span\b[^>]*id="raytrace-announcement"[^>]*>(.*?)<\/span>/.exec(html)[1];
}

test('sample progress changes visually without changing the phase live announcement', () => {
  const first = previewMarkup({phase: 'rendering', samples: 16});
  const next = previewMarkup({phase: 'rendering', samples: 32});
  assert.equal(announcement(first), 'Refining light');
  assert.equal(announcement(first), announcement(next));
  assert.match(first, /id="raytrace-samples" aria-live="off"> · 16 samples/);
  assert.match(next, /id="raytrace-samples" aria-live="off"> · 32 samples/);
  assert.match(next, /id="raytrace-announcement" role="status" aria-live="polite"/);
  assert.match(announcement(previewMarkup({phase: 'denoising'})), /Finishing/);
  assert.match(announcement(previewMarkup({phase: 'error', message: 'Preview failed'})), /Preview failed/);
  assert.match(announcement(previewMarkup({phase: 'complete', samples: 32, denoised: true})), /Preview ready. Export image to save it./);
});


test('selected tattoo placement and width stay ahead of a long composition list', () => {
  const props = fixture();
  const tattoos = Array.from({length: 24}, (_, index) => ({
    id: `layer-${index}`, assetId: 'art', name: `Design ${index + 1}`, width: 7.5,
    rotation: 0, opacity: .9, region: 'leftUpperArm', visible: true, locked: false,
  }));
  props.snapshot.study = {...props.snapshot.study, tattoos, selectedIds: ['layer-23']};
  props.snapshot.workspace.assets = [{id: 'art', name: 'Design', url: '/art.png'}];
  const html = renderToStaticMarkup(React.createElement(CompositionPanel, props));
  assert.ok(html.indexOf('id="region"') < html.indexOf('id="layers"'));
  assert.ok(html.indexOf('id="width"') < html.indexOf('id="layers"'));
  assert.match(html, /id="selection-title"[^>]*>Design 24/);
  assert.equal((html.match(/data-select="layer-/g) || []).length, 24);
  for (const id of ['place-on-body', 'duplicate-layers', 'remove-layers', 'lock-selection', 'unlock-selection', 'browse-art']) {
    assert.ok(html.includes(`id="${id}"`), `${id} remains available`);
  }
  for (const action of ['visible', 'locked', 'up', 'down']) {
    assert.equal((html.match(new RegExp(`data-action="${action}"`, 'g')) || []).length, 24);
  }
  assert.match(html, /aria-label="Hide Design 24"/);
  assert.match(html, /aria-label="Lock Design 24"/);
});


test('a locked selection keeps unlocking and its width ahead of hidden adjustments', () => {
  const props = fixture();
  props.snapshot.study = {...props.snapshot.study, selectedIds: ['locked'], tattoos: [{
    id: 'locked', assetId: 'art', name: 'Existing design', width: 16.3, rotation: -5,
    opacity: .9, region: 'custom', visible: true, existing: true, locked: true,
  }]};
  props.snapshot.workspace.assets = [{id: 'art', name: 'Design', url: '/art.png'}];
  const html = renderToStaticMarkup(React.createElement(CompositionPanel, props));
  assert.match(html, /Locked in place. Unlock to adjust this tattoo/);
  assert.match(html, /Width: 16.3 cm \(approx.\)/);
  assert.match(html, /id="tattoo-controls" hidden=""/);
  const unlock = /<button\b[^>]*id="unlock-selection"[^>]*>/.exec(html)[0];
  assert.ok(!unlock.includes('hidden='));
  assert.ok(!unlock.includes('disabled='));
  assert.ok(html.indexOf('id="unlock-selection"') < html.indexOf('id="tattoo-controls"'));
});

test('clearing selection keeps existing layers available without empty-study guidance', () => {
  const props = fixture();
  props.snapshot.study = {...props.snapshot.study, tattoos: [{
    id: 'existing', assetId: 'art', name: 'Existing design', width: 7,
    rotation: 0, opacity: .9, region: 'chest', visible: true, locked: true,
  }]};
  props.snapshot.workspace.assets = [{id: 'art', name: 'Design', url: '/art.png'}];
  const html = renderToStaticMarkup(React.createElement(CompositionPanel, props));
  assert.doesNotMatch(html, /Add artwork to begin a placement study/);
  assert.match(html, /Select a tattoo below to adjust its placement/);
  assert.match(html, /aria-label="Select Existing design"/);
  assert.equal((html.match(/id="browse-art"/g) || []).length, 1);
  assert.ok(html.indexOf('id="layers"') < html.indexOf('id="browse-art"'), 'Existing layers come before the add-artwork action');
  const instrument = renderToStaticMarkup(React.createElement(CompositionPanel, {...props, instrument: true}));
  assert.match(instrument, /Choose a tattoo from the Tattoos tray/);
  assert.doesNotMatch(instrument, /id="layers"|Try your first placement/);
});


test('study save indicator distinguishes confirmed saves, pending work and errors', () => {
  for (const [saveLabel, saveError, state] of [
    ['Connecting…', false, 'pending'], ['Saving…', false, 'pending'],
    ['Saved to workspace', false, 'saved'], ['Saved in this browser', false, 'saved'],
    ['Not connected', true, 'error'], ['Saved copy loaded', true, 'error'],
  ]) {
    const props = withUI(fixture(), {saveLabel, saveError, retry: {hidden: true, text: 'Retry save'}});
    const html = renderToStaticMarkup(React.createElement(StudyCard, props));
    assert.match(html, new RegExp(`data-save-state="${state}" role="status" title="${saveLabel}"`));
    assert.match(html, /aria-label="Current study" title="Study"/);
    if (state === 'error') assert.match(html, /color:var\(--danger\)/);
  }
});

test('compact study capsule retains secondary study actions and readable save state', () => {
  const props = withUI(fixture(), {saveLabel: 'Saved to workspace', saveError: false, retry: {hidden: true, text: 'Retry save'}});
  const html = renderToStaticMarkup(React.createElement(StudyCard, props));
  assert.doesNotMatch(html, /class="brand"/, 'The compact capsule is reserved for study identity and actions');
  for (const id of ['project-select', 'undo', 'redo', 'new-project', 'rename-project', 'duplicate-project', 'delete-project', 'data-open', 'notes-open']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} remains available exactly once`);
  }
  assert.match(html, /class="save-status-short" aria-hidden="true">Saved</);
  assert.match(html, /Saved to workspace/);
  assert.equal((html.match(/id="help-open"/g) || []).length, 1, 'Study actions expose Help directly');
});

test('artwork offers direct import and separate preview/add targets without a duplicate heading', () => {
  const props = fixture();
  props.snapshot.workspace.assets = [{id: 'art', name: 'existing_astronaut-reference.png', url: '/art.png'}];
  const html = renderToStaticMarkup(React.createElement(ArtworkPanel, props));
  assert.doesNotMatch(html, /<h2[^>]*>Artwork<\/h2>/);
  assert.match(html, /type="file"[^>]*aria-label="Import artwork"/);
  assert.match(html, /id="import-existing"/);
  assert.match(html, /aria-label="Preview existing_astronaut-reference.png"/);
  assert.match(html, /aria-label="Add existing_astronaut-reference.png to study"/);
  assert.match(html, />existing astronaut reference<\/strong>/);
});

test('selected artwork uses its own compact preview and retains full title', () => {
  const props = fixture();
  props.snapshot.study = {...props.snapshot.study, tattoos: [{id: 'one', assetId: 'art', name: 'Astronaut reference', width: 7, rotation: 0, opacity: .9, region: 'leftUpperArm', visible: true, locked: false}], selectedIds: ['one']};
  props.snapshot.workspace.assets = [{id: 'art', name: 'Astronaut reference', url: '/api/assets/art'}];
  const html = renderToStaticMarkup(React.createElement(CompositionPanel, props));
  assert.match(html, /class="selection-preview"[^>]*src="\/api\/assets\/art"/);
  assert.match(html, /id="selection-title"[^>]*title="Astronaut reference"/);
  assert.ok(html.indexOf('class="selection-preview"') < html.indexOf('id="region"'));
});

test('body setup exposes reference, anatomy and starting profile before optional proportions', () => {
  const html = renderToStaticMarkup(React.createElement(BodyPanel, fixture()));
  const setup = /<section\b[^>]*class="[^"]*body-reference-setup[^"]*"[^>]*>(.*?)<\/section>/.exec(html)?.[1];
  assert.ok(setup, 'Reference setup is a single visible section');
  assert.doesNotMatch(setup, /<details/);
  assert.ok(setup.indexOf('id="body-model"') < setup.indexOf('id="body"'));
  assert.ok(setup.indexOf('id="body"') < setup.indexOf('id="body-profile"'));
  assert.match(setup, /Choosing another body creates a new study\./);
  assert.match(setup, />Next: add artwork</);
  const proportions = /<details\b[^>]*class="[^"]*body-proportions-details[^"]*"[^>]*>(.*?)<\/details>/.exec(html);
  assert.ok(proportions, 'Proportions use a separate disclosure');
  assert.doesNotMatch(proportions[0].split('>')[0], /\bopen(?:=|\s|$)/);
  assert.match(proportions[1], /<summary>Adjust proportions<\/summary>/);
  assert.match(proportions[1], /id="stature"/);
  assert.ok(html.indexOf('Next: add artwork') < proportions.index);
  const props = fixture();
  props.snapshot.study.tattoos = [{id: 'layer'}];
  const withArtwork = renderToStaticMarkup(React.createElement(BodyPanel, props));
  assert.match(withArtwork, />Back to adjustment</);
  assert.doesNotMatch(withArtwork, />Next: add artwork</);
});


test('image export stays distinct from automatic study saving', () => {
  const props = withUI(fixture(), {ready: true, saveLabel: 'Saved to workspace', retry: {hidden: true, text: 'Retry save'}});
  const html = renderToStaticMarkup(React.createElement(Header, props));
  assert.match(html, /id="save-image"[^>]*aria-label="Export image"/);
  assert.match(html, /class="save-label-compact" aria-hidden="true">Export</);
  assert.doesNotMatch(html, /Save reference/);
});


test('instrument empty study exposes the reference and artwork setup actions before future placement', () => {
  const props = fixture();
  props.snapshot.study.tattoos = [];
  props.snapshot.study.selectedIds = [];
  const html = renderToStaticMarkup(React.createElement(CompositionPanel, {...props, instrument: true}));
  assert.match(html, /<ol class="setup-steps">/);
  assert.match(html, />Choose a reference</);
  assert.match(html, />Add your artwork</);
  assert.match(html, /class="setup-future"[^>]*>[\s\S]*Place and adjust/);
  assert.equal((html.match(/id="browse-art"/g) || []).length, 1);
  assert.doesNotMatch(html, /Layer actions|Choose a tattoo|No tattoos added/);
});

test('save retry and conflict recovery stay enabled when only the preview is unavailable',()=>{
 for(const storageMode of ['browser','server'])for(const text of ['Retry save','Resolve conflict'])for(const dataBlocked of [false,true]){
  const props=withUI(fixture(),{blocked:true,dataBlocked,storageMode,ready:false,previewError:'Body could not render',saveError:true,saveLabel:'Not saved',retry:{hidden:false,text}});
  const html=renderToStaticMarkup(React.createElement(StudyCard,props));
  const retry=/<button\b[^>]*id="retry-save"[^>]*>/.exec(html)[0];
  assert.equal(/\sdisabled(?:=""|(?=[\s>]))/.test(retry),dataBlocked,`${storageMode}: ${text} is blocked only by data transactions`);
  assert.doesNotMatch(retry,/\shidden(?:=""|(?=[\s>]))/);
 }
});

test('repeat import is available before every populated library and keeps preparation options before selection', () => {
  for (const count of [0, 1, 8, 32]) {
    const props = fixture();
    props.snapshot.workspace.assets = Array.from({length: count}, (_, index) => ({id: `art-${index}`, name: `Artwork ${index}.png`, url: `/art-${index}.png`}));
    const html = renderToStaticMarkup(React.createElement(ArtworkPanel, props));
    assert.ok(html.indexOf('id="tattoo-upload"') < html.indexOf('id="art-search"'));
    assert.ok(html.indexOf('id="import-existing"') < html.indexOf('id="artwork"'));
    assert.match(html, /accept="image\/png,image\/webp" multiple=""/);
    assert.match(html, /Transparent PNG or WebP/);
    assert.match(html, /up to 20 MB/);
    assert.equal((html.match(/id="tattoo-upload"/g) || []).length, 1);
    if (count) assert.match(html, /<details class="import-guidance"><summary>Formats and existing tattoos<\/summary>/);
  }
});

test('a failed save keeps one recoverable cause together with its retry while saving again', () => {
  const props = withUI(fixture(), {saveLabel: 'Saving…', saveFailure: 'Storage is full.', saveError: true, dataBlocked: false, retry: {hidden: false, text: 'Retry save'}});
  const html = renderToStaticMarkup(React.createElement(StudyCard, props));
  assert.match(html, /class="save-recovery"[^>]*>[\s\S]*class="save-recovery-copy"[\s\S]*Storage is full\.[\s\S]*id="retry-save"/);
  assert.equal((html.match(/id="retry-save"/g) || []).length, 1);
  assert.ok(html.indexOf('class="save-recovery"') > html.indexOf('aria-label="Current study"'));
  assert.match(html, /data-save-state="error"/);
});

test('Help is reachable directly from Study actions', () => {
  const props = withUI(fixture(), {saveLabel: 'Saved', retry: {hidden: true, text: 'Retry save'}});
  const html = renderToStaticMarkup(React.createElement(StudyCard, props));
  assert.match(html, /id="help-open"[^>]*>Help and shortcuts/);
  const calls = [];
  props.app.actions.openDialog = dialog => calls.push(dialog);
  const findHelp = node => node?.props?.id === 'help-open' ? node : React.Children.toArray(node?.props?.children).map(findHelp).find(Boolean);
  const help = findHelp(StudyCard(props));
  help.props.onClick({currentTarget: {closest: () => ({
    removeAttribute(name) { assert.equal(name, 'open'); calls.push('menu closed'); },
    querySelector: () => ({focus() { calls.push('summary focused'); }}),
  })}});
  assert.deepEqual(calls, ['menu closed', 'summary focused', 'help']);
});

test('both empty themes offer one artwork path without selection or layer material', () => {
  for (const instrument of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(CompositionPanel, {...fixture(), instrument}));
    assert.equal((html.match(/id="browse-art"/g) || []).length, 1);
    assert.doesNotMatch(html, /id="selection-title"|id="layers"|No tattoos added/);
  }
});

test('selection Detail remains a direct camera action when the inspector is expanded', () => {
  const props = withUI(fixture(), {ready: true, panelState: 'expanded', currentView: 'body'});
  props.snapshot.study.tattoos = [{id: 'one', name: 'Ink', assetId: 'art', width: 7, rotation: 0, visible: true}];
  props.snapshot.study.selectedIds = ['one'];
  const html = renderToStaticMarkup(React.createElement(CompositionPanel, props));
  assert.match(html, /id="selection-detail"[^>]*aria-label="Detail close-up"/);
  assert.match(html, /id="selection-detail"[^>]*aria-pressed="false"/);
  assert.ok(html.indexOf('id="selection-detail"') < html.indexOf('id="width"'));
  assert.equal(CompositionPanel.compare(props, withUI(props, {currentView: 'detail'})), false);
  assert.equal(CompositionPanel.compare(props, withUI(props, {ready: false})), false);
});

test('each primary group transform describes editable and excluded tattoos even with one editable selection', () => {
  for (const editableCount of [1, 2]) {
    const props = fixture();
    props.snapshot.study.tattoos = Array.from({length: editableCount + 1}, (_, i) => ({id: `ink-${i}`, name: `Ink ${i}`, assetId: 'art', width: 7, rotation: 0, visible: true, locked: i === editableCount}));
    props.snapshot.study.selectedIds = props.snapshot.study.tattoos.map(item => item.id);
    const html = renderToStaticMarkup(React.createElement(CompositionPanel, props));
    assert.equal((html.match(/role="group"[^>]*aria-describedby="selection-summary selection-adjustment-scope"/g) || []).length, 2);
    assert.match(html, new RegExp(`id="selection-summary">${editableCount + 1} selected · ${editableCount} editable · 1 locked`));
    assert.match(html, /id="selection-adjustment-scope"[^>]*>[\s\S]*Locked tattoos stay in place\./);
  }
});


test('preview recovery distinguishes unsaved work and keeps diagnostics secondary with data actions available', () => {
  assert.equal(typeof PreviewRecovery, 'function', 'Preview failure needs a coherent recoverable presentation');
  for (const hasUnsavedChanges of [false, true]) {
    const props = withUI(fixture(), {previewError: 'Failed to fetch', loading: false, hasUnsavedChanges, dataBlocked: false, saveLabel: 'Saved in this browser'});
    const html = renderToStaticMarkup(React.createElement(PreviewRecovery, props));
    assert.match(html, /Preview unavailable/);
    assert.match(html, /<details[^>]*>[\s\S]*Technical details[\s\S]*Failed to fetch/);
    assert.match(html, /id="reload-app"[^>]*class="[^"]*primary/);
    assert.match(html, /id="recover-workspace"/);
    assert.ok(html.indexOf('id="reload-app"') < html.indexOf('id="recover-workspace"'));
    if (hasUnsavedChanges) {
      assert.match(html, /not saved/);
      assert.doesNotMatch(html, /Your study is saved/);
    } else assert.match(html, /Your study is saved/);
  }
});


test('camera status suppresses duplicate save cause and never repeats stale preview loading status', () => {
  const props = withUI(fixture(), {status: 'Storage is full.', saveFailure: 'Storage is full.'});
  const failedSave = renderToStaticMarkup(React.createElement(CameraDock, props));
  assert.doesNotMatch(failedSave, /Storage is full/);
  assert.match(failedSave, /id="status"[^>]*hidden=""/);
  const failedPreview = renderToStaticMarkup(React.createElement(CameraDock, withUI(props, {previewError: 'Failed to fetch', status: 'Opening your workspace…'})));
  assert.match(failedPreview, /Preview unavailable/);
  assert.doesNotMatch(failedPreview, /Opening your workspace|Failed to fetch/);
  const placing = renderToStaticMarkup(React.createElement(CameraDock, withUI(props, {placing: true})));
  assert.match(placing, /Tap visible skin/);
  assert.match(placing, /id="stage-stop-placing"/);
});


test('preview recovery claims a saved study only after persistence and study identity are confirmed', () => {
  for (const {studyPresent, saveLabel, saveError, saveFailure} of [
    {studyPresent: false, saveLabel: 'Connecting…'},
    {studyPresent: true, saveLabel: 'Connecting…'},
    {studyPresent: false, saveLabel: 'Saved in this browser'},
    {studyPresent: true, saveLabel: 'Saved in this browser', saveError: true, saveFailure: 'Quota full'},
  ]) {
    const props = withUI(fixture(), {previewError: 'Quota full', loading: false, hasUnsavedChanges: false, dataBlocked: false, saveLabel, saveError, saveFailure});
    if (!studyPresent) props.snapshot.study = null;
    const html = renderToStaticMarkup(React.createElement(PreviewRecovery, props));
    assert.doesNotMatch(html, /Your study is saved|Some changes are not saved/, `${studyPresent ? 'Loaded study' : 'No study'} with ${saveLabel} has unconfirmed persistence`);
    assert.match(html, /Backup and recovery options remain available/);
    assert.match(html, /id="recover-workspace"/);
    const backup = /<button[^>]*id="recover-workspace"[^>]*>/.exec(html)[0];
    assert.doesNotMatch(backup, /\sdisabled(?:=""|(?=[\s>]))/);
  }
});


test('preview recovery tracks live header expansion independently and disposes its layout subscription', t => {
  assert.equal(typeof observeRecoveryHeaderBounds, 'function');
  const properties = new Map(), listeners = new Map(), observers = [];
  const root = {style: {setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key)}};
  const header = {bottom: 106, getBoundingClientRect() { return {bottom: this.bottom}; }};
  const study = {bottom: 106, getBoundingClientRect() { return {bottom: this.bottom}; }};
  const globals = {
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
      observe(target) { this.targets.push(target); }
      disconnect() { this.disconnected = true; }
    },
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); },
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  const dispose = observeRecoveryHeaderBounds(root, header, study);
  assert.equal(properties.get('--recovery-header-bottom'), '106px', 'Initial bounds exist before renderer startup');
  assert.deepEqual(observers[0].targets, [header, study]);
  study.bottom = 204.5;
  observers[0].callback();
  assert.equal(properties.get('--recovery-header-bottom'), '204.5px', 'Expanded save recovery determines preview position');
  study.bottom = 106;
  observers[0].callback();
  assert.equal(properties.get('--recovery-header-bottom'), '106px', 'Successful save releases the extra space');
  header.bottom = 118;
  listeners.get('resize')();
  assert.equal(properties.get('--recovery-header-bottom'), '118px', 'Viewport resizing measures viewport coordinates again');
  dispose();
  assert.equal(observers[0].disconnected, true);
  assert.equal(listeners.size, 0);
  assert.equal(properties.has('--recovery-header-bottom'), false);
});
