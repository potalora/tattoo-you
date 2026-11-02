import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../studio/application.js';
import {project} from '../studio/model.js';
const tick = () => new Promise(resolve => setImmediate(resolve));

async function reviewHarness(t) {
  const study = project('Artist discussion'), downloads = [], encoded = [];
  const workspace = {revision:0, projects:[study], activeProjectId:study.id, assets:[]};
  const browser = {
    location:{search:''},
    Image: class {width=1000; height=800; async decode() {}},
    FileReader: class {async readAsDataURL(blob) {this.result='data:image/png;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64'); this.onload();}},
    document:{body:{inert:false}, createElement() {return {
      getContext:()=>({measureText:text=>({width:text.length*6}), fillRect(){}, drawImage(){}, fillText(){}}),
      toBlob(callback,type) {const blob=new Blob(['unchanged reference bytes'],{type}); encoded.push(blob); callback(blob);},
    };}},
  };
  const studio={update:async()=>{}, setQuality(){}, view(){}, setPlaceMode(){}, getMappingWarnings:()=>[], snapshot:async()=>'', dispose(){}};
  const app=createApplication({browser,api:async()=>workspace,createStudio:async()=>studio,
    observeLayout:()=>({measure:()=>null,dispose(){}}),
    fileServices:{browser,download:(name,blob)=>downloads.push({name,blob})},
  });
  t.after(()=>app.dispose()); app.attachViewport({},{});
  for(let n=0;n<30&&!app.getSnapshot().ui.ready;n++)await tick();
  assert.equal(app.getSnapshot().ui.ready,true);
  assert.equal(await app.actions.reviewReference(),true, app.getSnapshot().ui.reviewError);
  return {app,downloads,encoded};
}

test('download feedback survives cloned review snapshots and unrelated UI publications',async t=>{
  const h=await reviewHarness(t), before=h.app.getSnapshot().ui.reference;
  assert.equal(h.app.actions.downloadReference(),true);
  assert.equal(h.app.getSnapshot().ui.referenceDownloaded,true);
  h.app.actions.setStoragePersistence(true);
  assert.notEqual(h.app.getSnapshot().ui.reference,before,'application publishes copied reference metadata');
  assert.equal(h.app.getSnapshot().ui.referenceDownloaded,true);
  assert.equal(h.downloads[0].blob,h.encoded[0],'download keeps the original encoded blob');
  assert.equal(await h.downloads[0].blob.text(),'unchanged reference bytes');
});

test('closing and preparing a new reference resets feedback even when the PNG bytes match',async t=>{
  const h=await reviewHarness(t);
  h.app.actions.downloadReference();
  assert.equal(h.app.getSnapshot().ui.referenceDownloaded,true);
  h.app.actions.closeDialog();
  assert.equal(h.app.getSnapshot().ui.referenceDownloaded,false);
  assert.equal(h.app.actions.downloadReference(),false);
  assert.equal(await h.app.actions.reviewReference(),true);
  assert.equal(h.app.getSnapshot().ui.referenceDownloaded,false);
});

test('review announces download feedback inside its persistent actions and keeps the encoded preview',async()=>{
  const React=await import('react'), {renderToStaticMarkup}=await import('react-dom/server');
  const {loadJsx}=await import('./helpers/load-jsx.mjs');
  let component;
  try {component=await loadJsx(new URL('../studio/ui/reference-inspector.jsx',import.meta.url));} catch {}
  assert.equal(typeof component?.ReferenceReview,'function','reference review is renderable');
  const reference={width:1000,height:1800,dataUrl:'data:image/png;base64,original',studyName:'A study',view:'left'};
  const html=renderToStaticMarkup(React.createElement(component.ReferenceReview,{reference,downloaded:true,actions:{}}));
  assert.match(html,/<img[^>]*id="reference-preview"[^>]*src="data:image\/png;base64,original"/);
  assert.match(html,/<p[^>]*role="status"[^>]*>PNG download started\.<\/p>/);
  assert.match(html,/Inspect full size/);
  assert.match(html,/id="download-reference"/);
  assert.match(html,/id="reference-back"/);
});
