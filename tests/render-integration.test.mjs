import {createPreviewOrchestrator} from '../studio/preview-orchestrator.js';
import {disposeStudioResources} from '../studio/renderer-lifecycle.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from '../studio/vendor/three.core.js';
import * as GPU from 'three/webgpu';
import * as TSL from 'three/tsl';
import {BODY_DEFAULTS} from '../studio/model.js';
import {resolveBodyModel,LEGACY_MODEL_ID} from '../studio/model-catalog.js';
import {skinColor as resolveSkinColor} from '../studio/skin-tones.js';
import {buildSurfacePatch} from '../studio/surface-map.js';
import {createRenderScheduler} from '../studio/render-scheduler.js';
import {createAdaptiveQuality,choosePixelRatio} from '../studio/render-quality.js';
import {applyCameraViewport,COMPACT_LAYOUT_QUERY} from '../studio/viewport-layout.js';
import {cameraView} from '../studio/camera-framing.js';
import {createCameraMotion} from '../studio/camera-motion.js';
import {handleCameraKey} from '../studio/camera-keyboard.js';
import {constrainCameraToFloor,restoreCameraPose,stopCameraMotion} from '../studio/camera-floor.js';
const cameraFloorBindings={COMPACT_LAYOUT_QUERY,constrainCameraToFloor,restoreCameraPose,stopCameraMotion,floorCollision:false};
import {AnalyticLightNode,DirectionalLight} from 'three/webgpu';
import NodeFrame from 'three/src/nodes/core/NodeFrame.js';
import HemisphereLightNode from 'three/src/nodes/lighting/HemisphereLightNode.js';
const RENDER_FIXTURE_MODEL_ID='atelier-v1';
const source=await readFile(new URL('../studio/scene.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function sceneFunction(name,async=false){const start=source.indexOf(`${async?'async ':''}function ${name}(`);assert.ok(start>=0);const ends=[source.indexOf('\n function ',start+1),source.indexOf('\n async function ',start+1),source.indexOf('\n const ',start+1),source.indexOf('\nexport async function ',start+1)].filter(end=>end>start);return source.slice(start,Math.min(...ends));}
function resizeHarness(){
 const applied=[],context=vm.createContext({COMPACT_LAYOUT_QUERY,host:{clientWidth:390,clientHeight:844,dataset:{}},options:{getClearViewport:()=>context.clear},clear:{x:10,y:74,width:370,height:356},window:{matchMedia:()=>({matches:true})},devicePixelRatio:1,quality:'auto',adaptive:createAdaptiveQuality(),choosePixelRatio,applyCameraViewport,camera:new THREE.PerspectiveCamera(34,1,.01,20),captureRegion:null,layoutSignature:'',resizeSequence:0,disposed:false,inkTask:null,cancellations:0,requests:0,cancelPreview(){context.cancellations++;return context.cancelGate;},renderer:{setPixelRatio(){},setSize(width,height){applied.push({width,height,clear:{...context.clear}});}},requestRender(){context.requests++;}});
 vm.runInContext(sceneFunction('resize',true),context);return {context,applied};
}
test('returning to the applied layout invalidates a resize awaiting preview cancellation',async()=>{
 const h=resizeHarness();await h.context.resize();
 const initialProjection=h.context.camera.projectionMatrix.toArray(),initialClear=h.context.clear,gate=deferred();
 h.context.cancelGate=gate.promise;h.context.clear={x:10,y:74,width:370,height:152};
 const obsolete=h.context.resize();await tick();
 h.context.clear=initialClear;const latest=h.context.resize();
 gate.resolve();await Promise.all([obsolete,latest]);
 assert.deepEqual(h.context.camera.projectionMatrix.toArray(),initialProjection,'an obsolete sheet height must not replace the latest projection');
 assert.deepEqual(JSON.parse(h.context.host.dataset.clearViewport),initialClear);
});
test('identical settled layout leaves an active preview and idle rendering untouched',async()=>{
 const h=resizeHarness();await h.context.resize();const cancellations=h.context.cancellations,requests=h.context.requests;
 await h.context.resize();await h.context.resize();
 assert.equal(h.context.cancellations,cancellations,'duplicate observer notifications must not cancel a preview');
 assert.equal(h.context.requests,requests,'duplicate observer notifications must not schedule frames');
 assert.equal(h.applied.length,1);
});
function installPreview(context){
 const controller=createPreviewOrchestrator({
  preview:context.preview,isDisposed:()=>context.disposed,
  finishCamera:()=>context.cameraMotion?.finish(),getInkTask:()=>context.inkTask,scheduler:context.scheduler,
  createPreview:context.createPreview,
  getTraceInput(){context.gallery?.updateView?.(context.camera,context.controls?.target);return {scene:context.scene,camera:context.camera,bodyMesh:context.active.mesh,albedoMaterial:context.albedoSkin,roughnessMaterial:context.roughnessSkin,decals:[],environment:context.gallery?.raw};},
  onPreview:status=>context.options?.onPreview?.(status),onError:error=>context.console?.error(error),capture:()=>context.renderer.domElement.toDataURL('image/png'),
 });
 for(const [name,key] of Object.entries({preview:'preview',previewSequence:'sequence',previewPending:'pending',previewStill:'still',previewTask:'task',previewInitTask:'initTask'}))Object.defineProperty(context,name,{configurable:true,get:()=>controller.state[key],set:value=>{controller.state[key]=value;}});
 Object.assign(context,{previewController:controller,cancelPreview:controller.cancel,requestRender:controller.requestRender,raytrace:controller.raytrace,snapshot:controller.snapshot});
 return controller;
}
function previewHarness({flush=async()=>{}}={}){const phases=[],starts=[];let requests=0;const context=vm.createContext({cameraMotion:{finish(){}},inkTask:null,previewSequence:0,previewPending:false,previewStill:false,previewTask:null,disposed:false,preview:{active:false,cancel:async()=>{},start(args){const gate=deferred();starts.push({gate,args});return gate.promise;}},scheduler:{flush,request(){requests++;}},options:{onPreview:status=>phases.push(status)},renderer:{},scene:{},camera:{},active:{mesh:{}},albedoSkin:{},roughnessSkin:{},decals:new Map(),gallery:{raw:{}},console:{error(){}}});installPreview(context);return {context,phases,starts,get requests(){return requests;}};}
test('real edit cancellation during a pending frame flush prevents obsolete preview work from starting',async()=>{const gate=deferred(),h=previewHarness({flush:()=>gate.promise}),trace=h.context.raytrace();assert.equal(h.context.previewPending,true);assert.equal(h.phases.at(-1).phase,'loading');await tick();h.context.requestRender();gate.resolve();await trace;assert.equal(h.requests,1);assert.equal(h.starts.length,0);assert.equal(h.context.previewPending,false);assert.equal(h.context.previewStill,false);assert.equal(h.phases.at(-1).phase,'idle');});
test('overlapping preview intents waiting for the same flush start only the newest intent',async()=>{const gate=deferred(),h=previewHarness({flush:()=>gate.promise}),first=h.context.raytrace(),second=h.context.raytrace();await tick();gate.resolve();await tick();assert.equal(h.starts.length,1);h.starts[0].gate.resolve({samples:20});await Promise.all([first,second]);assert.equal(h.phases.filter(s=>s.phase==='complete').length,1);assert.equal(h.phases.at(-1).samples,20);assert.equal(h.context.previewStill,true);});
test('obsolete preview progress and completion cannot clear or replace the newer task',async()=>{const h=previewHarness(),first=h.context.raytrace();await tick();const second=h.context.raytrace();await tick();assert.equal(h.starts.length,2);const phases=h.phases.length;h.starts[0].args.onProgress({phase:'rendering',samples:4});assert.equal(h.phases.length,phases);h.starts[0].gate.resolve({samples:10});await first;assert.equal(h.context.previewTask,h.starts[1].gate.promise);assert.equal(h.context.previewStill,false);assert.equal(h.phases.filter(s=>s.phase==='complete').length,0);h.starts[1].gate.resolve({samples:30});await second;assert.equal(h.context.previewTask,null);assert.equal(h.phases.at(-1).samples,30);assert.equal(h.context.previewStill,true);});
test('obsolete preview errors do not reschedule raster rendering or clear the newer owner',async()=>{const h=previewHarness(),first=h.context.raytrace();await tick();const second=h.context.raytrace();await tick();h.starts[0].gate.reject(Error('Obsolete preview failed'));await first;assert.equal(h.requests,0);assert.equal(h.context.previewTask,h.starts[1].gate.promise);assert.ok(!h.phases.some(s=>s.phase==='error'));h.starts[1].gate.resolve({samples:15});await second;assert.equal(h.phases.at(-1).phase,'complete');});

function installSnapshot(context){context.snapshot=context.previewController.snapshot;}
test('actual completed preview snapshot preserves the traced canvas without a raster flush',async()=>{let frame='raytraced',flushes=0;const h=previewHarness({flush:async()=>{flushes++;frame='raster';}});h.context.previewStill=true;h.context.renderer.domElement={toDataURL:()=>frame};installSnapshot(h.context);assert.equal(await h.context.snapshot(),'raytraced');assert.equal(flushes,0);});
test('actual snapshot waits for an active trace and captures its completed canvas',async()=>{let frame='raster',flushes=0;const h=previewHarness({flush:async()=>{flushes++;}}),trace=h.context.raytrace();await tick();h.context.renderer.domElement={toDataURL:()=>frame};installSnapshot(h.context);let captured=false;const snapshot=h.context.snapshot().then(value=>{captured=true;return value;});await tick();assert.equal(captured,false);frame='refined';h.starts[0].gate.resolve({samples:24});await trace;assert.equal(await snapshot,'refined');assert.equal(flushes,1);});

// Load the actual vendored controls with only its browser import-map dependency resolved for Node.
const orbitSource=(await readFile(new URL('../studio/vendor/OrbitControls.js',import.meta.url),'utf8')).replace("from 'three'",`from '${new URL('../studio/vendor/three.core.js',import.meta.url).href}'`);
const {OrbitControls}=await import('data:text/javascript;base64,'+Buffer.from(orbitSource).toString('base64'));
function sceneCameraHarness(t,{animated=false}={}){
 const documentRoot={addEventListener(){},removeEventListener(){}},element={style:{},clientWidth:1200,clientHeight:800,addEventListener(){},removeEventListener(){},getRootNode:()=>documentRoot,ownerDocument:documentRoot},camera=new THREE.PerspectiveCamera(34,1,.01,20),controls=new OrbitControls(camera,element);
 Object.assign(controls,{enableDamping:true,dampingFactor:.09,minDistance:.22,maxDistance:4.5,maxPolarAngle:Math.PI*.91});let draws=0,cancellations=0;
 const timers=new Map(),frames=new Map();let timerId=0,frameId=0,time=0;
 const context=vm.createContext({...cameraFloorBindings,previewController:null,lightingDirty:false,requestAnimationFrame:fn=>setImmediate(fn),inkTask:null,THREE,lighting:'studio',gallery:{},camera,controls,updatingControls:false,applyingCamera:false,customCamera:false,viewName:'body',preview:null,disposed:false,document:{hidden:false},host:{dataset:{},clientWidth:1200,clientHeight:800},frameCount:0,lastFrameTime:0,adaptive:createAdaptiveQuality(),performance,renderer:{render(){draws++;if(draws>300)throw Error('Controls created an unbounded render loop');}},scene:{},stats(){},requestRender(){cancellations++;context.scheduler.request();},clearTimeout(id){timers.delete(id);},setTimeout(fn){timers.set(++timerId,fn);return timerId;},options:{},cameraTimer:null,cameraView,state:BODY_DEFAULTS});
 const start=source.indexOf('async draw(){'),end=source.indexOf('},async wait(){',start);assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end+1).replace('async draw(','async function draw('),context);
 context.cameraMotion=createCameraMotion({readPose:()=>({position:camera.position.toArray(),target:controls.target.toArray()}),applyPose:pose=>{restoreCameraPose(camera,controls,pose);context.requestRender();},
  reducedMotion:!animated,now:()=>time,requestFrame(fn){frames.set(++frameId,fn);return frameId;},cancelFrame(id){frames.delete(id);}});
 context.listen=(target,event,handler)=>target.addEventListener(event,handler);
 const registration=source.slice(source.indexOf("listen(controls,'change'"),source.indexOf('\n',source.indexOf("listen(controls,'change'")));vm.runInContext(registration,context);
 const viewStart=source.indexOf('function view('),viewEnd=source.indexOf("\n listen(renderer.domElement,'pointerdown'",viewStart);
 assert.ok(viewStart>=0&&viewEnd>viewStart);vm.runInContext(source.slice(viewStart,viewEnd),context);
 const scheduler=createRenderScheduler({draw:()=>context.draw(),requestFrame:fn=>setImmediate(fn),cancelFrame:clearImmediate});context.scheduler=scheduler;
 t.after(()=>{context.cameraMotion.dispose();scheduler.dispose();controls.dispose();});
 const idle=async()=>{await scheduler.flush();const count=draws;await tick();await tick();assert.equal(draws,count,'settled production draw must not keep scheduling frames');assert.equal(scheduler.getStats().pending,false);};
 return {context,camera,controls,scheduler,idle,frames,
  advance(ms){time+=ms;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(time);},
  get draws(){return draws;},get cancellations(){return cancellations;}};
}
test('actual scene draw suppresses false controls changes at the minimum radius and drains once settled',async t=>{
 const h=sceneCameraHarness(t);await h.idle();
 assert.equal(h.draws,2);assert.equal(h.cancellations,0);
 assert.ok(Math.abs(h.camera.position.distanceTo(h.controls.target)-.22)<1e-12);
 assert.ok(h.camera.position.y>=.02&&h.controls.target.y>=.02,'initial zero pose is corrected before rendering');
});

