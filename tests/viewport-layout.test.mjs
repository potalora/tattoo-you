import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {clearViewport,applyCameraViewport,observeViewportLayout,isCompactLayout,COMPACT_LAYOUT_QUERY,resolveTheme,resolvePresentation} from '../studio/viewport-layout.js';
import {cameraView} from '../studio/camera-framing.js';

const layouts=[
 {width:1280,height:720,header:{bottom:80},panel:{right:340,top:96},dock:{top:642},compact:false},
 {width:844,height:390,header:{bottom:76},panel:{right:340,top:88},dock:{top:312},compact:false},
 ...[506,782,236].map(top=>({width:390,height:844,header:{bottom:64},panel:{top},dock:top===236?null:{top:top-66},compact:true})),
 {width:320,height:568,header:{bottom:64},panel:{top:341},dock:{top:275},compact:true},
 {width:1440,height:900,header:{bottom:76},study:{right:272,bottom:380},panel:{left:1072,top:96},panelSide:'right',dock:{top:808},compact:false},
 {width:844,height:390,header:{bottom:76},study:{right:228,bottom:250},panel:{left:516,top:96},panelSide:'right',dock:{top:312},compact:false},
 {width:768,height:1024,header:{bottom:72},study:{right:436,bottom:144},studyOnTop:true,panel:{left:448,top:88},panelSide:'right',dock:{top:900},compact:false},
 ...[506,780,304].map(top=>({width:390,height:844,header:{bottom:64},study:{bottom:134},panel:{top},panelSide:'right',dock:{top:top-66},compact:true})),
];
function cameraFor(layout,name='front'){
 const camera=new THREE.PerspectiveCamera(34,1,.01,20),view=cameraView(name,{compact:layout.compact});
 camera.position.fromArray(view.position);camera.lookAt(...view.target);
 applyCameraViewport(camera,{...layout,clear:clearViewport(layout)});camera.updateMatrixWorld();return camera;
}
test('Front, Side and Back whole-body views clear floating chrome at desktop, short landscape and every sheet height',()=>{
 for(const layout of layouts)for(const name of ['front','side','back']){
  const clear=clearViewport(layout),camera=cameraFor(layout,name);
  for(const x of [-.45,.45])for(const y of [0,1.753])for(const z of [-.18,.18]){
   const p=new THREE.Vector3(x,y,z).project(camera),px=(p.x+1)*layout.width/2,py=(1-p.y)*layout.height/2;
   assert.ok(px>=clear.x&&px<=clear.x+clear.width,`${name} at ${layout.width}x${layout.height} stays beside panel: ${px}`);
   assert.ok(py>=clear.y&&py<=clear.y+clear.height,`${name} at ${layout.width}x${layout.height} clears header/dock: ${py}`);
  }
 }
});
test('desktop Orbit working view keeps head and knees clear while enlarging the subject within floating chrome',()=>{
 for(const layout of layouts.filter(layout=>!layout.compact)){
  const clear=clearViewport(layout),camera=cameraFor(layout,'body'),ys=[];
  for(const x of [-.45,.45])for(const y of [.55,1.753])for(const z of [-.18,.18]){
   const p=new THREE.Vector3(x,y,z).project(camera),px=(p.x+1)*layout.width/2,py=(1-p.y)*layout.height/2;
   assert.ok(px>=clear.x&&px<=clear.x+clear.width,`Orbit at ${layout.width}x${layout.height} keeps the upper body beside controls: ${px}`);
   assert.ok(py>=clear.y&&py<=clear.y+clear.height,`Orbit at ${layout.width}x${layout.height} keeps head and knees clear: ${py}`);
   ys.push(py);
  }
  if(clear.width/clear.height>=.58){
   assert.ok((Math.max(...ys)-Math.min(...ys))/clear.height>.7,'Orbit makes the head-to-knee working region materially prominent');
  }
 }
});
test('compact Orbit fills the phone with head-to-waist while preserving head and chest',()=>{
 for(const [width,height,panelTop,dockTop] of [[390,912,548,478],[390,844,506,436],[320,568,338,268]]){
 const layout={width,height,header:{bottom:66},panel:{top:panelTop},panelSide:'right',dock:{top:dockTop},compact:true};
 const clear=clearViewport(layout),camera=cameraFor(layout,'body');
 const project=(x,y,z)=>{const p=new THREE.Vector3(x,y,z).project(camera);return {x:(p.x+1)*width/2,y:(1-p.y)*height/2};};
 for(const [x,y,z] of [[-.10,1.753,.12],[.10,1.753,.12],[-.30,1.4,.12],[.30,1.4,.12],[-.18,1.2,.12],[.18,1.2,.12]]){
  const point=project(x,y,z);
  assert.ok(point.x>=clear.x&&point.x<=clear.x+clear.width,`${width}x${height}: head and chest stay beside controls`);
  assert.ok(point.y>=clear.y&&point.y<=clear.y+clear.height,`${width}x${height}: head and chest remain above the camera dock`);
 }
 const head=project(0,1.753,.12),waist=project(0,1.15,.12),knee=project(0,.55,.12);
 assert.ok(waist.y-head.y>clear.height*.75,`${width}x${height}: head-to-waist fills most of the working region`);
 assert.ok(waist.y>=clear.y+clear.height*.8,`${width}x${height}: waist approaches the dock rather than fitting the groin above it`);
 assert.ok(knee.y>layout.panel.top,`${width}x${height}: lower body may continue behind translucent controls`);
 }
});
test('off-axis projection keeps target centered in clear area and ray picking agrees',()=>{
 for(const layout of layouts){
  const camera=cameraFor(layout),target=new THREE.Vector3(...cameraView('front').target),point=target.clone().project(camera),clear=clearViewport(layout);
  assert.ok(Math.abs((point.x+1)*layout.width/2-(clear.x+clear.width/2))<1e-8);
  assert.ok(Math.abs((1-point.y)*layout.height/2-(clear.y+clear.height/2))<1e-8);
  const raycaster=new THREE.Raycaster();raycaster.setFromCamera(new THREE.Vector2(point.x,point.y),camera);
  assert.ok(raycaster.ray.distanceToPoint(target)<1e-8,'screen picking uses the same projection');
 }
});
test('sheet changes affect projection without rewriting saved camera position or orientation',()=>{
 const camera=cameraFor(layouts[2]),before=camera.matrixWorld.toArray(),initial=camera.projectionMatrix.toArray();
 applyCameraViewport(camera,{...layouts[4],clear:clearViewport(layouts[4])});camera.updateMatrixWorld();
 assert.deepEqual(camera.matrixWorld.toArray(),before);assert.notDeepEqual(camera.projectionMatrix.toArray(),initial);
 assert.ok(Object.values(clearViewport({width:1,height:1,compact:true,header:{bottom:90},panel:{top:0}})).every(Number.isFinite));
});
test('study card and right inspector bound the working area without reserving the whole card height',()=>{
 const clear=clearViewport({width:1440,height:900,header:{bottom:76},study:{right:272,bottom:380},panel:{left:1072,top:96},panelSide:'right',dock:{top:808}});
 assert.deepEqual(clear,{x:296,y:92,width:752,height:700});
 const compact=clearViewport({width:390,height:844,header:{bottom:64},study:{bottom:134},panel:{top:506},panelSide:'right',dock:{top:440},compact:true});
 assert.deepEqual(compact,{x:10,y:144,width:370,height:286},'phone study rail reserves top space above the body');
});

