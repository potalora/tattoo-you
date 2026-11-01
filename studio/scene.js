import {disposeStudioResources} from './renderer-lifecycle.js';
import {createPreviewOrchestrator} from './preview-orchestrator.js';
import * as THREE from 'three';
import { attribute, uniform, texture, uv, vec3, normalWorld, bumpMap, normalMap, vec2, float } from 'three/tsl';
import {createGalleryEnvironment} from './gallery-environment.js';
import {cameraView} from './camera-framing.js';
import {createCameraMotion} from './camera-motion.js';
import {handleCameraKey} from './camera-keyboard.js';
import {constrainCameraToFloor,restoreCameraPose} from './camera-floor.js';
import {applyCameraViewport,COMPACT_LAYOUT_QUERY} from './viewport-layout.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import {createSurfaceClient} from './surface-client.js';
import {createRenderScheduler} from './render-scheduler.js';
import {createInkAtlas} from './ink-atlas.js';
import {choosePixelRatio,createAdaptiveQuality} from './render-quality.js';
import { createGeometryKernel } from './geometry-kernel.js';
import {skinColor as resolveSkinColor} from './skin-tones.js';
import {blendBodyShape} from './body-shapes.js';
import {BODY_DEFAULTS} from './model.js';
import {resolveBodyModel,LEGACY_MODEL_ID} from './model-catalog.js';
import {createBodyLibrary} from './body-loader.js';
import { REGION_TARGETS as targets, REGIONS } from './regions.js';
export { REGIONS };
export async function createStudio(host,options={}){
 if(typeof options==='function')options={onPlace:options};
 const presentation=options.presentation==='instrument'?'instrument':'glass';
 const owned={resources:new Set(),textures:new Map(),listeners:[]};
 let disposed=false,version=0,cameraTimer;
 let previewController,applyingCamera=false,customCamera=false,viewName='body';
 const own=resource=>{owned.resources.add(resource);return resource;};
 const listen=(target,event,handler)=>{target.addEventListener(event,handler);owned.listeners.push([target,event,handler]);};
 const dispose=()=>disposeStudioResources(owned);
 owned.stop=()=>{disposed=true;version++;if(previewController)previewController.state.sequence++;clearTimeout(cameraTimer);owned.cameraMotion?.dispose();for(const [target,event,handler]of owned.listeners)target.removeEventListener(event,handler);owned.listeners.length=0;owned.observer?.disconnect();owned.scheduler?.dispose();owned.surface?.dispose();owned.controls?.dispose();owned.renderer?.domElement.remove();};
 try{
 const kernel=await createGeometryKernel(),surface=owned.surface=createSurfaceClient();
 const forceWebGL=new URLSearchParams(location.search).get('renderer')==='webgl';
 const renderer=owned.renderer=new THREE.WebGPURenderer({antialias:true,preserveDrawingBuffer:true,forceWebGL});await renderer.init();
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#45423f');renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
 host.appendChild(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Interactive body and tattoo placement. Use arrow keys to orbit, plus and minus to zoom.');
 const scene=owned.scene=new THREE.Scene();const gallery=owned.gallery=await createGalleryEnvironment(renderer,scene,{presentation});
 const camera=new THREE.PerspectiveCamera(34,1,.01,20),controls=owned.controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=.22;controls.maxDistance=4.5;controls.maxPolarAngle=Math.PI*.91;
 const key=new THREE.DirectionalLight('#ffffff',3.4);key.position.set(-1.5,3,2.2);scene.add(key);
 key.castShadow=true;key.shadow.mapSize.set(host.clientWidth>700?2048:1024,host.clientWidth>700?2048:1024);Object.assign(key.shadow.camera,{left:-1.6,right:1.6,top:1.8,bottom:-1.8,near:.1,far:10});key.shadow.camera.updateProjectionMatrix();key.shadow.normalBias=.004;key.shadow.bias=-.00005;key.shadow.radius=5;key.userData.rasterOnly=true;key.target.position.set(0,.9,0);scene.add(key.target);
 if(gallery.suggestedLighting?.keyPosition)key.position.fromArray(gallery.suggestedLighting.keyPosition);if(gallery.suggestedLighting?.keyTarget)key.target.position.fromArray(gallery.suggestedLighting.keyTarget);
 const fill=new THREE.DirectionalLight('#ffffff',2.4);fill.userData.rasterOnly=true;fill.position.set(1.6,2,-1.5);scene.add(fill);const ambient=new THREE.HemisphereLight('#ffffff','#cccccc',3);scene.add(ambient);
 const loader=new THREE.TextureLoader(),skinColor=uniform(new THREE.Color(resolveSkinColor({skin:'monk05'})));
 const skin=own(new THREE.MeshSSSNodeMaterial({roughness:.51,metalness:0,ior:1.4,specularIntensity:.85})),albedoSkin=own(new THREE.MeshBasicNodeMaterial({toneMapped:false,side:THREE.DoubleSide})),roughnessSkin=own(new THREE.MeshBasicNodeMaterial({toneMapped:false,side:THREE.DoubleSide})),referenceSkin=own(new THREE.MeshBasicNodeMaterial({toneMapped:false})),inspectionSkin=own(new THREE.MeshBasicNodeMaterial({toneMapped:false}));
 const floor=new THREE.Mesh(own(new THREE.PlaneGeometry(12,12)),own(new THREE.MeshBasicNodeMaterial({color:'#353431',toneMapped:false})));floor.rotation.x=-Math.PI/2;floor.position.y=-.005;scene.add(floor);
 const whiteInk=own(new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1));whiteInk.needsUpdate=true;whiteInk.colorSpace=THREE.LinearSRGBColorSpace;
 // Texture uniforms are deduplicated by the initial texture UUID. These live
 // bindings must start distinct before either swaps to its render target.
 const whiteDetailInk=own(whiteInk.clone());whiteDetailInk.needsUpdate=true;
 const inkTexture=texture(whiteInk),inkAtlas=owned.inkAtlas=createInkAtlas(renderer);let inkSignature='',inkTask=null;
 const inkDetailOffset=uniform(new THREE.Vector2()),inkDetailScale=uniform(new THREE.Vector2(1,1)),inkDetailEnabled=uniform(0);
 const inkDetailUV=uv().sub(inkDetailOffset).div(inkDetailScale),inkDetailTexture=texture(whiteDetailInk,inkDetailUV);
 const detailInside=inkDetailUV.x.greaterThanEqual(0).and(inkDetailUV.x.lessThanEqual(1)).and(inkDetailUV.y.greaterThanEqual(0)).and(inkDetailUV.y.lessThanEqual(1)).and(inkDetailEnabled.greaterThan(.5));
 const inkColor=detailInside.select(inkDetailTexture.rgb,inkTexture.rgb);
 let anatomyNormal;
 const library=owned.library=createBodyLibrary({scene,skin,loader,surface}),bodies=library.loaded;
 let state=options.initialBody||BODY_DEFAULTS,active,lastShape='',placing=false,down=null,selected=new Set(),lastAnchor=null;
 let lighting='studio',lightingDirty=false,measurements={},quality='auto',adaptive=createAdaptiveQuality(),lastFrameTime=0,lastStatsTime=0;
 owned.pending=()=>[inkTask,previewController?.state.intentTask,previewController?.state.task,previewController?.state.initTask];
 const decals=new Map(),textures=owned.textures,raycaster=new THREE.Raycaster();let updatingControls=false,floorCollision=false,frameCount=0,layoutSignature='',resizeSequence=0,captureRegion=null;
 function getMappingWarnings(){return [...decals].flatMap(([tattooId,decal])=>(decal.warnings||[]).map(message=>({tattooId,message})));}
 function stats(){const now=performance.now();if(now-lastStatsTime<200)return;lastStatsTime=now;const r=renderer.info;Object.assign(host.dataset,{drawCalls:String(r.render?.drawCalls||r.render?.calls||0),triangles:String(r.render?.triangles||0),roomMeshes:String(gallery.metrics?.meshes||0),roomTriangles:String(gallery.metrics?.triangles||0),roomTextureBytes:String(gallery.metrics?.decodedTextureBytes||0)});options.onStats?.({renderer:renderer.backend.isWebGPUBackend?'WebGPU':'WebGL 2',kernel:kernel.backend||kernel.kind||'JavaScript',surface:surface.backend,triangles:r.render?.triangles||(active?.geometry.index.count||0)/3,drawCalls:r.render?.drawCalls||r.render?.calls||0,pixelRatio:renderer.getPixelRatio(),mappingWarnings:getMappingWarnings(),warnings:getMappingWarnings().map(record=>record.message)});}
 function cancelPreview(){return previewController?.cancel();}
 function requestRender(){if(previewController)previewController.requestRender();else if(!disposed)owned.scheduler?.request();}
 const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
 const cameraMotion=owned.cameraMotion=createCameraMotion({
  readPose:()=>({position:camera.position.toArray(),target:controls.target.toArray()}),
  applyPose:pose=>{applyingCamera=true;try{restoreCameraPose(camera,controls,pose);}finally{applyingCamera=false;}requestRender();},
  reducedMotion:motionPreference.matches,now:()=>performance.now(),requestFrame:requestAnimationFrame,cancelFrame:cancelAnimationFrame,
 });
 // A canceled transition retains a pose between named endpoints. Persist its
 // custom identity even when the user stops it without any later orbit change.
 function interruptCameraMotion(){
  if(!cameraMotion.cancel())return;
  customCamera=true;viewName='custom';
  clearTimeout(cameraTimer);
  cameraTimer=setTimeout(()=>{
   if(!disposed)options.onCamera?.({position:camera.position.toArray(),target:controls.target.toArray()},{custom:customCamera});
  },350);
 }
 listen(motionPreference,'change',event=>cameraMotion.setReducedMotion(event.matches));
 listen(controls,'start',interruptCameraMotion);
 listen(renderer.domElement,'wheel',interruptCameraMotion);
 async function resize(){
  const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight),clear=options.getClearViewport?.()||null,compact=window.matchMedia(COMPACT_LAYOUT_QUERY).matches;
  const ratio=choosePixelRatio({width,height,dpr:devicePixelRatio,quality,scale:adaptive.getScale()}),signature=JSON.stringify([width,height,ratio,clear,compact]);
  if(disposed||signature===layoutSignature)return;
  // Deduplicate the requested layout, not the last applied one: a quick B -> A
  // change must invalidate pending B even when A is still on screen.
  layoutSignature=signature;const sequence=++resizeSequence;
  try{
   await cancelPreview();if(inkTask)await inkTask;if(disposed||sequence!==resizeSequence)return;
   renderer.setPixelRatio(ratio);renderer.setSize(width,height);applyCameraViewport(camera,{width,height,clear,compact});
   captureRegion=clear?{x:clear.x/width,y:clear.y/height,width:clear.width/width,height:clear.height/height}:null;
   host.dataset.clearViewport=JSON.stringify(clear);requestRender();
  }catch(error){if(sequence===resizeSequence)layoutSignature='';throw error;}
 }
 const scheduler=owned.scheduler=createRenderScheduler({async draw(){if(inkTask)await inkTask;if(previewController?.state.preview?.active)await previewController.state.preview.cancel();if(disposed||document.hidden)return;if(lightingDirty){await new Promise(requestAnimationFrame);if(disposed||document.hidden)return;lightingDirty=false;}const previous=[...camera.position.toArray(),...camera.quaternion.toArray(),...controls.target.toArray()];updatingControls=true;try{controls.update();floorCollision=constrainCameraToFloor(camera,controls.target)||floorCollision;if(floorCollision){restoreCameraPose(camera,controls,{position:camera.position.toArray(),target:controls.target.toArray()});floorCollision=false;}}finally{updatingControls=false;}const current=[...camera.position.toArray(),...camera.quaternion.toArray(),...controls.target.toArray()],changed=current.some((v,i)=>Math.abs(v-previous[i])>1e-8),now=performance.now(),scale=adaptive.getScale();adaptive.sample(lastFrameTime?now-lastFrameTime:0);lastFrameTime=now;if(scale!==adaptive.getScale()){renderer.setPixelRatio(choosePixelRatio({width:host.clientWidth,height:host.clientHeight,dpr:devicePixelRatio,quality,scale:adaptive.getScale()}));}renderer.toneMapping=lighting==='studio'?THREE.NeutralToneMapping:THREE.NoToneMapping;renderer.toneMappingExposure=1;gallery.updateView?.(camera,controls.target);renderer.render(scene,camera);host.dataset.frameCount=String(++frameCount);host.dataset.renderError='';stats();if(changed)scheduler.request();},async wait(){if(renderer.backend.isWebGPUBackend)await renderer.backend.device.queue.onSubmittedWorkDone();},onError(error){host.dataset.renderError=error.message;console.error('Render failed',error);options.onError?.(error);}});
 listen(controls,'change',()=>{if(disposed)return;floorCollision=constrainCameraToFloor(camera,controls.target)||floorCollision;if(updatingControls)return;if(!applyingCamera){customCamera=true;viewName='custom';}requestRender();clearTimeout(cameraTimer);cameraTimer=setTimeout(()=>{if(!disposed)options.onCamera?.({position:camera.position.toArray(),target:controls.target.toArray()},{custom:customCamera});},350);});
 listen(renderer.domElement,'keydown',event=>{if(disposed||document.activeElement!==renderer.domElement)return;interruptCameraMotion();handleCameraKey(event,controls);});
 previewController=createPreviewOrchestrator({
  isDisposed:()=>disposed,finishCamera:()=>cameraMotion.finish(),getInkTask:()=>inkTask,scheduler,
  async createPreview(){
   const {createPathPreview}=await import('./path-preview.js');
   if(disposed)return null;
   return owned.preview=await createPathPreview(renderer);
  },
  getTraceInput(){
   gallery.updateView?.(camera,controls.target);
   return {scene,camera,bodyMesh:active.mesh,albedoMaterial:albedoSkin,roughnessMaterial:roughnessSkin,decals:[],environment:gallery.raw,inkDetail:inkAtlas.detail};
  },
  onPreview:status=>options.onPreview?.(status),onError:error=>console.error(error),
  capture:()=>renderer.domElement.toDataURL('image/png'),
 });
 function raytrace(){return previewController.raytrace();}
 function blendedLandmarks(body){const a=Math.min(100,Math.max(0,state.mass??50))/50,b=Math.min(100,Math.max(0,state.muscle??50))/50,x=Math.min(1,Math.floor(a)),y=Math.min(1,Math.floor(b)),u=a-x,v=b-y,cs=[y*3+x,y*3+x+1,(y+1)*3+x,(y+1)*3+x+1],ws=[(1-u)*(1-v),u*(1-v),(1-u)*v,u*v],result={L:{},R:{}};for(const side of ['L','R'])for(const joint of ['shoulder','elbow','wrist','hip','knee','ankle'])result[side][joint]=[0,1,2].map(k=>cs.reduce((sum,c,i)=>sum+body.endpoints[c].landmarks[side][joint][k]*ws[i],0));return result;}
 function deform(body){
  const landmarks=blendedLandmarks(body);
  for(const part of [body,...body.accessories]){
   const source=part.shapeGrid?blendBodyShape(part.base,part.shapeGrid,state.mass??50,state.muscle??50):part.base;
   part.geometry.attributes.position.array.set(body.static?source:kernel.morph(source,state,part.weights,landmarks));
   part.geometry.attributes.position.needsUpdate=true;
   if(body.static&&part.data.normals?.length===part.base.length){
    part.geometry.attributes.normal.array.set(part.data.normals);
    part.geometry.attributes.normal.needsUpdate=true;part.geometry.computeBoundingSphere();continue;
   }
   part.geometry.computeVertexNormals();
   const n=part.geometry.attributes.normal,v=new THREE.Vector3(),sum=new THREE.Vector3();
   for(const indices of part.groups.values()){if(indices.length<2)continue;sum.set(0,0,0);for(const i of indices)sum.add(v.fromBufferAttribute(n,i));sum.normalize();for(const i of indices)n.setXYZ(i,sum.x,sum.y,sum.z);}
   n.needsUpdate=true;part.geometry.computeBoundingSphere();
  }
 }
 function fromHit(hit,g=active.geometry){const a=new THREE.Vector3().fromBufferAttribute(g.attributes.position,hit.face.a),b=new THREE.Vector3().fromBufferAttribute(g.attributes.position,hit.face.b),c=new THREE.Vector3().fromBufferAttribute(g.attributes.position,hit.face.c);return {faceIndex:hit.faceIndex,barycentric:THREE.Triangle.getBarycoord(hit.point,a,b,c,new THREE.Vector3()).toArray()};}
 function anchorFrame(anchor){const g=active.geometry,o=anchor?.faceIndex*3;if(!Number.isInteger(o)||o<0||o+2>=g.index.count||anchor.barycentric?.length!==3||!anchor.barycentric.every(Number.isFinite))return null;const point=new THREE.Vector3(),normal=new THREE.Vector3(),v=new THREE.Vector3();for(let k=0;k<3;k++){const i=g.index.getX(o+k);point.addScaledVector(v.fromBufferAttribute(g.attributes.position,i),anchor.barycentric[k]);normal.addScaledVector(v.fromBufferAttribute(g.attributes.normal,i),anchor.barycentric[k]);}normal.normalize();const up=new THREE.Vector3(0,1,0);if(Math.abs(normal.y)>.93)up.set(0,0,-1);up.addScaledVector(normal,-up.dot(normal)).normalize();return {point,normal,up,right:new THREE.Vector3().crossVectors(up,normal).normalize()};}
 function getAnchor(region){
  if(active.data.metadata.regionAnchors){return active.data.metadata.regionAnchors[region]||active.data.metadata.regionAnchors.leftUpperArm;}
  if(active.anchors.has(region))return active.anchors.get(region);
  const t=targets[region]||targets.leftUpperArm,target=new THREE.Vector3().fromArray(t),outward=new THREE.Vector3(0,0,region==='back'?-1:1);
  if(/UpperArm/.test(region))outward.set(Math.sign(t[0])*.6,0,1).normalize();if(/Foot/.test(region))outward.set(0,1,.25).normalize();
  raycaster.set(target.clone().addScaledVector(outward,1),outward.clone().negate());const hit=raycaster.intersectObject(active.referenceMesh)[0],anchor=hit?fromHit(hit,active.referenceMesh.geometry):null;active.anchors.set(region,anchor);return anchor;
 }
 // Keep the light's shadow capability stable: cached WebGPU material nodes
 // retain the same shadow map across unlit/inspection/studio round trips.
 function setLighting(mode){lightingDirty=true;lighting=['neutral','studio','albedo'].includes(mode)?mode:'studio';host.dataset.lighting=lighting;const studio=lighting==='studio';gallery.setMode(lighting);floor.visible=!studio;key.color.set(studio?(gallery.suggestedLighting?.keyColor??'#fffdf9'):'#ffffff');fill.color.set(studio?(gallery.suggestedLighting?.fillColor??'#f4f6fa'):'#ffffff');key.intensity=studio?(gallery.suggestedLighting?.keyIntensity??1.2):3.4;fill.intensity=studio?(gallery.suggestedLighting?.fillIntensity??.35):2.4;ambient.intensity=studio?(gallery.suggestedLighting?.ambientIntensity??.22):3;for(const body of bodies)body.mesh.material=lighting==='albedo'?referenceSkin:lighting==='neutral'?inspectionSkin:skin;requestRender();}

 async function getTexture(asset){const key=asset.url+'|'+!!asset.legacyWhite;if(!textures.has(key))textures.set(key,(async()=>{let t=await loader.loadAsync(asset.url);if(asset.legacyWhite){const c=document.createElement('canvas');c.width=t.image.width;c.height=t.image.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(t.image,0,0);const d=ctx.getImageData(0,0,c.width,c.height);for(let i=0;i<d.data.length;i+=4){const w=Math.min(d.data[i],d.data[i+1],d.data[i+2])/255;const x=Math.max(0,Math.min(1,(w-.78)/.2));d.data[i+3]*=1-x*x*(3-2*x);}ctx.putImageData(d,0,0);t.dispose();t=new THREE.CanvasTexture(c);}t.colorSpace=THREE.SRGBColorSpace;return t;})());return textures.get(key);}
 function removeDecal(id){const d=decals.get(id);if(d){scene.remove(d.mesh);d.mesh.geometry.dispose();d.mesh.material.dispose();decals.delete(id);}}
 async function update(body,tattoos=[],assets=[],selectedIds=[]){
 const updateStarted=performance.now();await cancelPreview();const token=++version;
 const catalog=resolveBodyModel(body),nextState={...BODY_DEFAULTS,...body,bodyModelId:catalog.id};
 const next=await library.load(catalog.id,nextState.body==='female'?'female':'male');if(token!==version||disposed)return;
 if(next.static)Object.assign(nextState,{stature:175.3,mass:50,muscle:50,build:0,shoulders:0,waist:0,hips:0,arms:0,legs:0,bust:0,abdomen:0,armsLeft:0,armsRight:0,legsLeft:0,legsRight:0});
 const bodyChanged=active!==next;state=nextState;active=next;controls.maxDistance=4.5*Math.max(1,state.stature/175.3);
 if(bodyChanged)lastAnchor=null;
 bodies.forEach(b=>{b.mesh.visible=b===active;for(const a of b.accessories)a.mesh.visible=b===active;});
 const shape=JSON.stringify([catalog.id,state.body,state.stature,state.mass??50,state.muscle??50,state.build,state.shoulders,state.waist,state.hips,state.arms,state.legs,state.bust,state.abdomen??0,state.armsLeft??0,state.armsRight??0,state.legsLeft??0,state.legsRight??0]);
 const shapeChanged=shape!==lastShape;if(shapeChanged){deform(active);gallery.updateBody?.(active.geometry);}
 skinColor.value.set(resolveSkinColor(state));
 active.mesh.material=lighting==='albedo'?referenceSkin:lighting==='neutral'?inspectionSkin:skin;

 if(skin.userData.body!==active.id){
 if(catalog.id===LEGACY_MODEL_ID&&state.body==='male'&&!anatomyNormal){const loadedNormal=await loader.loadAsync('./models/detail/Aksel_Skin_NRM.png');if(disposed){loadedNormal.dispose();return;}if(!anatomyNormal){anatomyNormal=own(loadedNormal);anatomyNormal.anisotropy=4;}else loadedNormal.dispose();if(token!==version)return;}
 const skinSample=active.texture?texture(active.texture,active.data.sourceUVs?attribute('sourceUV','vec2'):uv()).rgb:null;
 const luminance=skinSample?skinSample.dot(vec3(.2126,.7152,.0722)):float(.42);
 const detail=luminance.div(.35).clamp(.92,1.03),studioDetail=catalog.id==='atelier-v1'&&active.texture?skinSample.div(vec3(.48,.325,.235)).clamp(.75,1.2):luminance.div(.42).clamp(.88,1.08);
 const authored=active.data.metadata.sourceTexture===true&&active.texture;
 const albedo=authored?skinSample:skinColor.mul(detail),studioAlbedo=authored?skinSample:skinColor.div(skinColor.mul(.75).add(1)).mul(studioDetail);
 const diffuse=normalWorld.dot(vec3(-.4,.7,.65).normalize()).max(0).mul(.35).add(normalWorld.dot(vec3(.6,.3,-.7).normalize()).max(0).mul(.1)).add(.55);
 inspectionSkin.colorNode=albedo.mul(diffuse).mul(inkColor);
 skin.colorNode=studioAlbedo.mul(inkColor);
 albedoSkin.colorNode=skin.colorNode;
 referenceSkin.colorNode=(authored?albedo:skinColor).mul(inkColor);
 // Source luminance adds restrained variation to the skin's broad highlight.
 skin.roughnessNode=luminance.clamp(.25,.7).sub(.42).mul(.2).add(.51);roughnessSkin.colorNode=vec3(skin.roughnessNode);
 const normalTexture=active.normalTexture||(catalog.id===LEGACY_MODEL_ID&&state.body==='male'?anatomyNormal:null);
 const normalStrength=Math.max(0,Math.min(1,active.data.metadata.normalScale??.12));
 skin.normalMap=normalTexture;skin.normalScale.set(normalStrength,normalStrength);skin.normalNode=normalTexture?normalMap(texture(normalTexture).rgb,vec2(normalStrength)):bumpMap(active.heightTexture?texture(active.heightTexture).r:luminance,float(catalog.id==='atelier-v1'?.00008:.000025));
 skin.thicknessColorNode=(authored?albedo:skinColor).mul(vec3(1,.55,.42));
 skin.thicknessDistortionNode=float(.25);skin.thicknessAmbientNode=float(.01);skin.thicknessAttenuationNode=float(.045);skin.thicknessPowerNode=float(3);skin.thicknessScaleNode=float(1.2);
 skin.userData.body=active.id;for(const m of [skin,albedoSkin,roughnessSkin,referenceSkin,inspectionSkin])m.needsUpdate=true;
 }
 selected=new Set(selectedIds);const assetMap=new Map(assets.map(a=>[a.id,a]));const valid=tattoos.slice(0,16).filter(t=>t.visible!==false&&assetMap.has(t.assetId));const keep=new Set(valid.map(t=>t.id));for(const id of decals.keys())if(!keep.has(id))removeDecal(id);
 const pending=[];
 await Promise.all(valid.map(async(t,index)=>{const a=assetMap.get(t.assetId),signature=JSON.stringify([shape,t.assetId,t.region,t.placement,t.width,t.rotation,t.offsetX,t.offsetY,!!t.flip,a.url,a.width,a.height,!!a.legacyWhite]);if(decals.get(t.id)?.signature===signature){const decal=decals.get(t.id);decal.opacity.value=t.opacity??.88;decal.mesh.material.opacity=t.opacity??.88;decal.mesh.renderOrder=10+index;if(selected.has(t.id))lastAnchor=decal.anchor;return;}const map=await getTexture(a);if(token!==version)return;const anchor=t.placement||getAnchor(t.region);if(!anchorFrame(anchor))return;const w=Math.max(.5,+t.width||7)/100,aspect=(a.width||map.image.width)/(a.height||map.image.height);pending.push({t,index,map,signature,anchor,job:{id:t.id,anchor,width:w,height:w/aspect,rotation:THREE.MathUtils.degToRad(+t.rotation||0),offsetX:(+t.offsetX||0)/100,offsetY:(+t.offsetY||0)/100,flip:!!t.flip}});}));
 if(token!==version)return;
 const result=await surface.compute({id:active.id,...(shapeChanged?{positions:active.geometry.attributes.position.array,normals:active.geometry.attributes.normal.array,state}:{}),jobs:pending.map(item=>item.job),measure:shapeChanged});
 if(token!==version)return;
 lastShape=shape;
 if(result.measurements){measurements=result.measurements;options.onMeasurements?.(measurements);}
 const patches=new Map(result.patches.map(item=>[item.id,item.patch]));
 for(const {t,index,map,signature,anchor} of pending){const patch=patches.get(t.id);removeDecal(t.id);const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(patch.positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(patch.normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(patch.uvs,2));geometry.setAttribute('basePosition',new THREE.Float32BufferAttribute(patch.basePositions,3));geometry.setAttribute('clothingMask',new THREE.Float32BufferAttribute(patch.clothingMasks,1));geometry.setAttribute('torsoMask',new THREE.Float32BufferAttribute(patch.torsoMasks,1));geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(patch.indices),1));const p=geometry.attributes.position,n=geometry.attributes.normal;for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)+n.getX(i)*.00035,p.getY(i)+n.getY(i)*.00035,p.getZ(i)+n.getZ(i)*.00035);const mat=new THREE.MeshBasicNodeMaterial({map,toneMapped:false,transparent:true,opacity:t.opacity??.88,depthWrite:false,alphaTest:.01,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,premultipliedAlpha:true,blending:THREE.MultiplyBlending});const bounds=uv().x.greaterThanEqual(0).and(uv().x.lessThanEqual(1)).and(uv().y.greaterThanEqual(0)).and(uv().y.lessThanEqual(1));const opacity=uniform(t.opacity??.88);mat.opacityNode=bounds.select(opacity,0);const mesh=new THREE.Mesh(geometry,mat);mesh.visible=false;mesh.renderOrder=10+index;mesh.userData.tattooId=t.id;scene.add(mesh);decals.set(t.id,{mesh,signature,anchor,opacity,sourceFaceIndices:patch.sourceFaceIndices,warnings:patch.warnings||[]});if(selected.has(t.id))lastAnchor=anchor;}
 // Ink modifies albedo before the skin is lit. Keep the source patches for
 // picking and UV mapping; they never form a second visible surface.
 const focusIds=valid.filter(t=>selected.has(t.id)).map(t=>t.id);
 const nextInkSignature=JSON.stringify([active.id,valid.map(t=>[t.id,decals.get(t.id)?.signature,t.opacity??.88]),focusIds]);
 if(nextInkSignature!==inkSignature&&(valid.length||inkAtlas.texture)){
  await scheduler.flush();if(token!==version||disposed)return;
  // The stable texture changes before its GPU fence completes. Invalidate
  // now so an undo cannot mistake those in-flight pixels for the old bake.
  inkSignature='';
  const task=inkAtlas.update({bodyGeometry:active.geometry,decals:valid.map(t=>decals.get(t.id)).filter(Boolean),focusDecals:focusIds.map(id=>decals.get(id)).filter(Boolean)});inkTask=task;
  try{await task;if(token!==version||disposed)return;inkTexture.value=inkAtlas.texture;const detail=inkAtlas.detail;inkDetailEnabled.value=detail?1:0;inkDetailTexture.value=detail?.texture||whiteDetailInk;if(detail){inkDetailOffset.value.fromArray(detail.offset);inkDetailScale.value.fromArray(detail.scale);}inkSignature=nextInkSignature;}
  catch(error){inkTexture.value=whiteInk;inkDetailEnabled.value=0;inkSignature='';throw error;}
  finally{if(inkTask===task)inkTask=null;}
 }
 if(token===version){requestRender();await scheduler.flush();if(token!==version)return;await library.trim(active.id);host.dataset.loadedBodies=String(bodies.length);host.dataset.updateMs=(performance.now()-updateStarted).toFixed(1);host.dataset.surfaceBackend=surface.backend;}}
 function view(name,{immediate=false}={}){
  if(disposed)return;
  customCamera=false;viewName=name;
  let pose;
  if(['detail','arm','isolate'].includes(name)){
   const frame=anchorFrame(lastAnchor||decals.values().next().value?.anchor||getAnchor('leftUpperArm'));
   if(frame){const position=frame.point.clone().addScaledVector(frame.normal,.62);position.y+=.035;pose={target:frame.point.toArray(),position:position.toArray()};}
  }else{
   const frame=cameraView(name,{stature:state.stature,compact:name==='body'&&window.matchMedia(COMPACT_LAYOUT_QUERY).matches});
   pose=frame;
  }
  if(pose)cameraMotion.start(pose,{immediate});
 }
 listen(renderer.domElement,'pointerdown',e=>{if(!disposed){interruptCameraMotion();down=[e.clientX,e.clientY];}});listen(renderer.domElement,'pointerup',e=>{if(disposed||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);if(placing){const hit=raycaster.intersectObject(active.mesh)[0];if(hit){lastAnchor=fromHit(hit);options.onPlace?.(lastAnchor);}return;}const hit=raycaster.intersectObjects([...decals.values()].map(d=>d.mesh)).find(h=>h.uv&&h.uv.x>=0&&h.uv.x<=1&&h.uv.y>=0&&h.uv.y<=1);const bodyHit=raycaster.intersectObject(active.mesh)[0];if(hit&&(!bodyHit||hit.distance<=bodyHit.distance+.003)){lastAnchor=decals.get(hit.object.userData.tattooId).anchor;options.onSelect?.(hit.object.userData.tattooId,{additive:e.shiftKey||e.metaKey||e.ctrlKey});}});
 const observer=owned.observer=new ResizeObserver(resize);observer.observe(host);listen(document,'visibilitychange',requestRender);
 await update(state);view('body',{immediate:true});setLighting('studio');
 return {update,getAnchor,view,setLighting,raytrace,getMappingWarnings,getViewName:()=>viewName,refreshLayout:resize,getCaptureRegion:()=>captureRegion?{...captureRegion}:null,cancelRaytrace(){cancelPreview();scheduler.request();},setQuality(value){quality=['auto','efficient','high'].includes(value)?value:'auto';adaptive=createAdaptiveQuality({quality});return resize();},getMeasurements:()=>({...measurements}),setPlaceMode(v){placing=v;renderer.domElement.style.cursor=v?'crosshair':'grab';},snapshot:()=>previewController.snapshot(),getCamera(){return {position:camera.position.toArray(),target:controls.target.toArray()};},restoreCamera(v){cameraMotion.cancel();customCamera=true;viewName='custom';applyingCamera=true;try{if(restoreCameraPose(camera,controls,v))requestRender();}finally{applyingCamera=false;}},renderer,dispose};
 }catch(error){await dispose();throw error;}
}