test('actual floor collision drains rendering and permits upward reversal and a stable named preset',async t=>{
 const h=sceneCameraHarness(t);h.context.view('front');await h.idle();
 for(let i=0;i<28;i++)handleCameraKey({key:'ArrowDown',preventDefault(){}},h.controls);
 await h.idle();assert.ok(Math.abs(h.camera.position.y-.02)<1e-8,'downward input reaches the actual floor constraint');
 handleCameraKey({key:'ArrowUp',preventDefault(){}},h.controls);await h.idle();
 assert.ok(h.camera.position.y>.03,'upward input must not fight old downward momentum');
 for(let i=0;i<28;i++)handleCameraKey({key:'ArrowDown',preventDefault(){}},h.controls);
 await h.idle();h.context.view('front');await h.idle();
 const pose=cameraView('front');assert.ok(h.camera.position.distanceTo(new THREE.Vector3(...pose.position))<1e-8);
 assert.ok(h.controls.target.distanceTo(new THREE.Vector3(...pose.target))<1e-8);
});

test('actual preset motion draws its sampled poses and leaves the real scheduler idle when finished',async t=>{
 const h=sceneCameraHarness(t,{animated:true});h.context.view('front',{immediate:true});await h.idle();
 h.context.view('back');const initialDraws=h.draws;
 for(let i=0;i<20;i++){h.advance(17);await h.idle();}
 assert.ok(h.draws>=initialDraws+20,'animation samples reach actual raster submissions');
 assert.ok(h.camera.position.distanceTo(new THREE.Vector3(0,.93,-3.8))<1e-8);
 assert.equal(h.frames.size,0,'no animation frame remains after completion');
 assert.equal(h.controls.enableDamping,true);await h.idle();
});

