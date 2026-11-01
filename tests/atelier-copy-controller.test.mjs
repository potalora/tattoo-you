import test from 'node:test';
import assert from 'node:assert/strict';
import {BODY_DEFAULTS,project,addTattoo} from '../studio/model.js';
import {resolveBodyModel} from '../studio/model-catalog.js';
import {createWorkspaceSync} from '../studio/workspace-sync.js';
import {createStudyController} from '../studio/study-controller.js';
function deferred(){let resolve;const promise=new Promise(a=>{resolve=a;});return {promise,resolve};}
function harness({update=async()=>{},save=async()=>{},modelId='makehuman-v1',ackLost=false}={}){
 const original=project('Original',{...BODY_DEFAULTS,bodyModelId:modelId}),layer=addTattoo(original,{id:'art',name:'Existing ink'},true);
 layer.region='custom';layer.placement={faceIndex:Math.min(70000,resolveBodyModel(modelId).faceCount-1),barycentric:[.2,.3,.5]};original.notes='Preserve this';
 const workspace={revision:0,projects:[original],activeProjectId:original.id,assets:[{id:'art'}]},body={inert:false},loading={hidden:true},messages=[],updates=[],writes=[],persisted=[],restored=[],timers=new Set();
 let camera={position:[1,1,3],target:[0,1,0]};
 let stored={revision:0,projects:structuredClone(workspace.projects),activeProjectId:original.id};
 const studio={async update(...args){updates.push(structuredClone(args));await update(...args);},view(){camera={position:[.5,1,3],target:[0,1,0]};},getCamera:()=>structuredClone(camera),restoreCamera(value){restored.push(structuredClone(value));camera=structuredClone(value);}};
 const context={workspace,studio,dirty:true,saving:false,conflict:false,saveTimer:null,saveTask:null,renderTask:null,lastRenderOK:true,rendering:false,renderAgain:false,convertingBody:false,ready:true,currentView:'detail',retry:{hidden:true}};
 async function api(path,method='GET',payload){
  assert.equal(path,'workspace');if(method==='GET')return structuredClone(stored);
  assert.equal(method,'PUT');writes.push(structuredClone(payload));
  if(payload.revision!==stored.revision)throw Object.assign(Error('Revision conflict'),{status:409});
  await save(payload,writes.length);persisted.push(structuredClone(payload));
  stored={...structuredClone(payload),revision:payload.revision+1};
  if(ackLost&&writes.length===2)throw Error('Saved response lost');
  return {revision:stored.revision};
 }
 const say=message=>messages.push(message);
 const sync=createWorkspaceSync(context,{api,say,savedStatus:say,setRetry:value=>Object.assign(context.retry,value),clock:{setTimeout(fn){timers.add(fn);return fn;},clearTimeout(fn){timers.delete(fn);}}});
 const controller=createStudyController(context,{...sync,api,say,render(){},placeMode(){},askName:async()=>null,
  chooseCamera(name){context.currentView=name;studio.view(name);return sync.renderScene();},
  setInteractionBlocked(value){body.inert=value;},setLoading(value){loading.hidden=!value;},setCameraSelection(){}});
 Object.assign(context,sync,controller);
 return {context,workspace,original,body,loading,messages,updates,writes,persisted,restored,timers,run:()=>context.useBodyModel('atelier-v1'),compare:(...args)=>context.useBodyModel(...args),change:anatomy=>context.changeAnatomy(anatomy)};
}

