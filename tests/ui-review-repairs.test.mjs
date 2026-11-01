import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadJsx} from './helpers/load-jsx.mjs';
import * as layout from '../studio/viewport-layout.js';
import {BODY_DEFAULTS} from '../studio/model.js';
const primitives = await loadJsx(new URL('../studio/ui/primitives.jsx', import.meta.url));
const {CompositionPanel} = await loadJsx(new URL('../studio/ui/composition-panel.jsx', import.meta.url));
const {ArtworkPanel} = await loadJsx(new URL('../studio/ui/artwork-panel.jsx', import.meta.url));
const {BodyPanel} = await loadJsx(new URL('../studio/ui/body-panel.jsx', import.meta.url));
const {StudyCard, CameraDock} = await loadJsx(new URL('../studio/ui/main.jsx', import.meta.url));
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
function fixture() {
 const layers = ['upper outer', 'forearm outer', 'forearm inner', 'upper rear'].map((ending,index)=>({id:`l${index}`,name:`Long wrap design canonical name ${ending}`,assetId:'art',width:7+index,rotation:0,opacity:.9,visible:true,locked:false,region:'chest'}));
 const study={id:'study',name:'Study',body:{...BODY_DEFAULTS},tattoos:layers,selectedIds:['l0']};
 return {app:{actions:{}},snapshot:{study,workspace:{projects:[study],assets:[{id:'art',name:'Design',url:'/art.png'}]},selection:{canReanchor:true},runtimeCapabilities:{},ui:{blocked:false,placing:false,mappingWarnings:[],status:'Tap visible skin to anchor the selection.',panelState:'expanded',saveLabel:'Saved in this browser',storageMode:'browser',retry:{hidden:true},measurements:{waist:85},preview:{phase:'idle'},stats:{}}}};
}
test('one compact layout contract preserves short portrait and uses side panels in short landscape',()=>{
 assert.equal(typeof layout.isCompactLayout,'function');
 for(const [width,height,expected] of [[667,375,false],[700,375,false],[844,390,false],[390,480,true],[320,740,true],[390,844,true],[700,700,true],[701,900,false]])assert.equal(layout.isCompactLayout(width,height),expected,`${width}x${height}`);
 assert.equal(layout.resolvePresentation('?theme=instrument'),'instrument');
 assert.equal(layout.resolvePresentation('?theme=unknown'),'instrument');
});
test('numeric draft commits exactly one valid transaction and rejects blank, out of range and off step drafts',()=>{
 assert.equal(typeof primitives.commitNumericDraft,'function');
 const calls=[],options={min:.5,max:40,step:.1,value:7,onChange:v=>calls.push(['change',v]),onCommit:()=>calls.push(['commit'])};
 for(const draft of ['', ' ', '41', '18.15', 'NaN']){assert.equal(primitives.commitNumericDraft(draft,options).ok,false);assert.deepEqual(calls,[]);}
 assert.equal(primitives.commitNumericDraft('18.1',options).ok,true);assert.deepEqual(calls,[['change',18.1],['commit']]);
 calls.length=0;assert.deepEqual(primitives.commitNumericDraft('7.25',{...options,value:7.25}),{ok:true,value:7.25});assert.deepEqual(calls,[]);assert.equal(primitives.commitNumericDraft('7',options).ok,true);assert.deepEqual(calls,[]);
 assert.equal(primitives.commitNumericDraft('-5',{...options,min:-180,max:180,step:1}).ok,true);
 const html=render(primitives.RangeControl,{id:'width',label:'Width',value:7,min:.5,max:40,step:.1,onChange(){},onCommit(){}});
 assert.match(html,/type="number"[^>]*min="0.5"[^>]*max="40"[^>]*step="0.1"/);assert.match(html,/aria-label="Width exact value"/);assert.match(html,/type="range"/);
});
test('placement is labelled and group reference width explains the actual command capability',()=>{
 const props=fixture();props.snapshot.study.selectedIds=['l0','l1'];props.snapshot.selection.canReanchor=false;
 let html=render(CompositionPanel,props);
 assert.match(html,/Choose one tattoo to change its body area/);assert.match(html,/Reference width/);assert.match(html,/Long wrap design canonical name upper outer/);
 assert.match(/<button[^>]*id="place-on-body"[^>]*>/.exec(html)[0],/disabled/);
 assert.match(html,/>Place on body<\/span>/);
 props.snapshot.ui.placing=true;html=render(CompositionPanel,props);assert.match(html,/>Stop placing<\/span>/);
 assert.match(html,/Save alternative/);assert.match(html,/Your original study is kept/);
});
test('layer ordering is explicit touch and keyboard disclosure, preserving complete names',()=>{
 const html=render(CompositionPanel,{...fixture(),instrument:true});
 assert.equal((html.match(/class="layer-order"/g)||[]).length,4);
 assert.equal((html.match(/<summary[^>]*aria-label="Order Long wrap/g)||[]).length,4);
 for(const ending of ['upper outer','forearm outer','forearm inner','upper rear'])assert.ok(html.includes(`canonical name ${ending}`));
});
test('repeat import precedes library results while preparation and existing-tattoo options remain available',()=>{
 const props=fixture();
 for(const populated of [true,false]){
  if(!populated)props.snapshot.workspace.assets=[];
  props.snapshot.ui.importExisting=true;
  const html=render(ArtworkPanel,props);
  assert.ok(html.indexOf('id="upload-zone"')<html.indexOf('id="art-search"'));
  assert.ok(html.indexOf('id="import-existing"')<html.indexOf('id="artwork"'));
  assert.equal((html.match(/id="tattoo-upload"/g)||[]).length,1);
  assert.match(html,/Transparent PNG or WebP · up to 20 MB/);
  assert.match(html,/flat, cropped design with transparency/);
  assert.match(html,/skin photos need preparation outside tattoo you/);
  assert.match(html,/<input[^>]*id="import-existing"[^>]*checked=""/);
  assert.match(html,/Position and lock it to match the tattoo already on your skin/);
  if(populated)assert.match(html,/<details class="import-guidance"><summary>Formats and existing tattoos<\/summary>/);
  else assert.doesNotMatch(html,/<details class="import-guidance"/);
 }
});
test('storage scope is visible, current warnings persist and prepared guidance is explicitly scoped',()=>{
 const props=fixture();let html=render(StudyCard,props);assert.match(html,/class="storage-scope"[^>]*>This browser/);assert.match(html,/Backup or move device/);
 props.snapshot.ui.mappingWarnings=['Some image area has no continuous surface mapping.'];html=render(CompositionPanel,props);assert.match(html,/id="mapping-warnings"/);assert.match(html,/Reduce size or move the anchor/);
 props.snapshot.runtimeCapabilities={preparedComposition:{projectId:'study'}};html=render(BodyPanel,props);assert.match(html,/These designs were aligned to this body and existing tattoos/);assert.match(html,/Save an alternative before adjusting/);assert.match(html,/Approximate model measurements/);
 props.snapshot.study={...props.snapshot.study,id:'alternative'};html=render(BodyPanel,props);assert.doesNotMatch(html,/These designs were aligned/);
});
test('copied immutable warning and personal capabilities do not invalidate panels unless their visible values change',()=>{
 const props=fixture();props.snapshot.runtimeCapabilities={preparedComposition:{projectId:'study'}};
 const copy={...props,snapshot:{...props.snapshot,runtimeCapabilities:structuredClone(props.snapshot.runtimeCapabilities),ui:{...props.snapshot.ui,mappingWarnings:[]}}};
 assert.equal(CompositionPanel.compare(props,copy),true);assert.equal(BodyPanel.compare(props,copy),true);
 assert.equal(CompositionPanel.compare(props,{...copy,snapshot:{...copy.snapshot,ui:{...copy.snapshot.ui,mappingWarnings:['Seam']}}}),false);
 assert.equal(BodyPanel.compare(props,{...copy,snapshot:{...copy.snapshot,runtimeCapabilities:{preparedComposition:{projectId:'other'}}}}),false);
});
test('percentage exact entry uses the visible percent scale while retaining slider domain values',()=>{
 const props=fixture();props.snapshot.study.selectedIds=['l0'];
 const html=render(CompositionPanel,props);
 const number=/<input[^>]*id="opacity-number"[^>]*>/.exec(html)[0];
 assert.match(number,/min="10"/);assert.match(number,/max="100"/);assert.match(number,/step="1"/);assert.match(number,/value="90"/);
 const slider=/<input[^>]*id="opacity"[^>]*>/.exec(html)[0];assert.match(slider,/value="0.9"/);
});
test('placing has a persistent labelled stop action in the stage independent of collapsed inspector content',()=>{
 const props=fixture();props.snapshot.ui.placing=true;props.snapshot.ui.panelState='collapsed';
 const html=render(CameraDock,props);
 assert.match(html,/class="stage-bottom"[^>]*data-placing="true"/);
 assert.match(html,/Tap visible skin to place this tattoo\./);
 assert.match(html,/id="stage-stop-placing"[^>]*>Stop placing<\/button>/);
 assert.doesNotMatch(html,/id="tattoo-controls"/);
});