test('keyboard orbit releases a completed trace through the production controls change path',()=>{
 const root={addEventListener(){},removeEventListener(){}},element={style:{},addEventListener(){},removeEventListener(){},getRootNode:()=>root,ownerDocument:root};
 const camera=new THREE.PerspectiveCamera(34,1,.01,20);camera.position.set(0,0,3);
 const controls=new OrbitControls(camera,element),h=previewHarness();let cancelled=0,persistCamera;
 Object.assign(h.context,{...cameraFloorBindings,camera,controls,updatingControls:false,applyingCamera:false,customCamera:false,viewName:'body',cameraTimer:null,clearTimeout(){},setTimeout(callback){persistCamera=callback;return 1;},listen:(target,event,handler)=>target.addEventListener(event,handler)});
 h.context.preview.cancel=()=>{cancelled++;};h.context.previewStill=true;
 const start=source.indexOf("listen(controls,'change'"),registration=source.slice(start,source.indexOf('\n',start));vm.runInContext(registration,h.context);
 try{
  handleCameraKey({key:'ArrowLeft',preventDefault(){}},controls);
  assert.equal(cancelled,1,'camera editing releases traced ownership');
  assert.equal(h.context.previewStill,false);
  assert.equal(h.phases.at(-1).phase,'idle');
  assert.equal(h.requests,1,'raster work is requested through the existing render gate');
  assert.equal(typeof persistCamera,'function','camera persistence uses the existing debounce');
 }finally{controls.dispose();}
});

test('lighting applies renderer state only after the active preview releases its owner',async()=>{
 const gate=deferred(),camera=new THREE.PerspectiveCamera(),controls={target:new THREE.Vector3(),update:()=>false};let renders=0;
 const context=vm.createContext({...cameraFloorBindings,previewController:null,lightingDirty:false,requestAnimationFrame:fn=>setImmediate(fn),inkTask:null,THREE,lighting:'neutral',camera,controls,updatingControls:false,applyingCamera:false,customCamera:false,viewName:'body',preview:{active:true,cancel:()=>gate.promise},previewSequence:0,previewPending:false,previewTask:null,previewStill:false,disposed:false,document:{hidden:false},host:{dataset:{},clientWidth:1200,clientHeight:800},frameCount:0,lastFrameTime:0,adaptive:createAdaptiveQuality(),performance,renderer:{toneMapping:THREE.NoToneMapping,render(){renders++;}},scene:{},stats(){},scheduler:{request(){}},gallery:{setMode(){}},floor:{},key:{color:new THREE.Color()},fill:{color:new THREE.Color()},ambient:{},bodies:[],skin:{},referenceSkin:{},inspectionSkin:{},options:{}});
 installPreview(context);vm.runInContext(sceneFunction('setLighting'),context);
 const start=source.indexOf('async draw(){'),end=source.indexOf('},async wait(){',start);vm.runInContext(source.slice(start,end+1).replace('async draw(','async function draw('),context);
 context.setLighting('studio');assert.equal(context.renderer.toneMapping,THREE.NoToneMapping);
 const drawing=context.draw();await tick();assert.equal(renders,0);assert.equal(context.renderer.toneMapping,THREE.NoToneMapping);
 gate.resolve();await drawing;assert.equal(renders,1);assert.equal(context.renderer.toneMapping,THREE.NeutralToneMapping);
});

test('studio return refreshes actual frame-cached light uniforms before an immediate capture',async()=>{
 const frame=new NodeFrame(),ambient=new GPU.HemisphereLight('#ffffff','#cccccc',3),lightNode=new HemisphereLightNode(ambient);
 frame.update();frame.updateNode(lightNode);assert.equal(lightNode.color.r,3);
 const camera=new GPU.PerspectiveCamera(),controls={target:new GPU.Vector3(),update:()=>false};
 const context=vm.createContext({...cameraFloorBindings,previewController:null,lightingDirty:false,requestAnimationFrame:callback=>setImmediate(()=>{frame.update();callback();}),inkTask:null,THREE:GPU,lighting:'neutral',camera,controls,updatingControls:false,applyingCamera:false,customCamera:false,viewName:'body',preview:null,disposed:false,document:{hidden:false},host:{dataset:{},clientWidth:1200,clientHeight:800},frameCount:0,lastFrameTime:0,adaptive:createAdaptiveQuality(),performance,renderer:{render(){frame.renderId++;frame.updateNode(lightNode);}},scene:{},stats(){},scheduler:{request(){}},gallery:{setMode(){},suggestedLighting:{ambientIntensity:.32}},floor:{},key:{color:new GPU.Color()},fill:{color:new GPU.Color()},ambient,bodies:[],skin:{},referenceSkin:{},inspectionSkin:{},requestRender(){}});
 vm.runInContext(sceneFunction('setLighting'),context);
 const start=source.indexOf('async draw(){'),end=source.indexOf('},async wait(){',start);vm.runInContext(source.slice(start,end+1).replace('async draw(','async function draw('),context);
 context.setLighting('studio');await context.draw();assert.equal(lightNode.color.r,.32,'studio must not capture neutral intensity from the same renderer frame');
 lightNode.dispose();
});

test('lighting round trips retain the shadow resource used by cached studio materials',()=>{
 const key=new DirectionalLight();key.castShadow=true;
 const lightNode=new AnalyticLightNode(key);lightNode.setupDirect=()=>{};
 const builder={renderer:{shadowMap:{enabled:true}},object:{receiveShadow:true},context:{}};
 lightNode.setup(builder);
 const cachedShadow=lightNode.shadowNode;
 let disposals=0;cachedShadow.shadowMap={depthTexture:{version:1},dispose(){disposals++;}};
 const context=vm.createContext({...cameraFloorBindings,previewController:null,lightingDirty:false,requestAnimationFrame:fn=>setImmediate(fn),inkTask:null,THREE,lighting:'studio',host:{dataset:{}},gallery:{setMode(){}},floor:{},key,fill:{color:new THREE.Color()},ambient:{},bodies:[{mesh:{}}],skin:{},referenceSkin:{},inspectionSkin:{},requestRender(){}});
 vm.runInContext(sceneFunction('setLighting'),context);
 for(let repeat=0;repeat<10;repeat++)for(const mode of ['neutral','albedo','studio']){
  context.setLighting(mode);lightNode.setup(builder);
  assert.ok(cachedShadow.shadowMap?.depthTexture,`${mode} disposed a shadow still referenced by the cached studio material`);
  assert.equal(context.bodies[0].mesh.material,mode==='studio'?context.skin:mode==='neutral'?context.inspectionSkin:context.referenceSkin);
 }
 assert.equal(disposals,0);cachedShadow.dispose();assert.equal(disposals,1);lightNode.dispose();
});

