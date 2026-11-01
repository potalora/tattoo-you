import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceSync} from '../studio/workspace-sync.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('default browser clock and clone retain the global receiver', async t => {
 const clone = globalThis.structuredClone;
 t.mock.method(globalThis, 'setTimeout', function () { assert.equal(this, globalThis); return 42; });
 t.mock.method(globalThis, 'clearTimeout', function () { assert.equal(this, globalThis); });
 t.mock.method(globalThis, 'structuredClone', function (value) { assert.equal(this, globalThis); return clone(value); });
 const state = {workspace: {revision: 0, projects: [{id: 'study'}], activeProjectId: 'study'}, dirty: false};
 const sync = createWorkspaceSync(state, {api: async () => ({revision: 1})});
 sync.scheduleSave();
 assert.equal(state.saveTimer, 42);
 assert.equal(await sync.flush(), true);
});
function deferred(){
 let resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b;});
 return {promise,resolve,reject};
}
function harness({api=async()=>({revision:1}),update=async()=>{}}={}){
 const project={id:'study',body:{stature:175.3},tattoos:[],selectedIds:[]};
 const state={workspace:{revision:0,projects:[project],activeProjectId:project.id,assets:[]},studio:{update},dirty:false,saving:false,conflict:false,saveTimer:null,saveTask:null,renderTask:null,lastRenderOK:true,rendering:false,renderAgain:false};
 const statuses=[],messages=[],retries=[],busy=[],timers=new Map();let timerId=0;
 const clock={setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}};
 const sync=createWorkspaceSync(state,{api,savedStatus:(...args)=>statuses.push(args),say:message=>messages.push(message),setRetry:value=>retries.push(value),setRenderBusy:value=>busy.push(value),clock});
 return {sync,state,project,statuses,messages,retries,busy,timers};
}

test('save scheduling debounces for 450ms and a clean flush performs no request',async()=>{
 let requests=0;const h=harness({api:async()=>{requests++;return {revision:1};}});
 assert.equal(await h.sync.flush(),true);assert.equal(requests,0);
 h.sync.scheduleSave();h.sync.scheduleSave();
 assert.equal(h.state.dirty,true);assert.equal(h.timers.size,1);
 const [{fn,delay}]=h.timers.values();assert.equal(delay,450);
 await fn();assert.equal(requests,1);assert.equal(h.state.dirty,false);assert.equal(h.timers.size,0);
 assert.deepEqual(h.statuses[0],['Unsaved changes']);
});

test('overlapping flush callers wait for the active PUT and all newer edits',async()=>{
 const gate=deferred(),calls=[];
 const h=harness({api:async(path,method,payload)=>{calls.push(structuredClone(payload));if(calls.length===1)await gate.promise;return {revision:calls.length};}});
 h.state.dirty=true;const first=h.sync.flush();
 h.project.body.stature=190;h.sync.scheduleSave();
 let settled=false;const dependent=h.sync.flush().then(result=>{settled=true;return result;});
 await tick();assert.equal(settled,false);assert.equal(h.state.saving,true);assert.equal(calls.length,1);
 gate.resolve();assert.deepEqual(await Promise.all([first,dependent]),[true,true]);
 assert.deepEqual(calls.map(payload=>[payload.revision,payload.projects[0].body.stature]),[[0,175.3],[1,190]]);
 assert.equal(h.state.saveTask,null);assert.equal(h.state.saving,false);assert.equal(h.state.dirty,false);
 assert.deepEqual(h.retries.at(-1),{hidden:true});
});

test('409 acknowledgement uses recovered revision and persists edits made during recovery',async()=>{
 const recovery=deferred(),calls=[];let original;
 const h=harness({api:async(path,method,payload)=>{
  if(method==='PUT'){
   calls.push(structuredClone(payload));
   if(calls.length===1){original=structuredClone(payload);throw Object.assign(Error('Conflict'),{status:409});}
   return {revision:8};
  }
  return recovery.promise;
 }});
 h.state.dirty=true;const saving=h.sync.flush();await tick();
 h.project.body.stature=201;h.sync.scheduleSave();
 recovery.resolve({...original,revision:7});assert.equal(await saving,true);
 assert.equal(calls.length,2);assert.equal(calls[1].revision,7);assert.equal(calls[1].projects[0].body.stature,201);
 assert.equal(h.state.conflict,false);assert.equal(h.state.dirty,false);
});

test('409 acknowledgement of the exact open workspace completes without a duplicate PUT',async()=>{
 let puts=0,acknowledged;
 const h=harness({api:async(path,method,payload)=>{
  if(method==='PUT'){puts++;acknowledged=structuredClone(payload);throw Object.assign(Error('Acknowledgement lost'),{status:409});}
  return {...acknowledged,revision:6};
 }});
 h.state.dirty=true;assert.equal(await h.sync.flush(),true);
 assert.equal(puts,1);assert.equal(h.state.workspace.revision,6);assert.equal(h.state.conflict,false);assert.equal(h.state.dirty,false);
 assert.deepEqual(h.statuses.at(-1),['Saved to workspace']);
});

