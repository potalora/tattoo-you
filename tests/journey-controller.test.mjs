import {test} from 'node:test';
import assert from 'node:assert/strict';
import {project,addTattoo,MAX_TATTOOS,copy,uid} from '../studio/model.js';
import {createApplication} from '../studio/application.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

async function harness(t,{existing=false,full=false,save=async()=>{}}={}){
  const p=project('Original'),asset={id:'library',name:'Heart'};
  const workspace={revision:0,assets:[asset],projects:[p],activeProjectId:p.id};
  if(full)for(let i=0;i<MAX_TATTOOS;i++)addTattoo(p,asset);
  const messages=[],panels=[],focus=[],writes=[],timers=new Map(),body={inert:false};
  let timerId=0;
  const engine={update:async()=>{},view(){},getCamera:()=>({position:[1,2,3],target:[0,1,0]}),restoreCamera(){},setQuality(){},setPlaceMode(){},dispose(){}};
  const app=createApplication({
    createStudio:async()=>engine,
    observeLayout:()=>({measure:()=>null,dispose(){}}),
    browser:{location:{search:''},document:{body},confirm:()=>true},
    clock:{setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}},
    fileServices:{raster:async file=>{
      if(file.bad)throw Error('Use transparent artwork');
      return {dataUrl:'data:image/png',width:10,height:10};
    }},
    api:async(path,method,payload)=>{
      if(path==='assets')return {id:uid(),...payload};
      assert.equal(path,'workspace');
      if(method!=='PUT')return workspace;
      writes.push(copy(payload));await save(payload,writes.length);
      return {revision:payload.revision+1};
    },
  });
  let priorStatus,priorFocus=0;
  app.subscribe(()=>{
    const {ui}=app.getSnapshot();
    if(ui.status!==priorStatus){messages.push(ui.status);priorStatus=ui.status;}
    panels.push(ui.surface);
    if(ui.focusPlacement>priorFocus){focus.push('region');priorFocus=ui.focusPlacement;}
  });
  t.after(()=>app.dispose());
  app.attachViewport({},{});
  for(let attempt=0;!app.getSnapshot().ui.ready&&attempt<20;attempt++)await tick();
  assert.equal(app.getSnapshot().ui.ready,true,app.getSnapshot().ui.error);
  app.actions.setImportExisting(existing);
  messages.length=0;panels.length=0;focus.length=0;
  return {app,p,asset,workspace,messages,panels,focus,writes,body};
}

function saveAlternative(h){
  const saving=h.app.actions.saveAlternative();
  assert.ok(h.app.getSnapshot().ui.nameRequest,'the actual application asks for a name');
  h.app.actions.resolveName('Arm alternative');
  return saving;
}

test('imported ideas and existing representations are selected and editable without changing saved locks',async t=>{
  for(const existing of [false,true]){
    const h=await harness(t,{existing}),old=addTattoo(h.p,h.asset,true);
    await h.app.actions.uploadFiles([{name:'Rose.png'}]);
    assert.equal(h.p.tattoos.length,2);const added=h.p.tattoos.at(-1);
    assert.equal(added.existing,existing);assert.equal(added.locked,false);assert.equal(old.locked,true);
    assert.deepEqual(h.p.selectedIds,[added.id]);assert.equal(h.panels.at(-1),'composition');
  }
});

test('partial import continues after a failed file, retains successes and reports the failed filename',async t=>{
  const h=await harness(t);
  await h.app.actions.uploadFiles([{name:'Rose.png'},{name:'Skin-photo.png',bad:true},{name:'Moon.png'}]);
  assert.equal(h.p.tattoos.length,2);assert.equal(h.workspace.assets.length,3);
  assert.match(h.messages.at(-1),/2/);assert.match(h.messages.at(-1),/Skin-photo.png/);assert.match(h.messages.at(-1),/transparent/);
  assert.equal(h.body.inert,false);
  // ArtworkPanel owns clearing the native file input after this action settles.
  // The former #tattoo-upload.value assertion belongs to the upload UI smoke check.
});

test('a full study keeps successfully imported artwork in the library without reporting it placed',async t=>{
  const h=await harness(t,{full:true}),before=copy(h.p);
  await h.app.actions.uploadFiles([{name:'Rose.png'}]);
  assert.deepEqual(h.p,before);assert.equal(h.workspace.assets.length,2);
  assert.match(h.messages.at(-1),/library|Artwork/);assert.match(h.messages.at(-1),/16|full/);
});

test('library add stays an editable idea after an existing-tattoo import',async t=>{
  const h=await harness(t,{existing:true});
  assert.equal(h.app.actions.addArtwork(h.asset.id),true);
  assert.equal(h.p.tattoos[0].existing,false);assert.equal(h.p.tattoos[0].locked,false);
});

test('save alternative waits for the source save and new copy save before claiming success',async t=>{
  const gate=deferred();const h=await harness(t,{save:async(payload,attempt)=>{if(attempt===1)await gate.promise;}});
  const saving=saveAlternative(h);await tick();
  assert.equal(h.workspace.projects.length,1);assert.ok(!h.messages.some(message=>/Alternative saved/.test(message)));
  gate.resolve();assert.equal(await saving,true);
  assert.equal(h.writes.length,2);assert.equal(h.workspace.projects.length,2);
  assert.equal(h.workspace.projects[1].name,'Arm alternative');assert.equal(h.workspace.activeProjectId,h.workspace.projects[1].id);
  assert.equal(h.workspace.projects[0].name,'Original');assert.match(h.messages.at(-1),/Alternative saved/);assert.equal(h.body.inert,false);
});

test('save alternative source failure creates no copy; copy failure stays open and explicitly unsaved',async t=>{
  for(const failAt of [1,2]){
    const h=await harness(t,{save:async(payload,attempt)=>{if(attempt===failAt)throw Error('Save unavailable');}});
    assert.equal(await saveAlternative(h),false);
    assert.equal(h.workspace.projects.length,failAt===1?1:2);
    assert.ok(!h.messages.some(message=>/Alternative saved/.test(message)));
    assert.match(h.messages.at(-1),failAt===1?/save|conflict/i:/not saved|unsaved/i);assert.equal(h.body.inert,false);
  }
});

test('successful import transfers keyboard focus to placement; failed or full imports preserve focus',async t=>{
  for(const scenario of ['success','invalid','full']){
    const h=await harness(t,{full:scenario==='full'});
    await h.app.actions.uploadFiles([{name:'Rose.png',bad:scenario==='invalid'}]);
    assert.deepEqual(h.focus,scenario==='success'?['region']:[]);
  }
});

test('library additions focus placement only after an actual successful add',async t=>{
  for(const full of [false,true]){
    const h=await harness(t,{full});
    assert.equal(h.app.actions.addArtwork(h.asset.id),!full);
    assert.deepEqual(h.focus,full?[]:['region']);
    if(full){
      assert.match(h.messages.at(-1),/hold 16 tattoos/);
      assert.ok(!h.messages.some(message=>message.startsWith('Added to study')));
    }
  }
});

test('typed notes reach original and alternative before blur or change and survive rendering',async t=>{
  const h=await harness(t),expected='Compare the left forearm with the upper arm. Ask my artist about the final size and spacing.';
  h.app.actions.setNotes(expected);
  assert.equal(h.p.notes,expected);assert.equal(h.app.getSnapshot().study.notes,expected);
  // No endGesture/blur occurs before the comparison command consumes the notes.
  assert.equal(await saveAlternative(h),true);
  assert.equal(h.p.notes,expected);assert.equal(h.workspace.projects[1].notes,expected);assert.equal(h.app.getSnapshot().study.notes,expected);
});
