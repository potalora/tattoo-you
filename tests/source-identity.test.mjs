import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceIdentity} from '../scripts/source-identity.mjs';
const execute=promisify(execFile);

test('release identity distinguishes committed source from tracked and untracked preview changes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'inkform-source-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const git=(...args)=>execute('git',args,{cwd:root});
 assert.deepEqual(await sourceIdentity(root),{commit:null,dirtyPreview:true});
 await git('init','--quiet');
 await writeFile(join(root,'runtime.js'),'export const value = 1;');
 await git('add','runtime.js');
 await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Synthetic source identity');
 const {stdout}=await git('rev-parse','HEAD');
 assert.deepEqual(await sourceIdentity(root),{commit:stdout.trim(),dirtyPreview:false});
 await writeFile(join(root,'runtime.js'),'export const value = 2;');
 assert.deepEqual(await sourceIdentity(root),{commit:stdout.trim(),dirtyPreview:true});
 await git('checkout','--','runtime.js');
 await writeFile(join(root,'new-runtime.js'),'export const added = true;');
 assert.equal((await sourceIdentity(root)).dirtyPreview,true);
});