// Execute the production update with real Three geometry/materials and the real
// surface mapper. Only the GPU and texture decode boundaries are substituted.
function cleanBodyHarness(modelId=RENDER_FIXTURE_MODEL_ID){
 const positions=new Float32Array([-.12,.88,.1,.12,.88,.1,0,1.08,.1]),geometry=new GPU.BufferGeometry();
 geometry.setAttribute('position',new GPU.BufferAttribute(positions,3));geometry.setIndex([0,1,2]);geometry.computeVertexNormals();
 geometry.setAttribute('uv',new GPU.Float32BufferAttribute([0,0,1,0,.5,1],2));
 const coverage=new Float32Array([1,1,1]),anchor={faceIndex:0,barycentric:[1/3,1/3,1/3]};
 const referenceSkin=new GPU.MeshBasicNodeMaterial(),inspectionSkin=new GPU.MeshBasicNodeMaterial(),skin=new GPU.MeshSSSNodeMaterial(),scene=new GPU.Scene();
 const body={id:modelId+':male',modelId,anatomy:'male',geometry,mesh:new GPU.Mesh(geometry,skin),data:{metadata:{}},accessories:[{descriptor:{kind:'eyes'},mesh:{visible:false}},{descriptor:{kind:'brows'},mesh:{visible:false}}]};
 const predicate=value=>({greaterThanEqual:n=>predicate(value>=n),lessThanEqual:n=>predicate(value<=n),and:other=>predicate(value&&other.value),select:(a,b)=>value?a:b,value});
 const context=vm.createContext({...TSL,THREE:GPU,BODY_DEFAULTS,resolveBodyModel,LEGACY_MODEL_ID,resolveSkinColor,performance,
  // Bounds resolve at an interior UV sample; an obsolete clothing predicate
  // would either fail here or incorrectly return zero for this covered triangle.
  uv:TSL.uv,inkTask:null,whiteInk:new GPU.Texture(),inkTexture:TSL.texture(new GPU.Texture()),inkSignature:'',inkAtlas:{calls:[],texture:new GPU.Texture(),async update(input){this.calls.push(input);}},cancelPreview:async()=>{},version:0,disposed:false,active:null,state:null,lastShape:'',lastAnchor:null,
  controls:{maxDistance:4.5},bodies:[body],library:{load:async()=>body,trim:async()=>{}},gallery:{},deform(){},lighting:'studio',
  skinColor:TSL.uniform(new GPU.Color('#9c7967')),skin,referenceSkin,inspectionSkin,albedoSkin:new GPU.MeshBasicNodeMaterial(),roughnessSkin:new GPU.MeshBasicNodeMaterial(),anatomyNormal:null,
  selected:new Set(),decals:new Map(),getTexture:async()=>new GPU.Texture(),getAnchor:()=>anchor,
  surface:{backend:'test',async compute({jobs}){return {patches:jobs.map(({id,...job})=>({id,patch:buildSurfacePatch({positions,normals:geometry.attributes.normal.array,indices:geometry.index.array,basePositions:positions,clothingMasks:coverage,...job})}))};}},
  scene,requestRender(){},scheduler:{flush:async()=>{}},host:{dataset:{}},options:{},measurements:{}});
 context.inkColor=context.inkTexture.rgb;
 context.inkDetailEnabled=TSL.uniform(0);context.inkDetailTexture=TSL.texture(new GPU.Texture());
 context.inkDetailOffset=TSL.uniform(new GPU.Vector2());context.inkDetailScale=TSL.uniform(new GPU.Vector2(1,1));
 context.whiteDetailInk=new GPU.Texture();
 vm.runInContext(`${sceneFunction('anchorFrame')}\n${sceneFunction('removeDecal')}\n${source.slice(source.indexOf('async function update('),source.indexOf('\n function view('))}`,context);
 return {context,body,coverage,anchor};
}

test('old true clothing and hair flags render a clean mannequin and cannot clip tattoos on covered skin',async()=>{
 const h=cleanBodyHarness(),savedBody=Object.freeze({...BODY_DEFAULTS,bodyModelId:RENDER_FIXTURE_MODEL_ID,body:'male',clothing:true,hair:true}),before=JSON.stringify(savedBody);
 const tattoo={id:'waist',assetId:'ink',placement:h.anchor,width:30,opacity:.63},assets=[{id:'ink',url:'ink.png',width:100,height:100}];
 await h.context.update(savedBody,[tattoo],assets);
 const decal=h.context.decals.get('waist');
 assert.ok(decal.mesh.geometry.index.count>0);
 assert.ok([...decal.mesh.geometry.attributes.clothingMask.array].every(v=>v===1),'actual tattoo patch crosses authored clothing coverage');
 assert.ok(decal.mesh.material.opacityNode,'interior tattoo opacity remains controlled by the artwork bounds');
 assert.equal(decal.opacity.value,.63);
 assert.ok(h.body.accessories.every(a=>a.mesh.visible),'retained facial context stays visible');
 let includesTone=false;h.context.referenceSkin.colorNode.traverse(node=>{if(node===h.context.skinColor)includesTone=true;});
 assert.ok(includesTone,'the reference preserves the chosen skin tone beneath ink');
 for(const node of [h.context.skin.colorNode,h.context.referenceSkin.colorNode,h.context.inspectionSkin.colorNode,h.context.skin.roughnessNode,h.context.skin.normalNode,h.context.skin.thicknessColorNode])node.traverse(child=>{
  assert.ok(!['clothingMask','torsoMask','basePosition'].includes(child.attributeName),'skin shading cannot depend on former garment coverage');
 });
 assert.equal(JSON.stringify(savedBody),before,'rendering does not rewrite the old study');
 await h.context.update({...savedBody,clothing:false,hair:false},[tattoo],assets);
 assert.equal(h.context.decals.get('waist'),decal,'obsolete flags cannot change decal mapping or force regeneration');
 assert.ok(h.body.accessories.every(a=>a.mesh.visible),'face details do not follow obsolete hair/clothing flags');
 assert.deepEqual([...h.coverage],[1,1,1],'authored source coverage remains intact');
});


test('refined preview and snapshot use the same clean body and unmasked ink as raster rendering',async()=>{
 const h=cleanBodyHarness();await h.context.update({...BODY_DEFAULTS,bodyModelId:RENDER_FIXTURE_MODEL_ID,body:'male',hair:true,clothing:true},[{id:'ink',assetId:'art',placement:h.anchor,width:30}],[{id:'art',url:'art.png',width:100,height:100}]);
 let traced;
 Object.assign(h.context,{cameraMotion:{finish(){}},previewSequence:0,previewPending:false,previewStill:false,previewTask:null,renderer:{domElement:{toDataURL:()=> 'data:image/png;base64,clean-trace'}},camera:{},preview:{active:false,cancel:async()=>{},async start(args){traced=args;return {samples:12};}},console:{error(){}}});
 installPreview(h.context);installSnapshot(h.context);
 await h.context.raytrace();
 assert.equal(traced.scene,h.context.scene);
 assert.equal(traced.bodyMesh,h.body.mesh);
 assert.equal(traced.albedoMaterial.colorNode,h.context.skin.colorNode);
 assert.equal(traced.roughnessMaterial,h.context.roughnessSkin);
 assert.equal(traced.decals.length,0,'the traced albedo already includes ink; do not apply it twice');
 assert.equal(h.context.decals.get('ink').mesh.visible,false);
 assert.equal(await h.context.snapshot(),'data:image/png;base64,clean-trace');
});


