import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('check-only UI generation detects stale JSX output without modifying generated files', async t => {
  const {buildUI} = await import('../scripts/build-ui.mjs');
  assert.equal(typeof buildUI, 'function');
  const root = await mkdtemp(join(tmpdir(),'inkform-ui-check-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'studio/ui'),{recursive:true});
  await symlink(resolve('node_modules'),join(root,'node_modules'));
  await writeFile(join(root,'studio/ui/main.jsx'),'export const value = <span>Original</span>;');
  await writeFile(join(root,'studio/ui/globals.css'),'body {color:red}');
  await buildUI({sourceRoot:root});
  const original = await readFile(join(root,'studio/ui-app.js'));
  await buildUI({sourceRoot:root,check:true});
  await writeFile(join(root,'studio/ui/main.jsx'),'export const value = <span>Changed</span>;');
  await assert.rejects(buildUI({sourceRoot:root,check:true}), /stale.*ui-app.js/i);
  assert.deepEqual(await readFile(join(root,'studio/ui-app.js')),original);
  await buildUI({sourceRoot:root});
  await buildUI({sourceRoot:root,check:true});
  const originalCSS=await readFile(join(root,'studio/ui-app.css'));
  await writeFile(join(root,'studio/ui/globals.css'),'body {color:blue}');
  await assert.rejects(buildUI({sourceRoot:root,check:true}),/stale.*ui-app.css/i);
  assert.deepEqual(await readFile(join(root,'studio/ui-app.css')),originalCSS);
});