test('one owned Atelier conversion blocks concurrent attempts and commits only a rendered copy',async()=>{
 const entered=deferred(),gate=deferred();let first=true;const h=harness({update:async body=>{if(body.bodyModelId==='atelier-v1'&&first){first=false;entered.resolve();await gate.promise;}}}),before=structuredClone(h.original);
 const converting=h.run();await entered.promise;assert.equal(h.body.inert,true);assert.equal(h.context.ready,false);assert.equal(h.loading.hidden,false);assert.equal(h.context.convertingBody,true);
 assert.equal(await h.run(),false);assert.equal(h.workspace.projects.length,2);assert.equal(h.persisted.length,1);assert.deepEqual(h.persisted[0].projects,[before]);
 gate.resolve();assert.equal(await converting,true);
 const created=h.workspace.projects.find(p=>p.id!==h.original.id);assert.equal(created.body.bodyModelId,'atelier-v1');assert.equal(h.workspace.activeProjectId,created.id);assert.equal(created.tattoos[0].placement,null);assert.equal(created.tattoos[0].region,'custom');assert.equal(created.tattoos[0].locked,true);
 assert.deepEqual(h.original.body,before.body);assert.deepEqual(h.original.tattoos,before.tattoos);assert.equal(h.original.notes,before.notes);assert.deepEqual(created.camera,{position:[.5,1,3],target:[0,1,0]});
 assert.equal(h.persisted.length,2);assert.deepEqual(h.persisted.at(-1).projects,h.workspace.projects);assert.equal(h.context.dirty,false);assert.equal(h.context.convertingBody,false);assert.equal(h.context.ready,true);assert.equal(h.body.inert,false);assert.equal(h.loading.hidden,true);assert.equal(h.timers.size,0);
});

test('failed Atelier loading removes the temporary copy and persists the restored original',async()=>{
 const h=harness({update:async body=>{if(body.bodyModelId==='atelier-v1')throw Error('Missing model');}}),before=structuredClone(h.original);
 assert.equal(await h.run(),false);assert.equal(h.workspace.projects.length,1);assert.equal(h.workspace.activeProjectId,h.original.id);assert.deepEqual(h.original.body,before.body);assert.deepEqual(h.original.tattoos,before.tattoos);
 assert.deepEqual(h.restored,[{position:[1,1,3],target:[0,1,0]}]);assert.equal(h.updates.at(-1)[0].bodyModelId,'makehuman-v1');assert.equal(h.persisted.length,2);assert.deepEqual(h.persisted.at(-1).projects,h.workspace.projects);
 assert.ok(h.persisted.every(write=>write.projects.every(p=>p.body.bodyModelId==='makehuman-v1')));assert.match(h.messages.at(-1),/original study is still open/i);
 assert.equal(h.context.dirty,false);assert.equal(h.context.convertingBody,false);assert.equal(h.context.ready,true);assert.equal(h.body.inert,false);assert.equal(h.loading.hidden,true);assert.equal(h.timers.size,0);
});

test('failed initial save leaves the original untouched and restores interaction without loading another model',async()=>{
 const h=harness({save:async()=>{throw Error('Server unavailable');}}),before=structuredClone(h.original);
 assert.equal(await h.run(),false);assert.deepEqual(h.workspace.projects,[before]);assert.equal(h.workspace.activeProjectId,before.id);assert.deepEqual(h.updates,[]);assert.deepEqual(h.persisted,[]);assert.equal(h.context.dirty,true);assert.equal(h.context.retry.hidden,false);
 assert.equal(h.context.convertingBody,false);assert.equal(h.context.ready,true);assert.equal(h.body.inert,false);assert.equal(h.loading.hidden,true);assert.match(h.messages.at(-1),/Save or resolve/);
});

test('failed camera draw does not commit a copy whose final preview failed',async()=>{
 let atelierUpdates=0;const h=harness({update:async body=>{if(body.bodyModelId==='atelier-v1'&&++atelierUpdates===2)throw Error('Device lost during camera draw');}});
 assert.equal(await h.run(),false);assert.equal(h.workspace.projects.length,1);assert.equal(h.workspace.activeProjectId,h.original.id);assert.ok(h.persisted.every(write=>write.projects.length===1));
 assert.equal(h.context.lastRenderOK,true);assert.equal(h.body.inert,false);assert.equal(h.context.ready,true);assert.equal(h.context.convertingBody,false);
});

test('copy save failure rolls back the preview and persists the untouched original',async()=>{
 const h=harness({save:async(payload,attempt)=>{if(attempt===2)throw Error('Copy save interrupted');}}),before=structuredClone(h.original);
 assert.equal(await h.run(),false);assert.deepEqual(h.workspace.projects,[before]);assert.equal(h.workspace.activeProjectId,before.id);
 assert.equal(h.writes.length,3);assert.deepEqual(h.persisted.at(-1).projects,[before]);assert.equal(h.context.dirty,false);
 assert.deepEqual(h.restored,[{position:[1,1,3],target:[0,1,0]}]);assert.equal(h.context.retry.hidden,true);
 assert.equal(h.body.inert,false);assert.equal(h.loading.hidden,true);assert.match(h.messages.at(-1),/could not be saved/i);
});