test('equal projects with replacement artwork are a conflict, not a recovered acknowledgement',async()=>{
 let sent;
 const h=harness({api:async(path,method,payload)=>{
  if(method==='PUT'){sent=structuredClone(payload);throw Object.assign(Error('Conflict'),{status:409});}
  return {...sent,revision:2,assets:[{id:'art',url:'blob:replacement'}]};
 }});
 h.state.workspace.assets=[{id:'art',url:'blob:original'}];
 h.state.dirty=true;
 assert.equal(await h.sync.flush(),false);
 assert.equal(h.state.conflict,true);
 assert.equal(h.state.workspace.assets[0].url,'blob:original');
 assert.equal(h.statuses.at(-1)[0],'Changed in another tab');
});

test('different persisted workspace stops saves without overwriting open edits',async()=>{
 let writes=0;const h=harness({api:async(path,method)=>{
  if(method==='PUT'){writes++;throw Object.assign(Error('Conflict'),{status:409});}
  return {revision:9,projects:[],activeProjectId:null};
 }});
 h.state.dirty=true;assert.equal(await h.sync.flush(),false);
 assert.equal(h.state.conflict,true);assert.equal(h.state.dirty,true);assert.equal(h.project.body.stature,175.3);
 assert.ok(h.retries.some(value=>value.text==='Resolve conflict'));
 assert.equal(h.retries.at(-1).hidden,false);
 assert.equal(await h.sync.flush(),false);assert.equal(writes,1);
});

test('save failures including recovery GET release the task and retain retryable edits',async()=>{
 for(const recoveryFailure of [false,true]){
  let failing=true;
  const h=harness({api:(path,method)=>{
   if(!failing)return Promise.resolve({revision:2});
   if(recoveryFailure&&method==='PUT')return Promise.reject(Object.assign(Error('Conflict'),{status:409}));
   throw Error('Server unavailable');
  }});
  h.state.dirty=true;assert.equal(await h.sync.flush(),false);
  assert.equal(h.state.saveTask,null);assert.equal(h.state.saving,false);assert.equal(h.state.dirty,true);assert.equal(h.state.conflict,false);
  assert.equal(h.retries.at(-1).hidden,false);assert.match(h.messages.at(-1),/Server unavailable/);
  failing=false;assert.equal(await h.sync.flush(),true);assert.equal(h.state.dirty,false);assert.equal(h.state.workspace.revision,2);
 }
});

test('render callers drain newest body and layers before settling and release busy state',async()=>{
 const gate=deferred(),seen=[];const h=harness({update:async(body,tattoos,assets,selected)=>{
  seen.push(structuredClone({body,tattoos,assets,selected}));if(seen.length===1)await gate.promise;
 }});
 const first=h.sync.renderScene();h.project.body.stature=199;h.project.tattoos.push({id:'second',width:12});h.project.selectedIds=['second'];
 let settled=false;const latest=h.sync.renderScene().then(result=>{settled=true;return result;});
 await tick();assert.equal(settled,false);assert.equal(h.state.rendering,true);assert.equal(h.state.lastRenderOK,false);
 gate.resolve();assert.deepEqual(await Promise.all([first,latest]),[true,true]);
 assert.equal(seen.length,2);assert.equal(seen[0].body.stature,175.3);assert.equal(seen[0].tattoos.length,0);
 assert.equal(seen[1].body.stature,199);assert.equal(seen[1].tattoos[0].width,12);assert.deepEqual(seen[1].selected,['second']);
 assert.equal(h.state.renderTask,null);assert.equal(h.state.rendering,false);assert.equal(h.state.lastRenderOK,true);assert.deepEqual(h.busy,[true,false]);
});

test('render failures including synchronous update errors block stale captures and allow retry',async t=>{
 const errors=t.mock.method(console,'error',()=>{});
 for(const synchronous of [false,true]){
  let failing=true;const h=harness({update:()=>{
   if(failing){if(synchronous)throw Error('Device unavailable');return Promise.reject(Error('Device unavailable'));}
   return Promise.resolve();
  }});
  assert.equal(await h.sync.renderScene(),false);assert.equal(h.state.lastRenderOK,false);
  assert.equal(h.state.renderTask,null);assert.equal(h.state.rendering,false);assert.equal(h.busy.at(-1),false);
  assert.match(h.messages.at(-1),/Preview unavailable/);
  assert.doesNotMatch(h.messages.at(-1),/Device unavailable/,'technical detail belongs in previewError');
  failing=false;assert.equal(await h.sync.renderScene(),true);assert.equal(h.state.lastRenderOK,true);
 }
 assert.equal(errors.mock.callCount(),2);
});

test('queues read replaced workspace and studio references from state',async()=>{
 const writes=[],updates=[],h=harness({api:async(path,method,payload)=>{writes.push(payload);return {revision:5};}});
 const project={id:'replacement',body:{stature:180},tattoos:[{id:'ink'}],selectedIds:['ink']};
 h.state.workspace={revision:4,projects:[project],activeProjectId:project.id,assets:[{id:'art'}]};
 h.state.studio={update:async(...args)=>updates.push(args)};
 h.state.dirty=true;assert.equal(await h.sync.flush(),true);assert.equal(await h.sync.renderScene(),true);
 assert.equal(writes[0].revision,4);assert.equal(writes[0].activeProjectId,'replacement');assert.equal(h.state.workspace.revision,5);
 assert.equal(updates[0][0].stature,180);assert.deepEqual(updates[0][2],[{id:'art'}]);
 h.state.studio=null;assert.equal(await h.sync.renderScene(),undefined);assert.deepEqual(h.busy,[true,false]);
});
