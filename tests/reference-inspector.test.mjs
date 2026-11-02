import test from 'node:test';
import assert from 'node:assert/strict';
let geometry;
try {geometry=await import('../studio/reference-inspection.js');} catch {}
const need = name => {assert.equal(typeof geometry?.[name],'function',`${name} is available`); return geometry[name];};

test('fit includes the entire PNG including a long caption without upscaling',()=>{
  const fit=need('referenceFitScale');
  assert.equal(fit({width:1200,height:3000},{width:600,height:500}),1/6);
  assert.equal(fit({width:200,height:100},{width:600,height:500}),1);
  assert.equal(fit({width:1200,height:3000},{width:0,height:0}),1);
});
test('zoom steps stay usable below ten percent and stop at the inspection limits',()=>{
  const step=need('referenceZoomStep');
  assert.equal(step(.03,1,.03),.1);
  assert.equal(step(.1,-1,.03),.03);
  assert.equal(step(.03,-1,.03),.03);
  assert.equal(step(1,1,.25),1.5);
  assert.equal(step(4,1,.25),4);
});
test('zoom retains the inspected center and keeps every edge reachable',()=>{
  const scroll=need('referenceZoomScroll');
  const image={width:1200,height:3000}, viewport={width:600,height:500};
  assert.deepEqual(scroll({left:300,top:1200},1,2,image,viewport),{left:900,top:2650});
  assert.deepEqual(scroll({left:0,top:0},.1,1,image,viewport),{left:300,top:1250});
  assert.deepEqual(scroll({left:600,top:2500},1,1/6,image,viewport),{left:0,top:0});
});
test('mouse panning updates native scroll and releases capture on cancellation and a second pointer',()=>{
  const create=need('createReferencePan'), released=[];
  const viewport={scrollLeft:100,scrollTop:200,setPointerCapture(id){this.captured=id;},hasPointerCapture(id){return this.captured===id;},releasePointerCapture(id){released.push(id);this.captured=null;}};
  const pan=create(viewport), pointer={pointerId:7,pointerType:'mouse',button:0,clientX:200,clientY:200,preventDefault(){}};
  assert.equal(pan.start(pointer),true);
  pan.move({...pointer,clientX:150,clientY:100});
  assert.deepEqual([viewport.scrollLeft,viewport.scrollTop],[150,300]);
  pan.end({pointerId:9});
  pan.move({...pointer,clientX:140,clientY:90});
  assert.equal(viewport.scrollTop,310,'unrelated pointer-up cannot end the active pan');
  pan.start({...pointer,pointerId:8});
  assert.deepEqual(released,[7]);
  pan.move({...pointer,clientY:10});
  assert.equal(viewport.scrollTop,310);
  assert.equal(pan.start({...pointer,pointerType:'touch'}),false,'touch uses native overflow scrolling');
  pan.start(pointer);pan.end();
  assert.deepEqual(released,[7,7],'blur and unmount can cancel without a pointer event');
});