test('successful comparison leaves the complete original study unchanged',async()=>{
 const h=harness(),before=structuredClone(h.original);assert.equal(await h.run(),true);assert.deepEqual(h.original,before);
});

test('comparison can return an Atelier study to MakeHuman without changing original layers or assets',async()=>{
 const h=harness({modelId:'atelier-v1'}),before=structuredClone(h.original),assets=structuredClone(h.workspace.assets);
 assert.equal(await h.compare('makehuman-v1'),true);assert.deepEqual(h.original,before);assert.deepEqual(h.workspace.assets,assets);
 const created=h.workspace.projects.at(-1);assert.equal(created.body.bodyModelId,'makehuman-v1');assert.equal(created.tattoos[0].placement,null);assert.deepEqual(created.selectedIds,before.selectedIds);
 assert.deepEqual(h.persisted.at(-1).projects,h.workspace.projects);
});

test('unsupported or unchanged model selection neither saves nor creates or renders a study',async()=>{
 const h=harness(),before=structuredClone(h.original);
 for(const id of ['future-v9','__proto__','',null,undefined,{},'makehuman-v1'])assert.equal(await h.compare(id),false);
 assert.deepEqual(h.workspace.projects,[before]);assert.deepEqual(h.writes,[]);assert.deepEqual(h.updates,[]);assert.equal(h.body.inert,false);assert.equal(h.context.convertingBody,false);
});

test('persistent save failure leaves the recovered original dirty with Retry visible',async()=>{
 const h=harness({save:async(payload,attempt)=>{if(attempt>=2)throw Error('Server unavailable');}}),before=structuredClone(h.original);
 assert.equal(await h.run(),false);assert.deepEqual(h.workspace.projects,[before]);assert.equal(h.workspace.activeProjectId,before.id);
 assert.equal(h.context.dirty,true);assert.equal(h.context.retry.hidden,false);assert.equal(h.persisted.length,1);assert.deepEqual(h.persisted[0].projects,[before]);assert.equal(h.timers.size,0);assert.equal(h.context.ready,true);assert.equal(h.body.inert,false);
});

test('lost copy-save acknowledgement reconciles only its own copy before persisting rollback',async()=>{
 const h=harness({ackLost:true}),before=structuredClone(h.original);assert.equal(await h.run(),false);
 assert.deepEqual(h.workspace.projects,[before]);assert.deepEqual(h.persisted.at(-1).projects,[before]);assert.equal(h.persisted.length,3);
 assert.equal(h.context.dirty,false);assert.equal(h.context.conflict,false);assert.equal(h.context.retry.hidden,true);assert.equal(h.workspace.revision,3);assert.equal(h.body.inert,false);
});

test('same-model Blender anatomy changes save a separate study with no reused locked or custom anchors',async()=>{
 const h=harness({modelId:'blender-studio-v1'}),idea=addTattoo(h.original,{id:'art',name:'Idea'});idea.placement={faceIndex:21347,barycentric:[.1,.2,.7]};h.original.selectedIds=h.original.tattoos.map(t=>t.id);
 const before=structuredClone(h.original),assets=structuredClone(h.workspace.assets);assert.equal(await h.change('female'),true);
 const created=h.workspace.projects.at(-1);assert.equal(created.body.bodyModelId,'blender-studio-v1');assert.equal(created.body.body,'female');assert.equal(created.name,'Original — Blender Studio Female placement review');assert.deepEqual(created.tattoos,before.tattoos.map(t=>({...t,placement:null})));assert.deepEqual(created.selectedIds,before.selectedIds);assert.deepEqual(h.original,before);assert.deepEqual(h.workspace.assets,assets);assert.deepEqual(h.persisted.at(-1).projects,h.workspace.projects);
 assert.equal(await h.change('female'),false);assert.equal(h.workspace.projects.length,2);
});