test('Atelier texture normalization and bump amplitude remain source-specific after changing the new-study default',async()=>{
 for(const modelId of ['makehuman-v1','atelier-v1']){
  const h=cleanBodyHarness(modelId);h.context.uv=TSL.uv;
  // Female avoids MakeHuman's separate male normal-map download, allowing the
  // same source-specific bump branch to be exercised on both references.
  await h.context.update({...BODY_DEFAULTS,bodyModelId:modelId,body:'female'});
  const amplitudes=[];h.context.skin.normalNode.traverse(node=>{if(node.isConstNode&&typeof node.value==='number')amplitudes.push(node.value);});
  assert.ok(amplitudes.includes(modelId==='atelier-v1'?.00008:.000025));
  assert.ok(!amplitudes.includes(modelId==='atelier-v1'?.000025:.00008));
  h.body.texture=new GPU.Texture();h.context.skin.userData.body=null;
  await h.context.update({...BODY_DEFAULTS,bodyModelId:modelId,body:'female'});
  const normalization=[];h.context.skin.colorNode.traverse(node=>{if(node.isConstNode&&node.value?.isVector3)normalization.push(node.value.toArray());});
  assert.equal(normalization.some(value=>value.join(',')==='0.48,0.325,0.235'),modelId==='atelier-v1','only Atelier receives its source-map color normalization');
 }
});


test('ink shares skin lighting and selection requests a local detail composition',async()=>{
 const h=cleanBodyHarness(),body={...BODY_DEFAULTS,bodyModelId:RENDER_FIXTURE_MODEL_ID,body:'female'};
 const tattoo={id:'waist',assetId:'ink',placement:h.anchor,width:30,opacity:.63},assets=[{id:'ink',url:'ink.png',width:100,height:100}];
 await h.context.update(body,[tattoo],assets);
 const decal=h.context.decals.get('waist');
 assert.equal(decal.mesh.visible,false,'no independently shaded tattoo overlay');
 assert.equal(h.context.inkAtlas.calls.length,1);
 assert.equal(h.context.inkTexture.value,h.context.inkAtlas.texture);
 const hasInk=node=>{let found=false;node.traverse(child=>{if(child===h.context.inkTexture)found=true;});return found;};
 for(const material of [h.context.skin,h.context.referenceSkin,h.context.inspectionSkin,h.context.albedoSkin])assert.ok(hasInk(material.colorNode),'all body views shade the same ink');
 await h.context.update({...body,skin:'monk10'},[tattoo],assets,['waist']);
 assert.equal(h.context.inkAtlas.calls.length,2,'selection refreshes its local ink detail');
 assert.equal(h.context.inkAtlas.calls.at(-1).focusDecals[0],decal);
 await h.context.update(body,[tattoo],assets,['waist']);
 assert.equal(h.context.inkAtlas.calls.length,2,'tone changes reuse both ink textures');
 await h.context.update(body,[{...tattoo,opacity:.3}],assets);
 assert.equal(h.context.inkAtlas.calls.length,3,'opacity invalidates the atlas');
 await h.context.update(body,[],assets);
 assert.equal(h.context.inkAtlas.calls.length,4,'removing the last tattoo clears old ink');
 assert.equal(h.context.inkAtlas.calls.at(-1).decals.length,0);
});


test('ray tracing waits for ink composition before taking renderer ownership',async()=>{
 const h=previewHarness(),gate=deferred();h.context.inkTask=gate.promise;
 const trace=h.context.raytrace();await tick();
 assert.equal(h.starts.length,0);gate.resolve();await tick();
 assert.equal(h.starts.length,1);h.starts[0].gate.resolve({samples:1});await trace;
});

test('undo during an in-flight ink edit rebuilds the stable atlas instead of reusing its old signature',async()=>{
 const h=cleanBodyHarness(),body={...BODY_DEFAULTS,bodyModelId:RENDER_FIXTURE_MODEL_ID,body:'female'};
 const tattoo={id:'waist',assetId:'ink',placement:h.anchor,width:30,opacity:.9},assets=[{id:'ink',url:'ink.png',width:100,height:100}];
 await h.context.update(body,[tattoo],assets);
 const committedSignature=h.context.inkSignature,gate=deferred();let edited=false;
 h.context.inkAtlas.update=async function(input){
  this.calls.push(input);this.texture.userData.bakedOpacity=input.decals[0].opacity.value;
  if(!edited){edited=true;await gate.promise;}
 };
 h.context.scheduler.flush=async()=>{if(h.context.inkTask)await h.context.inkTask;};
 const edit=h.context.update(body,[{...tattoo,opacity:.2}],assets);await tick();
 assert.equal(h.context.inkAtlas.calls.length,2);
 const undo=h.context.update(body,[tattoo],assets);await tick();
 gate.resolve();await Promise.all([edit,undo]);
 assert.equal(h.context.inkAtlas.calls.length,3,'undo must restore pixels overwritten by the stale edit');
 assert.equal(h.context.inkTexture.value.userData.bakedOpacity,.9);
 assert.equal(h.context.inkSignature,committedSignature);
});

