import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../studio/application.js';
import {project} from '../studio/model.js';
import {sheetDragHeight,sheetSnapState} from '../studio/ui/sheet-gesture.js';
import {loadJsx} from './helpers/load-jsx.mjs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const {createMediaQueryStore}=await loadJsx(new URL('../studio/ui/motion.jsx',import.meta.url));
const {Inspector}=await loadJsx(new URL('../studio/ui/main.jsx',import.meta.url));

test('sheet drag follows the pointer immediately, clamps its bounds and snaps in the drag direction',()=>{
 const stops={collapsed:70,normal:330,expanded:540};
 for(const [offset,height,state] of [[-140,470,'expanded'],[160,170,'collapsed'],[15,315,'normal'],[-900,540,'expanded'],[900,70,'collapsed']]){
  const current=sheetDragHeight(330,offset,stops);assert.equal(current,height);assert.equal(sheetSnapState(current,0,stops),state);
 }
 assert.equal(sheetSnapState(340,-900,stops),'expanded','upward fling expands');
 assert.equal(sheetSnapState(340,900,stops),'collapsed','downward fling collapses');
 assert.equal(sheetSnapState(330,NaN,stops),'normal','missing release velocity does not fling');
});

test('the live preference store follows OS changes and releases its shared listener',()=>{
 const media=new EventTarget();media.matches=false;let adds=0,removes=0;
 const add=media.addEventListener.bind(media),remove=media.removeEventListener.bind(media);
 media.addEventListener=(...args)=>{adds++;add(...args);};media.removeEventListener=(...args)=>{removes++;remove(...args);};
 const store=createMediaQueryStore('(prefers-reduced-motion: reduce)',()=>media);let notifications=0;
 const a=store.subscribe(()=>notifications++),b=store.subscribe(()=>notifications++);
 assert.equal(adds,1);assert.equal(store.getSnapshot(),false);
 media.matches=true;media.dispatchEvent(new Event('change'));assert.equal(store.getSnapshot(),true);assert.equal(notifications,2);
 a();media.matches=false;media.dispatchEvent(new Event('change'));assert.equal(store.getSnapshot(),false);assert.equal(notifications,3);
 b();assert.equal(removes,1);media.dispatchEvent(new Event('change'));assert.equal(notifications,3);
});

test('explicit sheet state accepts only finite panel states without changing the study or history',async t=>{
 const study=project('Gesture study'),workspace={revision:0,projects:[study],activeProjectId:study.id,assets:[]};
 const app=createApplication({api:async()=>structuredClone(workspace),browser:{location:{search:''}}});t.after(()=>app.dispose());
 await app.initialize();const before=app.getSnapshot();
 assert.equal(typeof app.actions.setPanelState,'function','a drag can select a state without cycling through unrelated states');
 for(const state of ['expanded','collapsed','normal']){
  assert.equal(app.actions.setPanelState(state),true);const current=app.getSnapshot();
  assert.equal(current.ui.panelState,state);assert.equal(current.study,before.study);assert.equal(current.workspace,before.workspace);
  assert.equal(current.ui.canUndo,before.ui.canUndo);assert.equal(current.ui.canRedo,before.ui.canRedo);
 }
 const unchanged=app.getSnapshot();
 for(const state of ['open','',null,undefined,0,{},['expanded']])assert.equal(app.actions.setPanelState(state),false);
 assert.equal(app.getSnapshot(),unchanged,'invalid gesture states do not publish or mutate state');
 app.actions.togglePanel();assert.equal(app.getSnapshot().ui.panelState,'expanded','the accessible button retains its existing cycle');
});

test('inspector surfaces stay mounted and the accessible sheet button remains available in every state',async t=>{
 const study=project('Mounted surfaces'),workspace={revision:0,projects:[study],activeProjectId:study.id,assets:[]};
 const app=createApplication({api:async()=>structuredClone(workspace),browser:{location:{search:''}}});t.after(()=>app.dispose());await app.initialize();
 for(const surface of ['body','artwork','composition']){
  app.actions.showSurface(surface);
  for(const state of ['collapsed','normal','expanded']){
   app.actions.setPanelState(state);
   const html=renderToStaticMarkup(React.createElement(Inspector,{app,snapshot:app.getSnapshot(),panelRef:{current:null}}));
   for(const name of ['composition','artwork','body'])assert.ok(html.includes(`data-surface-content="${name}"`),'inactive content is retained');
   const wrappers=[...html.matchAll(/<div\b[^>]*class="react-surface"[^>]*>/g)].map(([tag])=>tag);
   assert.equal(wrappers.length,3);assert.equal(wrappers.filter(tag=>!tag.includes('hidden=""')).length,1);
   assert.match(html,new RegExp(`id="controls-toggle"[^>]*aria-label="[^"]+ panel"[^>]*aria-expanded="${state!=='collapsed'}"`));
   assert.match(html,/<div class="sheet-drag-handle" aria-hidden="true">/,'drag interaction has no extra keyboard stop');
  }
 }
});

test('placing disables the inspector expansion control while retaining the visible stage exit',async t=>{
 const study=project('Placing'),workspace={revision:0,projects:[study],activeProjectId:study.id,assets:[]};
 const app=createApplication({api:async()=>structuredClone(workspace),browser:{location:{search:''}}});t.after(()=>app.dispose());await app.initialize();
 const snapshot=app.getSnapshot();
 const html=renderToStaticMarkup(React.createElement(Inspector,{app,snapshot:{...snapshot,ui:{...snapshot.ui,blocked:false,placing:true,panelState:'collapsed'}},panelRef:{current:null}}));
 const control=/<button[^>]*id="controls-toggle"[^>]*>/.exec(html)[0];assert.match(control,/\sdisabled(?:=""|(?=[\s>]))/);
});