function observedLayout(t,{width=1280,height=720,compact=false}={}){
 const observers={resized:[],mutated:[]};
 const globals={
  window:{matchMedia:()=>({matches:compact})},
  getComputedStyle:element=>({position:element.position||'static',getPropertyValue:name=>name==='--study-rail'&&element.studyRail?'1':''}),
  ResizeObserver:class{constructor(callback){this.callback=callback;this.targets=[];observers.resized.push(this);}observe(element){this.targets.push(element);}disconnect(){this.disconnected=true;}},
  MutationObserver:class{constructor(callback){this.callback=callback;this.targets=[];observers.mutated.push(this);}observe(element,options){this.targets.push({element,options});}disconnect(){this.disconnected=true;}},
 };
 for(const [name,value] of Object.entries(globals)){
  const before=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  t.after(()=>{if(before)Object.defineProperty(globalThis,name,before);else delete globalThis[name];});
 }
 // Nonzero host origin catches accidental mixing of page and canvas coordinates.
 const element=(top,bottom,right=width,left=0)=>({top,bottom,right,left,visible:true,dataset:{},getClientRects(){return this.visible?[{}]:[];},getBoundingClientRect(){return {top:this.top+100,bottom:this.bottom+100,right:this.right+50,left:this.left+50};}});
 const host={clientWidth:width,clientHeight:height,getBoundingClientRect:()=>({top:100,left:50})};
 return {observers,element,host};
}
test('observed desktop and mobile layouts reserve status plus the entire controls group',async t=>{
 for(const compact of [false,true])await t.test(compact?'mobile sheet':'desktop',t=>{
  const fixture=observedLayout(t,compact?{width:390,height:844,compact}:{}),{element,host,observers}=fixture;
  const header=element(0,compact?64:80),panel=element(compact?506:96,700,340);
  const dockTop=compact?440:642,dock=element(dockTop,dockTop+44),dockGroup=element(dockTop,dockTop+60);
  let changes=0;
  const layout=observeViewportLayout({root:{},host,header,panel,dock,dockGroup,onChange:()=>{changes++;}});
  assert.ok(observers.resized[0].targets.includes(dockGroup),'status changes resize the observed group');
  assert.equal(layout.measure().y+layout.measure().height,dockTop-(compact?10:16));
  dockGroup.top-=84; // Import/export status appears above the unchanged toolbar.
  observers.resized[0].callback([{target:dockGroup}]);
  assert.equal(changes,1);
  const clear=layout.measure();
  assert.equal(clear.y+clear.height,dockGroup.top-(compact?10:16),'the body clears the status, not only the toolbar');
  const camera=cameraFor({width:host.clientWidth,height:host.clientHeight,compact,header:{bottom:header.bottom},panel:{top:panel.top,right:panel.right},dock:{top:dockGroup.top}});
  const feet=new THREE.Vector3(0,0,0).project(camera),feetY=(1-feet.y)*host.clientHeight/2;
  assert.ok(feetY<=clear.y+clear.height,'whole-body framing leaves feet above visible status');
  layout.dispose();
  assert.ok(observers.resized[0].disconnected&&observers.mutated[0].disconnected);
 });
});
test('short landscape fixed status extends the top boundary without moving the dock boundary',t=>{
 const {element,host,observers}=observedLayout(t,{width:844,height:390});
 const header=element(0,76),panel=element(88,370,340),dock=element(312,356),dockGroup=element(312,356);
 const status=element(84,144);status.position='fixed';
 const layout=observeViewportLayout({root:{},host,header,panel,dock,dockGroup,status,onChange:()=>{}});
 const clear=layout.measure();
 assert.equal(clear.y,160,'fixed toast lower edge becomes the top clear boundary');
 assert.equal(clear.y+clear.height,296,'out-of-flow status does not alter the dock boundary');
 assert.ok(observers.resized[0].targets.includes(status),'fixed status height changes are observed');
 assert.ok(observers.mutated[0].targets.some(target=>target.element===status&&target.options.attributeFilter.includes('data-idle')),'idle visibility changes trigger remeasurement');
 const camera=new THREE.PerspectiveCamera(34,1,.01,20),view=cameraView('front');
 camera.position.fromArray(view.position);camera.lookAt(...view.target);
 applyCameraViewport(camera,{width:844,height:390,clear});camera.updateMatrixWorld();
 for(const y of [0,1.753]){
  const point=new THREE.Vector3(0,y,0).project(camera),screenY=(1-point.y)*390/2;
  assert.ok(screenY>=clear.y&&screenY<=clear.y+clear.height,'head and feet stay between the fixed status and dock');
 }
 status.dataset.idle='true';
 assert.equal(layout.measure().y,92,'visually clipped idle announcement does not reserve space');
 status.dataset.idle='false';status.visible=false;
 assert.equal(layout.measure().y,92,'hidden status does not reserve space');
 layout.dispose();
});
test('layout observers retain toolbar-only fallback when no visible controls group is supplied',t=>{
 const {element,host}=observedLayout(t),dock=element(642,686),dockGroup=element(558,702);dockGroup.visible=false;
 const layout=observeViewportLayout({root:{},host,header:element(0,80),panel:element(96,700,340),dock,dockGroup,onChange:()=>{}});
 assert.equal(layout.measure().y+layout.measure().height,626);
 layout.dispose();
});
test('framed stage follows the full dock height as feedback wraps and clears it on disposal',t=>{
 const {element,host}=observedLayout(t),values=new Map();
 const root={style:{setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key)}};
 const dockGroup=element(600,688),dock=element(632,686);
 const layout=observeViewportLayout({root,host,header:element(0,80),panel:element(96,700,340),dock,dockGroup,onChange(){}});
 layout.measure();assert.equal(values.get('--dock-live-height'),'88px');
 dockGroup.top=564;layout.measure();assert.equal(values.get('--dock-live-height'),'124px','wrapped feedback expands the frame reservation');
 dockGroup.visible=false;layout.measure();assert.equal(values.get('--dock-live-height'),'54px','toolbar fallback uses its visible height');
 dock.visible=false;layout.measure();assert.equal(values.get('--dock-live-height'),'0px','hidden controls leave no reservation');
 layout.dispose();assert.equal(values.has('--dock-live-height'),false);
});
test('layout observes both studio surfaces and follows mobile rail and sheet changes',async t=>{
 for(const compact of [false,true])await t.test(compact?'mobile rail':'desktop study',t=>{
  const {element,host,observers}=observedLayout(t,{width:compact?390:1440,height:compact?844:900,compact});
  const header=element(20,76),study=element(96,compact?152:380,272,20),panel=element(compact?506:96,824,1420,1072),dock=element(compact?440:808,860);
  panel.dataset.panelSide='right';
  const layout=observeViewportLayout({root:{},host,header,study,panel,dock,onChange:()=>{}}),clear=layout.measure();
  assert.ok(observers.resized[0].targets.includes(study),'study size changes reframe the body');
  assert.ok(observers.mutated[0].targets.some(target=>target.element===study),'hidden study changes are observed');
  if(compact){assert.equal(clear.y,162);study.bottom=134;assert.equal(layout.measure().y,144);}
  else {assert.equal(clear.x,296);assert.equal(clear.x+clear.width,1048);study.right=300;assert.equal(layout.measure().x,324);}
  study.visible=false;
  assert.equal(layout.measure()[compact?'y':'x'],compact?86:20,'a hidden study card does not consume stage area');
  layout.dispose();
 });
});
test('portrait tablet study rail reserves the stage top while the inspector stays on the right',t=>{
 const {element,host}=observedLayout(t,{width:768,height:1024});
 const header=element(12,72),study=element(88,144,436,12),panel=element(88,1000,756,448),dock=element(900,1000);
 study.studyRail=true;panel.dataset.panelSide='right';
 const layout=observeViewportLayout({root:{},host,header,study,panel,dock,onChange:()=>{}});
 assert.deepEqual(layout.measure(),{x:20,y:160,width:404,height:724});
 // Rotation to landscape restores the same element's side-card exclusion.
 study.studyRail=false;study.right=220;study.bottom=385;
 assert.equal(layout.measure().x,244);assert.equal(layout.measure().y,88);
 layout.dispose();
});
test('absolute actionable status reserves its visible region above a short landscape camera tray',t=>{
 const {element,host}=observedLayout(t,{width:667,height:375});
 const header=element(-60,-10),panel=element(0,305,667,367),dockGroup=element(250,300),status=element(210,250);
 status.position='absolute';status.dataset.idle='false';panel.dataset.panelSide='right';
 const layout=observeViewportLayout({root:{},host,header,panel,dockGroup,status,onChange(){}});
 assert.equal(layout.measure().y+layout.measure().height,194,'actionable status must bound body, not only camera group');
 status.dataset.idle='true';assert.equal(layout.measure().y+layout.measure().height,234);
 layout.dispose();
});

test('compact media contract preserves short portrait and uses side inspectors for short landscape',()=>{
 for(const [width,height,compact] of [[667,375,false],[700,375,false],[844,390,false],[390,480,true],[390,844,true],[320,740,true],[700,700,true],[701,900,false]])assert.equal(isCompactLayout(width,height),compact,`${width}x${height}`);
 assert.match(COMPACT_LAYOUT_QUERY,/orientation: portrait/);
 for(const theme of ['glass','precision','gallery','soft','instrument']) {
  assert.equal(resolveTheme(`?theme=${theme}`),theme);
  assert.equal(resolvePresentation(`?theme=${theme}`),theme==='instrument'?'instrument':'glass');
 }
 assert.equal(resolveTheme('?theme=invalid'),'instrument');
});