// Execute the complete production factory with real CPU geometry/materials.
// Only browser event targets, loading, scheduler and GPU ownership are replaced.
function studioLifecycleHarness({failure,compact=false,reducedMotion=false,theme='glass'}={}){
 const counts={},events=[],galleryOptions=[],timers=new Map(),frames=new Map();let timerId=0,frameId=0,time=0,controls;
 const count=name=>{counts[name]=(counts[name]||0)+1;events.push(name);};
 class Target extends EventTarget{
  constructor(){super();this.style={};this.listeners=new Map();this.attributes=new Map();}
  addEventListener(type,handler){super.addEventListener(type,handler);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
  removeEventListener(type,handler){super.removeEventListener(type,handler);this.listeners.get(type)?.delete(handler);}
  setAttribute(name,value){this.attributes.set(name,String(value));}
 }
 const document=new Target(),motionPreference=new Target(),existingCanvas={id:'previous-engine'};
 document.documentElement={dataset:{theme}};
 motionPreference.matches=reducedMotion;
 const host={clientWidth:1000,clientHeight:700,dataset:{},children:[existingCanvas],appendChild(canvas){this.children.push(canvas);}};
 const canvas=new Target();canvas.remove=()=>{const index=host.children.indexOf(canvas);if(index>=0)host.children.splice(index,1);count('canvasRemove');};
 class Renderer{
  constructor(){this.domElement=canvas;this.shadowMap={};this.backend={isWebGPUBackend:true,device:{queue:{onSubmittedWorkDone:async()=>count('fence')}}};}
  async init(){if(failure==='renderer')throw Error('renderer failed');}
  setPixelRatio(){}setClearColor(){}setSize(){}
  dispose(){count('rendererDispose');}
 }
 class Controls extends GPU.EventDispatcher{
  constructor(camera){super();this.camera=camera;this.target=new GPU.Vector3();this.lastPose='';controls=this;}
  update(){const pose=JSON.stringify([this.camera.position.toArray(),this.target.toArray()]);if(pose!==this.lastPose){this.lastPose=pose;this.dispatchEvent({type:'change'});}}dispose(){count('controlsDispose');}
  rotateLeft(){count('rotateLeft');this.dispatchEvent({type:'change'});}
  rotateUp(){count('rotateUp');this.dispatchEvent({type:'change'});}
  dollyIn(){count('dollyIn');this.dispatchEvent({type:'change'});}
  dollyOut(){count('dollyOut');this.dispatchEvent({type:'change'});}
 }
 function tracked(Base,name){return class extends Base{constructor(...args){super(...args);this.addEventListener('dispose',()=>count(name));}};}
 const gpu={...GPU,WebGPURenderer:Renderer,MeshSSSNodeMaterial:tracked(GPU.MeshSSSNodeMaterial,'skinDispose'),MeshBasicNodeMaterial:tracked(GPU.MeshBasicNodeMaterial,'materialDispose'),PlaneGeometry:tracked(GPU.PlaneGeometry,'floorDispose'),DataTexture:tracked(GPU.DataTexture,'whiteInkDispose')};
 const context=vm.createContext({...cameraFloorBindings,...TSL,THREE:gpu,BODY_DEFAULTS,resolveBodyModel,LEGACY_MODEL_ID,resolveSkinColor,cameraView,createCameraMotion,handleCameraKey,choosePixelRatio,createAdaptiveQuality,applyCameraViewport,
  URLSearchParams,location:{search:''},devicePixelRatio:1,performance:{now:()=>time},document,
  window:{matchMedia:query=>query.includes('prefers-reduced-motion')?motionPreference:{matches:compact}},
  requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame(id){frames.delete(id);},
  setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
  ResizeObserver:class{observe(){}disconnect(){count('observerDisconnect');}},
  OrbitControls:Controls,createGeometryKernel:async()=>({}),
  createSurfaceClient:()=>({dispose(){count('surfaceDispose');},compute:async()=>({patches:[]})}),
  createGalleryEnvironment:async(renderer,scene,options)=>{galleryOptions.push(options);if(failure==='gallery')throw Error('gallery failed');return {setMode(){},dispose(){count('galleryDispose');}};},
  createInkAtlas:()=>context.inkFixture={texture:null,detail:null,async dispose(){count('inkDispose');}},
  createRenderScheduler:()=>({request(){count('request');},flush:async()=>{},dispose(){count('schedulerDispose');}}),
  createBodyLibrary:({scene,skin})=>{
   context.skinMaterial=skin;
   const geometry=new GPU.BufferGeometry(),base=new Float32Array([-.1,.9,0,.1,.9,0,0,1.1,0]);
   geometry.setAttribute('position',new GPU.BufferAttribute(base.slice(),3));geometry.setIndex([0,1,2]);geometry.computeVertexNormals();
   const mesh=new GPU.Mesh(geometry,skin),joints=['shoulder','elbow','wrist','hip','knee','ankle'];
   const landmarks=Object.fromEntries(['L','R'].map(side=>[side,Object.fromEntries(joints.map(joint=>[joint,[0,0,0]]))]));
   const body={id:'makehuman-v1:female',static:true,base,geometry,mesh,referenceMesh:mesh,accessories:[],groups:new Map(),anchors:new Map(),data:{metadata:{},normals:geometry.attributes.normal.array},endpoints:Array.from({length:9},()=>({landmarks}))};
   const loaded=[];
   return {loaded,async load(){if(failure==='update')throw Error('update failed');loaded.push(body);scene.add(mesh);return body;},trim:async()=>{},dispose(){scene.remove(mesh);geometry.dispose();count('libraryDispose');}};
  },
 });
 Object.assign(context,{disposeStudioResources,createPreviewOrchestrator(options){context.traceInput=options.getTraceInput;return createPreviewOrchestrator(options);}});vm.runInContext(source.slice(source.indexOf('export async function createStudio')).replace('export async function','async function'),context);
 const phases=[],cameras=[],cameraIntents=[];
 return {context,host,canvas,existingCanvas,counts,events,galleryOptions,timers,frames,motionPreference,phases,cameras,cameraIntents,get controls(){return controls;},
  advance(ms){time+=ms;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(time);},
  create:()=>context.createStudio(host,{presentation:theme==='instrument'?'instrument':'glass',initialBody:{...BODY_DEFAULTS,body:'female'},onPreview:value=>phases.push(value),onCamera:(value,intent)=>{cameras.push(value);cameraIntents.push(intent);}})};
}

test('actual studio selects instrument presentation once at construction without changing saved camera behavior',async()=>{
 for(const theme of ['instrument','glass','precision']){
  const h=studioLifecycleHarness({theme}),studio=await h.create();
  assert.equal(h.galleryOptions.length,1);assert.equal(h.galleryOptions[0].presentation,theme==='instrument'?'instrument':'glass');
  assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),cameraView('body'));
  h.context.document.documentElement.dataset.theme=theme==='instrument'?'glass':'instrument';
  studio.setLighting('neutral');studio.setLighting('studio');
  assert.equal(h.galleryOptions.length,1,'mode changes retain the constructed presentation');
  await studio.dispose();
 }
});

test('base and focused ink keep independent compiled texture bindings after their initial white frame',async()=>{
 const h=studioLifecycleHarness(),studio=await h.create();
 try{
  const inkNodes=new Set();h.context.skinMaterial.colorNode.traverse(node=>{if(node.isTextureNode&&node.value.isDataTexture)inkNodes.add(node);});
  assert.equal(inkNodes.size,2);
  const nodes=[...inkNodes],hashes=new Map(),builder={getNodeFromHash:hash=>hashes.get(hash),setHashNode(node,hash){hashes.set(hash,node);}};
  // Three binds shared uniforms before artwork loads, using the original
  // fallback texture UUID. Changing .value later cannot split that binding.
  const bindings=nodes.map(node=>node.getSharedNode(builder)),base=new GPU.Texture(),detail=new GPU.Texture();
  nodes[0].value=base;nodes[1].value=detail;
  assert.equal(bindings[0].value,base);assert.equal(bindings[1].value,detail);
 }finally{await studio.dispose();}
});

test('the actual studio passes its settled local ink window to Refine',async()=>{
 const h=studioLifecycleHarness(),studio=await h.create();
 try{
  const focus={texture:new GPU.Texture(),offset:[.59,.79],scale:[.12,.06]};h.context.inkFixture.detail=focus;
  assert.equal(h.context.traceInput().inkDetail,focus);
  h.context.inkFixture.detail=null;assert.equal(h.context.traceInput().inkDetail,null);
  focus.texture.dispose();
 }finally{await studio.dispose();}
});

test('actual studio presets move over time but startup and restored cameras stay immediate',async()=>{
 const h=studioLifecycleHarness(),studio=await h.create(),initial=JSON.parse(JSON.stringify(studio.getCamera()));
 assert.deepEqual(initial,cameraView('body'),'startup applies Orbit immediately');
 assert.equal(h.frames.size,0,'startup does not animate');
 studio.view('back');
 assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),initial,'a preset starts at the current visible pose');
 h.advance(170);
 assert.notDeepEqual(JSON.parse(JSON.stringify(studio.getCamera())),initial,'the preset progresses on animation frames');
 assert.ok(studio.getCamera().position[0]**2+studio.getCamera().position[2]**2>4,'the arc stays outside the body');
 const custom={position:[1.4,1.4,2.7],target:[0,1.1,0]};
 studio.restoreCamera(custom);h.advance(400);
 assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),custom,'restoring cancels an unfinished preset');
 assert.equal(h.frames.size,0);await studio.dispose();
});