test('failed Blender anatomy preview or save restores the original anatomy and exact anchors',async()=>{
 for(const mode of ['load','save','ackLost']){
  const h=harness({modelId:'blender-studio-v1',ackLost:mode==='ackLost',update:async body=>{if(mode==='load'&&body.body==='female')throw Error('Female reference unavailable');},save:async(payload,attempt)=>{if(mode==='save'&&attempt===2)throw Error('Save interrupted');}}),before=structuredClone(h.original);
  assert.equal(await h.change('female'),false,mode);assert.deepEqual(h.workspace.projects,[before],mode);assert.equal(h.workspace.activeProjectId,before.id);assert.deepEqual(h.persisted.at(-1).projects,[before]);assert.ok(h.updates.length>=2,mode+' restored preview');assert.equal(h.context.dirty,false);assert.equal(h.body.inert,false);assert.equal(h.context.ready,true);
 }
});

test('compatible anatomy changes keep the existing study and exact surface placements',async()=>{
 const h=harness({modelId:'makehuman-v1'}),before=structuredClone(h.original);assert.equal(await h.change('female'),true);if(h.context.renderTask)await h.context.renderTask;assert.equal(await h.context.flush(),true);
 assert.equal(h.workspace.projects.length,1);assert.equal(h.original.id,before.id);assert.equal(h.original.body.body,'female');assert.deepEqual(h.original.tattoos,before.tattoos);assert.deepEqual(h.original.selectedIds,before.selectedIds);assert.deepEqual(h.persisted.at(-1).projects,h.workspace.projects);
});

test('unsupported Blender anatomy selection never modifies or saves the original',async()=>{
 const h=harness({modelId:'blender-studio-v1'}),before=structuredClone(h.original);for(const anatomy of ['future',null,{},''])assert.equal(await h.change(anatomy),false);assert.deepEqual(h.workspace.projects,[before]);assert.deepEqual(h.writes,[]);assert.deepEqual(h.updates,[]);
});

test('queued anatomy and shape edits cannot change the source during comparison pre-save',async()=>{
 const entered=deferred(),gate=deferred(),h=harness({save:async(payload,attempt)=>{if(attempt===1){entered.resolve();await gate.promise;}}}),before=structuredClone(h.original);
 const comparing=h.compare('blender-studio-v1');await entered.promise;
 assert.equal(await h.change('female'),false);assert.equal(h.context.mutate(p=>p.body.mass=99),false);assert.deepEqual(h.original,before);
 gate.resolve();assert.equal(await comparing,true);assert.equal(h.workspace.projects.at(-1).body.body,'male');assert.deepEqual(h.original,before);
});


test('project switching holds body edits until the selected preview and camera finish',async()=>{
 const entered=deferred(),gate=deferred(),h=harness({update:async body=>{if(body.bodyModelId==='blender-studio-v1'){entered.resolve();await gate.promise;}}}),target=project('Other',{...BODY_DEFAULTS,bodyModelId:'blender-studio-v1'});
 h.workspace.projects.push(target);target.camera={position:[0,1,4],target:[0,1,0]};const before=structuredClone(target);
 const switching=h.context.switchProject(target.id);await entered.promise;
 assert.equal(h.body.inert,true);assert.equal(h.context.ready,false);assert.equal(h.context.convertingBody,true);
 assert.equal(await h.change('female'),false);assert.equal(await h.compare('atelier-v1'),false);assert.equal(h.context.mutate(p=>p.body.mass=99),false);assert.equal(await h.context.switchProject(h.original.id),false);assert.deepEqual(target,before);
 gate.resolve();assert.equal(await switching,true);assert.equal(h.workspace.activeProjectId,target.id);assert.equal(h.workspace.projects.length,2);assert.deepEqual(h.restored,[target.camera]);assert.equal(h.body.inert,false);assert.equal(h.context.ready,true);assert.equal(h.context.convertingBody,false);assert.equal(await h.context.flush(),true);
 assert.equal(h.persisted.at(-1).activeProjectId,target.id);assert.deepEqual(target,before);
});

test('failed project preview restores the previous study and releases body controls',async()=>{
 const h=harness({update:async body=>{if(body.bodyModelId==='blender-studio-v1')throw Error('Unavailable reference');}}),target=project('Other',{...BODY_DEFAULTS,bodyModelId:'blender-studio-v1'});h.workspace.projects.push(target);
 assert.equal(await h.context.switchProject(target.id),false);assert.equal(h.workspace.activeProjectId,h.original.id);assert.equal(h.body.inert,false);assert.equal(h.context.ready,true);assert.equal(h.context.convertingBody,false);assert.equal(h.context.dirty,true);assert.deepEqual(h.writes,[]);
});
