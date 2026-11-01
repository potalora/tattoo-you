import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceSync} from '../studio/workspace-sync.js';
import {createStudyController} from '../studio/study-controller.js';
import {createWorkspaceFiles} from '../studio/workspace-files.js';
import {project, addTattoo, MAX_TATTOOS} from '../studio/model.js';

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(api=async()=>({revision:1}),update=async()=>{}) {
 const p={id:'study',body:{stature:175.3},tattoos:[],selectedIds:[]};
 const state={revision:0,projects:[p],activeProjectId:p.id,assets:[]};
 const messages=[],retry={hidden:true};
 const context={workspace:state,studio:{update},dirty:true,saving:false,conflict:false,saveTimer:null,saveTask:null,renderTask:null,lastRenderOK:true,rendering:false,renderAgain:false,retry};
 const sync=createWorkspaceSync(context,{api,savedStatus:message=>messages.push(message),say:message=>messages.push(message),setRetry:value=>Object.assign(retry,value)});
 return {context,state,p,messages,api,flush:sync.flush,render:sync.renderScene};
}
test('dependent flush waits for in-flight PUT and drains newer edits before resolving',async()=>{const gate=deferred(),calls=[];const h=harness(async(path,method,payload)=>{calls.push(structuredClone(payload));if(calls.length===1)await gate.promise;return {revision:calls.length};});const first=h.flush();h.p.body.stature=190;h.context.dirty=true;let dependentFinished=false;const dependent=h.flush().then(ok=>{assert.equal(ok,true);dependentFinished=true;});await tick();assert.equal(dependentFinished,false);gate.resolve();await Promise.all([first,dependent]);assert.equal(calls.length,2);assert.equal(calls[0].projects[0].body.stature,175.3);assert.equal(calls[1].projects[0].body.stature,190);assert.equal(calls[1].revision,1);assert.equal(h.context.dirty,false);assert.equal(h.context.saveTask,null);});
test('409 acknowledgement retains and persists edits made while recovery GET is pending',async()=>{const recovery=deferred(),calls=[];let firstPayload;const h=harness(async(path,method,payload)=>{if(method==='PUT'){calls.push(structuredClone(payload));if(calls.length===1){firstPayload=structuredClone(payload);throw Object.assign(Error('Conflict'),{status:409});}return {revision:8};}return recovery.promise;});const saving=h.flush();await tick();h.p.body.stature=201;h.context.dirty=true;recovery.resolve({...firstPayload,revision:7});assert.equal(await saving,true);assert.equal(calls.length,2);assert.equal(calls[1].revision,7);assert.equal(calls[1].projects[0].body.stature,201);assert.equal(h.context.dirty,false);assert.equal(h.context.conflict,false);});
test('different persisted workspace is a conflict and open edits remain dirty',async()=>{const h=harness(async(path,method)=>{if(method==='PUT')throw Object.assign(Error('Conflict'),{status:409});return {revision:9,projects:[],activeProjectId:null};});assert.equal(await h.flush(),false);assert.equal(h.context.conflict,true);assert.equal(h.context.dirty,true);assert.equal(h.context.retry.hidden,false);assert.equal(h.p.body.stature,175.3);});
test('lost server during conflict recovery returns failed save with retry available',async()=>{const h=harness(async(path,method)=>{if(method==='PUT')throw Object.assign(Error('Conflict'),{status:409});throw Error('Server unavailable');});assert.equal(await h.flush(),false);assert.equal(h.context.dirty,true);assert.equal(h.context.retry.hidden,false);assert.equal(h.context.saving,false);assert.equal(h.context.saveTask,null);});
test('overlapping render callers await latest body and layer updates',async()=>{const gate=deferred(),seen=[];const h=harness(undefined,async(body,tattoos)=>{seen.push({body:structuredClone(body),tattoos:structuredClone(tattoos)});if(seen.length===1)await gate.promise;});const first=h.render();h.p.body.stature=199;h.p.tattoos.push({id:'second',width:12});let readyToSnapshot=false;const dependent=h.render().then(()=>{readyToSnapshot=true;});await tick();assert.equal(readyToSnapshot,false);gate.resolve();await Promise.all([first,dependent]);assert.equal(seen.length,2);assert.equal(seen[0].body.stature,175.3);assert.equal(seen[1].body.stature,199);assert.equal(seen[1].tattoos[0].width,12);assert.equal(h.context.renderTask,null);assert.equal(h.context.rendering,false);});
test('render failure reports false to exporters and clears task for subsequent retry',async t=>{t.mock.method(console,'error',()=>{});let attempts=0;const h=harness(undefined,async()=>{if(!attempts++)throw Error('Image failed');});assert.equal(await h.render(),false);assert.equal(h.context.renderTask,null);assert.equal(await h.render(),true);assert.equal(attempts,2);});
test('preview export freezes input and retains copied metadata through delayed image decoding',async()=>{
 const h=harness(),decode=deferred();h.p.name='Original study';h.p.tattoos=[{name:'Original layer',width:7,visible:true}];
 const e=exportHarness(h,{decode:()=>decode.promise}),exporting=e.export();
 assert.equal(e.body.inert,true);assert.equal(e.button.disabled,true);await tick();
 h.p.name='Later study';h.p.tattoos[0].name='Later layer';h.p.tattoos[0].width=22;decode.resolve();await exporting;
 assert.ok(e.labels.includes('Original study'));assert.ok(e.labels.some(value=>value.includes('Original layer ≈ 7.0 cm')));assert.ok(!e.labels.some(value=>value.includes('Later')));
 assert.equal(e.downloads[0],'inkform-Original-study-custom-view.png');assert.equal(e.body.inert,false);assert.equal(e.button.disabled,false);
});
function exportHarness(h,{decode=async()=>{},snapshot=async()=> 'data:image/png;base64,completed'}={}) {
 const button={disabled:false},body={inert:false},labels=[],downloads=[],images=[];
 const document={createElement:()=>({getContext:()=>({measureText:text=>({width:text.length*7}),fillRect(){},drawImage(image){images.push(image.src);},fillText(value){labels.push(value);}}),toBlob(callback){callback({});}})};
 const Image=class{width=100;height=100;decode(){return decode();}};
 h.context.studio.snapshot=snapshot;
 const files=createWorkspaceFiles(h.context,{
  api:h.api,active:()=>h.context.workspace.projects.find(p=>p.id===h.context.workspace.activeProjectId),
  say:message=>h.messages.push(message),setInteractionBlocked(value){body.inert=value;button.disabled=value;},
  download:name=>downloads.push(name),browser:{document,Image},
 });
 return {button,body,labels,downloads,images,export:files.saveImage};
}
test('preview export drains pending edits before capturing the newest rendered study',async()=>{
 const gate=deferred(),seen=[];let snapshots=0;const h=harness(undefined,async(body,tattoos)=>{seen.push({body:structuredClone(body),tattoos:structuredClone(tattoos)});if(seen.length===1)await gate.promise;});
 h.p.name='Latest study';h.render();h.p.body.stature=199;h.p.tattoos=[{name:'Latest layer',width:12,visible:true}];h.render();
 const e=exportHarness(h,{snapshot:async()=>{snapshots++;assert.equal(seen.at(-1).body.stature,199);assert.equal(seen.at(-1).tattoos[0].width,12);return 'data:image/png;base64,newest';}}),exporting=e.export();
 assert.equal(e.body.inert,true);assert.equal(e.button.disabled,true);await tick();assert.equal(snapshots,0);assert.equal(e.downloads.length,0);
 gate.resolve();await exporting;assert.equal(seen.length,2);assert.equal(snapshots,1);assert.deepEqual(e.images,['data:image/png;base64,newest']);assert.ok(e.labels.some(x=>x.includes('Latest layer ≈ 12.0 cm')));assert.equal(e.body.inert,false);assert.equal(e.button.disabled,false);
});
test('failed pending preview edit prevents export and restores interaction',async t=>{t.mock.method(console,'error',()=>{});
 const gate=deferred(),h=harness(undefined,async()=>{await gate.promise;throw Error('Renderer failed');});h.render();
 const e=exportHarness(h,{snapshot:async()=>assert.fail('A failed pending render must not be captured')}),exporting=e.export();const rejected=assert.rejects(exporting,/Preview could not be rendered/);
 await tick();assert.equal(e.body.inert,true);gate.resolve();await rejected;assert.deepEqual(e.downloads,[]);assert.equal(e.body.inert,false);assert.equal(e.button.disabled,false);
});
test('a previously failed render blocks stale export until a successful retry completes',async t=>{t.mock.method(console,'error',()=>{});
 let attempts=0,snapshots=0;const h=harness(undefined,async()=>{if(!attempts++)throw Error('Renderer failed');});h.p.name='Recovered study';
 assert.equal(await h.render(),false);assert.equal(h.context.renderTask,null);assert.equal(h.context.lastRenderOK,false);
 const e=exportHarness(h,{snapshot:async()=>{snapshots++;return 'data:image/png;base64,recovered';}});
 await assert.rejects(e.export(),/Preview could not be rendered/);assert.equal(snapshots,0);assert.deepEqual(e.downloads,[]);assert.equal(e.body.inert,false);assert.equal(e.button.disabled,false);
 assert.equal(await h.render(),true);assert.equal(h.context.lastRenderOK,true);await e.export();assert.equal(snapshots,1);assert.deepEqual(e.images,['data:image/png;base64,recovered']);assert.equal(e.downloads.length,1);assert.equal(e.body.inert,false);assert.equal(e.button.disabled,false);
});
test('completed preview export captures the existing snapshot without updating or cancelling it',async()=>{
 const h=harness(undefined,async()=>assert.fail('Completed preview must not be rerendered'));h.p.name='Completed preview';h.context.renderScene=()=>assert.fail('Export must preserve the completed preview');
 const completed={url:'data:image/png;base64,raytraced',cancelled:false};const e=exportHarness(h,{snapshot:async()=>{assert.equal(completed.cancelled,false);return completed.url;}});
 await e.export();assert.deepEqual(e.images,[completed.url]);assert.equal(e.downloads.length,1);assert.equal(h.context.renderTask,null);assert.equal(e.body.inert,false);assert.equal(e.button.disabled,false);
});
test('snapshot failure restores interaction and produces no download',async()=>{
 const h=harness(),e=exportHarness(h,{snapshot:async()=>{throw Error('Snapshot unavailable');}});await assert.rejects(e.export(),/Snapshot unavailable/);assert.deepEqual(e.downloads,[]);assert.equal(e.body.inert,false);assert.equal(e.button.disabled,false);
});


test('actual mutate returns false on capacity rejection and preserves project selection and history',()=>{
 const p=project('At capacity'),asset={id:'art',name:'Artwork'},messages=[],effects=[];
 for(let i=0;i<MAX_TATTOOS;i++)addTattoo(p,asset);
 p.selectedIds=[p.tattoos[2].id,p.tattoos[7].id];
 const state={workspace:{projects:[p],activeProjectId:p.id,assets:[asset]},convertingBody:false};
 const controller=createStudyController(state,{say:message=>messages.push(message),render:()=>effects.push('render'),renderScene:()=>effects.push('scene'),scheduleSave:()=>effects.push('save')});
 const history=controller.hist();history.push(p);
 const before=structuredClone(p),past=structuredClone(history.past);
 assert.equal(controller.mutate(value=>addTattoo(value,asset)),false);
 assert.deepEqual(p,before);assert.deepEqual(history.past,past);assert.deepEqual(effects,[]);assert.match(messages.at(-1),/hold 16 tattoos/);
 assert.equal(controller.mutate(value=>{value.name='Renamed';}),true);assert.equal(p.name,'Renamed');assert.deepEqual(effects,['render','scene','save']);
});