test('actual studio canvas pointer, wheel and focused keyboard input interrupt a preset',async()=>{
 for(const type of ['pointerdown','wheel','keydown']){
  const h=studioLifecycleHarness(),studio=await h.create();h.context.document.activeElement=h.canvas;
  studio.view('back');h.advance(100);const visible=JSON.parse(JSON.stringify(studio.getCamera()));
  const input=new Event(type,{cancelable:true});Object.assign(input,{key:'ArrowLeft',clientX:10,clientY:10});h.canvas.dispatchEvent(input);
  h.advance(400);assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),visible,`${type} cancels further preset motion`);
  assert.equal(h.frames.size,0);await studio.dispose();
 }
});

test('actual studio follows reduced motion changes and releases its preference listener on dispose',async()=>{
 const h=studioLifecycleHarness(),studio=await h.create();studio.view('back');h.advance(100);
 h.motionPreference.matches=true;h.motionPreference.dispatchEvent(Object.assign(new Event('change'),{matches:true}));
 assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),cameraView('back'));assert.equal(h.frames.size,0);
 studio.view('front');assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),cameraView('front'));assert.equal(h.frames.size,0);
 h.motionPreference.matches=false;h.motionPreference.dispatchEvent(Object.assign(new Event('change'),{matches:false}));
 studio.view('back');assert.equal(h.frames.size,1);
 const stale=[...h.frames.values()][0],visible=JSON.parse(JSON.stringify(studio.getCamera()));await studio.dispose();stale();h.advance(400);
 assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),visible);assert.equal(h.frames.size,0);
 assert.equal(h.motionPreference.listeners.get('change').size,0);
});

test('actual studio snapshot settles the latest preset before its capture fence',async()=>{
 const h=studioLifecycleHarness(),studio=await h.create();
 h.canvas.toDataURL=()=>JSON.stringify(studio.getCamera());
 studio.view('back');h.advance(100);studio.view('side');
 assert.deepEqual(JSON.parse(await studio.snapshot()),cameraView('side'));
 assert.equal(h.frames.size,0);await studio.dispose();
});

test('ray tracing settles pending camera motion before reserving preview ownership',async()=>{
 const h=previewHarness(),camera=new THREE.PerspectiveCamera(34,1,.01,20),target=new THREE.Vector3();camera.position.set(.4,1.2,2.8);target.set(0,1.13,0);
 h.context.camera=camera;
 h.context.cameraMotion=createCameraMotion({readPose:()=>({position:camera.position.toArray(),target:target.toArray()}),
  applyPose(pose){camera.position.fromArray(pose.position);target.fromArray(pose.target);h.context.requestRender();},requestFrame:()=>1,cancelFrame(){}});
 h.context.cameraMotion.start(cameraView('back'));
 const trace=h.context.raytrace();await tick();
 assert.equal(h.starts.length,1,'settlement does not cancel the newly reserved trace');
 assert.ok(h.starts[0].args.camera.position.distanceTo(new THREE.Vector3(0,.93,-3.8))<1e-8);
 assert.equal(h.context.cameraMotion.active,false);h.starts[0].gate.resolve({samples:1});await trace;
});

test('actual studio uses compact Orbit only on preset activation and preserves restored poses on resize',async()=>{
 const h=studioLifecycleHarness({compact:true,reducedMotion:true}),studio=await h.create();
 const initial=studio.getCamera(),desktop=cameraView('body');
 assert.ok(initial.position[2]<desktop.position[2]*.65,'new compact studio uses the closer working preset');
 const custom={position:[1.4,1.4,2.7],target:[0,1.1,0]};
 studio.restoreCamera(custom);
 assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),custom,'saved custom camera restores without preset conversion');
 h.context.window.matchMedia=()=>({matches:false});
 await studio.refreshLayout();
 assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),custom,'resize adjusts projection without resetting the restored pose');
 h.context.window.matchMedia=()=>({matches:true});
 studio.view('body');
 assert.ok(studio.getCamera().position[2]<desktop.position[2]*.65,'explicit Orbit tap activates compact preset');
 studio.view('front');
 assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),cameraView('front'),'Front remains the full-body preset on phones');
 await studio.dispose();
});

test('actual studio disposal returns one promise, detaches only its canvas and stops stale callbacks',async()=>{
 const h=studioLifecycleHarness(),studio=await h.create();
 assert.deepEqual(h.host.children,[h.existingCanvas,h.canvas]);
 h.controls.dispatchEvent({type:'change'});const queuedCamera=[...h.timers.values()][0];assert.ok(queuedCamera);
 const requests=h.counts.request,first=studio.dispose(),second=studio.dispose();
 assert.equal(first,second,'every disposer caller awaits the same cleanup');
 assert.deepEqual(h.host.children,[h.existingCanvas],'detach the owned canvas immediately');
 assert.equal(h.timers.size,0);queuedCamera();h.controls.dispatchEvent({type:'change'});
 await studio.raytrace();assert.equal(h.counts.request,requests);assert.equal(h.cameras.length,0);assert.equal(h.phases.length,0);
 await first;assert.equal(studio.dispose(),first);
 for(const name of ['canvasRemove','rendererDispose','surfaceDispose','controlsDispose','schedulerDispose','observerDisconnect','galleryDispose','libraryDispose','inkDispose','floorDispose','skinDispose','whiteInkDispose'])assert.equal(h.counts[name],name==='whiteInkDispose'?2:1,name);
 assert.equal([...h.canvas.listeners.values()].reduce((n,listeners)=>n+listeners.size,0),0);
 assert.equal([...h.context.document.listeners.values()].reduce((n,listeners)=>n+listeners.size,0),0);
 assert.equal(h.events.at(-1),'rendererDispose');
});

test('actual studio canvas handles camera keys only while focused and removes the owned listener on dispose',async()=>{
 const h=studioLifecycleHarness(),studio=await h.create();
 assert.equal(h.canvas.tabIndex,0);
 assert.match(h.canvas.attributes.get('aria-label'),/arrow keys.*plus and minus/i);
 const press=(key,modifiers={})=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key,...modifiers});h.canvas.dispatchEvent(event);return event;};
 const before=h.counts.request;
 h.context.document.activeElement={};
 assert.equal(press('ArrowLeft').defaultPrevented,false);
 assert.equal(h.counts.rotateLeft,undefined,'synthetic keys delivered without canvas focus are ignored');
 h.context.document.activeElement=h.canvas;
 assert.equal(press('ArrowLeft').defaultPrevented,true);
 assert.equal(h.counts.rotateLeft,1);
 assert.equal(h.counts.request,before+1,'camera key follows the existing controls change render path');
 assert.equal(h.timers.size,1,'camera persistence follows the existing debounce');
 [...h.timers.values()][0]();assert.equal(h.cameras.length,1);
 for(const modifiers of [{ctrlKey:true},{metaKey:true},{altKey:true}])assert.equal(press('+',modifiers).defaultPrevented,false);
 assert.equal(press('Tab').defaultPrevented,false);
 const requests=h.counts.request,staleListener=[...h.canvas.listeners.get('keydown')][0];
 const disposing=studio.dispose();
 assert.equal(h.canvas.listeners.get('keydown').size,0);
 assert.equal(press('ArrowRight').defaultPrevented,false);
 const staleEvent=new Event('keydown',{cancelable:true});Object.assign(staleEvent,{key:'ArrowRight'});staleListener(staleEvent);
 assert.equal(staleEvent.defaultPrevented,false,'a stale callback cannot mutate a disposed camera');
 assert.equal(h.counts.rotateLeft,1);assert.equal(h.counts.request,requests);
 await disposing;
});

