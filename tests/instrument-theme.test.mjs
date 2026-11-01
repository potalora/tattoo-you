import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source = await readFile(new URL('../studio/theme.js', import.meta.url), 'utf8');
function theme(search) {
  const root = {dataset: {}}, meta = {};
  runInNewContext(source, {URLSearchParams, location: {search}, document: {
    documentElement: root, querySelector: () => meta,
  }});
  return {theme: root.dataset.theme, serif: root.dataset.serif, color: meta.content};
}

test('instrument is an explicit URL presentation and does not inherit serif treatment', () => {
  assert.deepEqual(theme('?theme=instrument'), {theme: 'instrument', serif: undefined, color: '#dedfd9'});
});

test('default and invalid presentations open Instrument; Glass remains available', () => {
  for (const search of ['', '?theme=unknown']) assert.deepEqual(theme(search), {theme: 'instrument', serif: undefined, color: '#dedfd9'});
  assert.equal(theme('?theme=glass').serif, 'bodoni');
  assert.equal(theme('?theme=gallery&serif=original').serif, undefined);
});
