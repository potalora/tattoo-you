import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWorkspace, validateAsset} from '../studio/workspace-validation.js';
import {STORAGE_LIMITS} from '../studio/storage-limits.js';
import {BODY_MODELS} from '../studio/model-catalog.js';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/portable-workspace-corpus.json',import.meta.url)));
function valueFor(item){
 const value=structuredClone(corpus.base);
 const put=(path,content,remove=false)=>{const target=path.slice(0,-1).reduce((v,k)=>v[k],value);if(remove)delete target[path.at(-1)];else target[path.at(-1)]=content;};
 for(const patch of item.patches)put(patch.path,patch.value,patch.remove);
 if(item.string)put(item.string.path,'x'.repeat(item.string.count));
 if(item.repeatProjects)value.projects=Array.from({length:item.repeatProjects},(_,i)=>({...structuredClone(value.projects[0]),id:i?'study-'+i:'study'}));
 if(item.repeatLayers)value.projects[0].tattoos=Array.from({length:item.repeatLayers},(_,i)=>({...structuredClone(value.projects[0].tattoos[0]),id:i?'layer-'+i:'layer'}));
 if(item.duplicateProject)value.projects.push(structuredClone(value.projects[0]));
 if(item.duplicateLayer)value.projects[0].tattoos.push(structuredClone(value.projects[0].tattoos[0]));
 return value;
}
test('portable corpus pins model topology and shared capacity limits',()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(BODY_MODELS).map(([id,m])=>[id,m.faceCount])),corpus.modelFaceCounts);
 for(const [key,value] of Object.entries(corpus.limits))assert.equal(STORAGE_LIMITS[key],value,key);
});
for(const item of corpus.cases)test('portable corpus: '+item.name,()=>{
 const value=valueFor(item),run=()=>validateWorkspace(value,new Set(corpus.assetIds));
 if(item.valid)assert.doesNotThrow(run);else assert.throws(run);
});

// Container/header parity uses a fixed decoder size. Actual browser decode failure
// and Pillow decompression behavior remain covered in their dedicated suites.
for(const item of corpus.assetCases)test('portable artwork corpus: '+item.name,async()=>{
 const run=()=>validateAsset({...corpus.assetBase,...item.patch},{keepId:true,browser:{decodeImage:async()=>({width:1,height:1})}});
 if(item.valid)await assert.doesNotReject(run);else await assert.rejects(run);
});