test('actual factory releases partial ownership before rejecting renderer, gallery or initial update failures',async()=>{
 for(const failure of ['renderer','gallery','update']){
  const h=studioLifecycleHarness({failure});
  await assert.rejects(h.create(),new RegExp(`${failure} failed`));
  assert.deepEqual(h.host.children,[h.existingCanvas],failure);
  assert.equal(h.counts.surfaceDispose,1,failure);assert.equal(h.counts.rendererDispose,1,failure);
  if(failure==='update')for(const name of ['galleryDispose','libraryDispose','inkDispose','controlsDispose','observerDisconnect','floorDispose','skinDispose','whiteInkDispose'])assert.equal(h.counts[name],name==='whiteInkDispose'?2:1,name);
 }
});

test('production cleanup waits for preview, ink and GPU ownership before releasing scene resources',async()=>{
 const ink=deferred(),preview=deferred(),fence=deferred(),events=[];
 const resource={dispose(){events.push('resource');}};
 const owned={resources:new Set([resource]),textures:new Map(),pending:()=>[ink.promise,preview.promise],
  stop(){events.push('stop');},preview:{cancel(){events.push('cancel');preview.resolve();},dispose(){events.push('preview');}},
  inkAtlas:{dispose(){events.push('ink');}},renderer:{backend:{isWebGPUBackend:true,device:{queue:{onSubmittedWorkDone(){events.push('fence');return fence.promise;}}}},dispose(){events.push('renderer');}}};
 const context={disposeStudioResources};
 const first=context.disposeStudioResources(owned);assert.equal(context.disposeStudioResources(owned),first);assert.deepEqual(events,['stop']);
 await tick();assert.ok(events.includes('cancel'));assert.ok(!events.includes('resource'));assert.ok(!events.includes('fence'));
 ink.resolve();await tick();assert.ok(events.includes('fence'));assert.ok(!events.includes('resource'));
 fence.reject(Error('Device lost'));await first;
 assert.equal(events.filter(name=>name==='resource').length,1);assert.equal(events.at(-1),'renderer');
});

test('production cleanup also releases a preview whose asynchronous creation finishes during disposal',async()=>{
 const initialized=deferred(),events=[];
 const owned={resources:new Set(),textures:new Map(),stop(){events.push('stop');},renderer:{dispose(){events.push('renderer');}}};
 const initialization=initialized.promise.then(()=>{owned.preview={dispose(){events.push('late-preview');}};});
 owned.pending=()=>[initialization];
 const context={disposeStudioResources};
 const disposing=context.disposeStudioResources(owned);await tick();assert.deepEqual(events,['stop']);
 initialized.resolve();await disposing;assert.deepEqual(events,['stop','late-preview','renderer']);
});

test('snapshot requested while trace is preparing waits for the refined capture',async()=>{
 const gate=deferred();let frame='raster';const h=previewHarness({flush:()=>gate.promise});
 h.context.renderer.domElement={toDataURL:()=>frame};installSnapshot(h.context);
 const trace=h.context.raytrace();let captured=false;
 const snapshot=h.context.snapshot().then(value=>{captured=true;return value;});
 await tick();gate.resolve();await tick();
 assert.equal(captured,false,'preparing a trace retains capture ownership until its render completes');
 frame='refined';h.starts[0].gate.resolve({samples:16});await trace;
 assert.equal(await snapshot,'refined');
});


test('camera persistence distinguishes user adjustments from named and restored poses',async()=>{
 const h=studioLifecycleHarness({reducedMotion:true}),studio=await h.create();
 const persist=()=>{for(const callback of [...h.timers.values()])callback();h.timers.clear();};
 studio.view('back');assert.equal(studio.getViewName(),'back');persist();
 assert.ok(h.cameraIntents.length>0);assert.equal(h.cameraIntents.at(-1)?.custom,false,'named preset is retained');
 h.controls.dispatchEvent({type:'change'});assert.equal(studio.getViewName(),'custom','export sees a user orbit before persistence debounce');persist();
 assert.equal(h.cameraIntents.at(-1)?.custom,true,'actual controls adjustment is custom');
 studio.view('front');persist();assert.equal(h.cameraIntents.at(-1)?.custom,false);
 studio.restoreCamera({position:[1.4,1.4,2.7],target:[0,1.1,0]});persist();
 assert.equal(h.cameraIntents.at(-1)?.custom,true,'restored orbit has no saved named-view identity');
 await studio.dispose();
});


test('snapshot follows the newest refined owner when a second trace replaces the first capture intent',async()=>{
 let frame='raster';const h=previewHarness();h.context.renderer.domElement={toDataURL:()=>frame};
 const first=h.context.raytrace();await tick();
 let captured=false;const capture=h.context.snapshot().then(value=>{captured=true;return value;});
 const second=h.context.raytrace();await tick();h.starts[0].gate.resolve({samples:1});await first;await tick();
 assert.equal(captured,false,'an obsolete completion cannot capture the newer preview before it settles');
 frame='latest-refined';h.starts[1].gate.resolve({samples:20});await second;
 assert.equal(await capture,'latest-refined');
});

test('interrupting a moving preset without dragging captures and persists a custom intermediate view',async()=>{
 for(const input of ['pointerdown','wheel','start','keydown']){
  const h=studioLifecycleHarness(),studio=await h.create();h.context.document.activeElement=h.canvas;
  studio.view('back');h.advance(170);const intermediate=JSON.parse(JSON.stringify(studio.getCamera()));
  assert.notDeepEqual(intermediate,cameraView('back'));
  if(input==='start')h.controls.dispatchEvent({type:'start'});
  else {const event=new Event(input,{cancelable:true});Object.assign(event,{key:'Tab',clientX:10,clientY:10});h.canvas.dispatchEvent(event);}
  assert.equal(studio.getViewName(),'custom',`${input} marks cancellation before export or controls change`);
  h.canvas.toDataURL=()=>JSON.stringify({camera:studio.getCamera(),view:studio.getViewName()});
  assert.deepEqual(JSON.parse(await studio.snapshot()),{camera:intermediate,view:'custom'});
  h.advance(500);assert.deepEqual(JSON.parse(JSON.stringify(studio.getCamera())),intermediate);
  for(const callback of [...h.timers.values()])callback();h.timers.clear();
  assert.equal(h.cameraIntents.at(-1)?.custom,true,`${input} persists the interrupted pose as custom`);
  await studio.dispose();
 }
});

test('clicking or beginning interaction on a settled preset preserves its named identity',async()=>{
 for(const input of ['pointerdown','wheel','start']){
  const h=studioLifecycleHarness(),studio=await h.create();studio.view('back');h.advance(400);
  assert.equal(studio.getViewName(),'back');
  if(input==='start')h.controls.dispatchEvent({type:'start'});
  else {const event=new Event(input);Object.assign(event,{clientX:10,clientY:10});h.canvas.dispatchEvent(event);}
  assert.equal(studio.getViewName(),'back',`${input} without active motion or camera change keeps the preset name`);
  await studio.dispose();
 }
});
