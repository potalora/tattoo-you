import * as THREE from 'three';
import {assertBakeUVs,expandPatchUVs,BAKE_PADDING_RADIUS,BAKE_PADDING_OFFSETS} from './uv-bake.js';
import {createGuidedDenoiser,verifiedOIDNLoader} from './denoise-preview.js';

const aborted=()=>new DOMException('Ray-traced preview cancelled.','AbortError');
// rAF can stop entirely in a hidden tab; the timer still lets cancellation clean up.
const nextFrame=()=>new Promise(resolve=>{
 let frame,timer;const done=()=>{cancelAnimationFrame(frame);clearTimeout(timer);resolve();};
 frame=requestAnimationFrame(done);timer=setTimeout(done,50);
});

function bakeGeometry(bodyMesh,decal){
 const source=decal.mesh.geometry,mapping=expandPatchUVs({bodyIndices:bodyMesh.geometry.index.array,bodyUVs:bodyMesh.geometry.attributes.uv.array,patchIndices:source.index.array,patchUVs:source.attributes.uv.array,sourceFaceIndices:decal.sourceFaceIndices});
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(mapping.positions,3));
 geometry.setAttribute('uv',new THREE.BufferAttribute(mapping.uvs,2));
 for(const name of ['basePosition','clothingMask','torsoMask']){
  const attribute=source.attributes[name];if(!attribute)continue;
  const values=new Float32Array(mapping.patchVertexIndices.length*attribute.itemSize);
  for(let i=0;i<mapping.patchVertexIndices.length;i++)for(let k=0;k<attribute.itemSize;k++)values[i*attribute.itemSize+k]=attribute.array[mapping.patchVertexIndices[i]*attribute.itemSize+k];
  geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
 }
 return geometry;
}

function linearBakeMaterial(source,ink=false){
 const material=source.clone();
 material.toneMapped=false;material.side=THREE.DoubleSide;material.depthTest=false;material.depthWrite=false;
 if(!ink){material.transparent=false;material.blending=THREE.NoBlending;}
 return material;
}

export function createUVBakeCamera({offset=[0,0],scale=[1,1]}={}){
 // WebGPU stores row zero at the top. Three r186 does not flip render-target
 // samples; the path tracer's atlas QuadMesh and compute sampler both use v=0
 // at the top. Put logical v=0 there when baking, without changing source UVs.
 const [x,y]=offset,[w,h]=scale;
 const camera=new THREE.OrthographicCamera(x,x+w,y,y+h,.1,10);camera.position.z=1;camera.updateMatrixWorld();return camera;
}

export function chooseBakeSizes({width=1024,memoryGB,maxTextureSize=4096}={}){
 const compact=width<=700||(Number.isFinite(memoryGB)&&memoryGB<=4);
 const limit=Math.max(1,Math.min(4096,maxTextureSize));
 return {albedoSize:Math.min(compact?2048:4096,limit),roughnessSize:Math.min(compact?512:1024,limit)};
}

export function chooseTraceScale({width,height,viewportWidth=1024,memoryGB}={}){
 const compact=viewportWidth<=700||(Number.isFinite(memoryGB)&&memoryGB<=4);
 return Math.min(1,(compact?768:1536)/Math.max(width,height),Math.sqrt((compact?768**2:2_000_000)/(width*height)));
}

/** Expand valid island-edge texels into gutters before bilinear atlas sampling.
 * A single temporary RGBA8 target bounds memory; opaque source pixels, ink and
 * roughness values are never blurred or overwritten. Both bake kinds use this.
 */
async function padBakeTarget(renderer,target,{check,resources}){
 const {Fn,If,ivec2,screenCoordinate,textureLoad,clamp}=await import('three/tsl');
 const scratch=new THREE.RenderTarget(target.width,target.height,{type:THREE.UnsignedByteType,depthBuffer:false});
 scratch.texture.colorSpace=THREE.LinearSRGBColorSpace;resources.add(scratch);
 const materials=[];
 try{
  for(const source of [target,scratch]){
   const material=new THREE.MeshBasicNodeMaterial();material.toneMapped=false;material.depthTest=false;material.depthWrite=false;material.blending=THREE.NoBlending;
   material.outputNode=Fn(()=>{
    const coord=ivec2(screenCoordinate.xy),value=textureLoad(source.texture,coord).toVar();
    If(value.a.lessThan(.5),()=>{
     for(const [dx,dy]of BAKE_PADDING_OFFSETS){
      const other=textureLoad(source.texture,clamp(coord.add(ivec2(dx,dy)),ivec2(0),ivec2(target.width-1,target.height-1)));
      If(value.a.lessThan(.5).and(other.a.greaterThanEqual(.5)),()=>{value.assign(other);});
     }
    });
    return value;
   })();
   materials.push(material);resources.add(material);
  }
  const quad=new THREE.QuadMesh(materials[0]);
  for(let pass=0;pass<BAKE_PADDING_RADIUS;pass++){
   check();quad.material=materials[pass%2];renderer.setRenderTarget(pass%2===0?scratch:target);quad.render(renderer);
  }
  // Eight passes finish back in the original target, keeping its texture identity.
  await renderer.backend.device.queue.onSubmittedWorkDone();check();
 }finally{
  // Wait for submitted reads before disposing the one temporary target on cancel.
  await renderer.backend.device.queue.onSubmittedWorkDone();
  scratch.dispose();resources.delete(scratch);for(const material of materials){material.dispose();resources.delete(material);}
 }
}

async function bakeAlbedo(renderer,{bodyMesh,albedoMaterial,decals,size=2048,bounds,check,resources}){
 if(!bodyMesh.geometry.index||!bodyMesh.geometry.attributes.uv)throw Error('Ray tracing requires the body’s original indexed UV geometry.');
 assertBakeUVs(bodyMesh.geometry.attributes.uv.array);
 // Albedo and roughness are bounded [0,1], and the tracer's atlas is RGBA8.
 // Spend memory on spatial ink detail instead of unused HDR precision here.
 const target=new THREE.RenderTarget(size,size,{type:THREE.UnsignedByteType,depthBuffer:false});
 target.texture.colorSpace=THREE.LinearSRGBColorSpace;
 target.texture.name='Tattoo and skin linear albedo bake';resources.add(target);
 const scene=new THREE.Scene(),geometry=bodyMesh.geometry.clone();resources.add(geometry);
 const bodyUVs=geometry.attributes.uv,positions=new Float32Array(bodyUVs.count*3);
 for(let i=0;i<bodyUVs.count;i++){positions[i*3]=bodyUVs.getX(i);positions[i*3+1]=bodyUVs.getY(i);}
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.computeBoundingSphere();
 const bodyMaterial=linearBakeMaterial(albedoMaterial);resources.add(bodyMaterial);
 const body=new THREE.Mesh(geometry,bodyMaterial);body.frustumCulled=false;scene.add(body);
 for(let i=0;i<decals.length;i++){
  const decal=decals[i];if(!decal.mesh.visible)continue;
  const patchGeometry=bakeGeometry(bodyMesh,decal),material=linearBakeMaterial(decal.mesh.material,true);resources.add(patchGeometry);resources.add(material);
  const patch=new THREE.Mesh(patchGeometry,material);patch.frustumCulled=false;patch.renderOrder=decal.mesh.renderOrder;scene.add(patch);
 }
 const camera=createUVBakeCamera(bounds);
 const prior={target:renderer.getRenderTarget(),toneMapping:renderer.toneMapping,autoClear:renderer.autoClear,clearColor:renderer.getClearColor(new THREE.Color()),clearAlpha:renderer.getClearAlpha()};
 try{
  check();renderer.setRenderTarget(target);renderer.toneMapping=THREE.NoToneMapping;renderer.autoClear=true;renderer.setClearColor(0,0);
  renderer.render(scene,camera);await renderer.backend.device.queue.onSubmittedWorkDone();check();
  renderer.autoClear=false;await padBakeTarget(renderer,target,{check,resources});
 }finally{
  renderer.setRenderTarget(prior.target);renderer.toneMapping=prior.toneMapping;renderer.autoClear=prior.autoClear;renderer.setClearColor(prior.clearColor,prior.clearAlpha);
 }
 // The tracer's atlas caches GPU textures by source version.
 target.texture.source.needsUpdate=true;
 return target.texture;
}

export function physicalMaterial(source,resources){
 const material=new THREE.MeshPhysicalMaterial();
 for(const key of ['color','vertexColors','roughness','metalness','ior','specularIntensity','specularColor','clearcoat','clearcoatRoughness','transmission','thickness','attenuationDistance','attenuationColor','map','normalMap','normalScale','roughnessMap','metalnessMap','emissive','emissiveIntensity','emissiveMap','side','alphaTest','opacity','transparent']){
  if(source?.[key]===undefined)continue;
  if(material[key]?.copy&&(source[key]?.isColor||source[key]?.isVector2))material[key].copy(source[key]);else material[key]=source[key];
 }
 // Basic eye/artwork materials still need a physically defined surface in the tracer.
 if(source?.roughness===undefined)material.roughness=.7;
 // The treatment room already contains baked radiance. Preserve that light
 // field instead of illuminating its shaded atlas a second time.
 if(source?.userData?.bakedRoom&&!source.userData.bakedFloor){material.color.setRGB(0,0,0);material.map=null;material.emissive.copy(source.color);material.emissiveMap=source.map;material.emissiveIntensity=1;}
 // The floor must receive real body occlusion in the still. Making it an
 // emitter would erase the person's ground shadow and make the feet float.
 if(source?.userData?.bakedFloor)material.roughness=.9;
 if(source?.userData?.traceGlass)Object.assign(material,source.userData.traceGlass);
 resources.add(material);return material;
}

// A light's target can live under a different transformed parent. Capture both
// as world-space objects so updating the isolated trace scene keeps its direction.
export function cloneTraceLight(source){
 const light=source.clone(false);source.matrixWorld.decompose(light.position,light.quaternion,light.scale);
 if(source.target&&light.target){
  source.target.getWorldPosition(light.target.position);
  light.target.quaternion.identity();light.target.scale.setScalar(1);
  light.target.updateMatrixWorld(true);
 }
 return light;
}

function captureScene({scene,bodyMesh,decals,environment,albedo,roughness,detail,resources}){
 scene.updateMatrixWorld(true);
 const captured=new THREE.Scene();captured.background=scene.background?.isColor?scene.background.clone():scene.background;
 captured.environment=environment||null;captured.environmentIntensity=scene.environmentIntensity;captured.environmentRotation.copy(scene.environmentRotation);
 const excluded=new Set(decals.map(d=>d.mesh));
 scene.traverseVisible(object=>{
  if(excluded.has(object)||object.userData.rasterOnly)return;
  if(object.isLight){if(object.userData.rasterOnly)return;const light=cloneTraceLight(object);captured.add(light);if(light.target)captured.add(light.target);return;}
  if(!object.isMesh)return;
  if(Array.isArray(object.material))throw Error('Ray-traced preview does not support multi-material scene meshes yet.');
  const geometry=object.geometry.clone();resources.add(geometry);
  const material=physicalMaterial(object.material,resources);
  if(object===bodyMesh){material.color.setRGB(1,1,1);material.map=albedo;material.transparent=false;material.opacity=1;material.alphaTest=0;if(roughness){material.roughness=1;material.roughnessMap=roughness;}}
  const addMesh=(g,m)=>{const mesh=new THREE.Mesh(g,m);mesh.matrix.copy(object.matrixWorld);mesh.matrixAutoUpdate=false;mesh.castShadow=object.castShadow;mesh.receiveShadow=object.receiveShadow;captured.add(mesh);};
  if(object===bodyMesh&&detail){
   // Generate the shared normal-map frame on the intact trace clone. Letting
   // the tracer derive tangents after partitioning changes boundary vertices.
   if(material.normalMap&&!geometry.attributes.tangent&&geometry.index&&geometry.attributes.position&&geometry.attributes.normal&&geometry.attributes.uv)geometry.computeTangents();
   const uv=geometry.attributes.uv,index=geometry.index,baseIndices=[],detailIndices=[];
   const [x,y]=detail.offset,[w,h]=detail.scale;
   // Whole original triangles are assigned exactly once. The focus window
   // already includes all selected tattoo triangles plus a white guard.
   for(let at=0;at<index.count;at+=3){
    const triangle=[index.getX(at),index.getX(at+1),index.getX(at+2)];
    const inside=triangle.every(i=>uv.getX(i)>=x&&uv.getX(i)<=x+w&&uv.getY(i)>=y&&uv.getY(i)<=y+h);
    (inside?detailIndices:baseIndices).push(...triangle);
   }
   if(detailIndices.length){
    const focusedGeometry=geometry.clone();focusedGeometry.setIndex(detailIndices);resources.add(focusedGeometry);
    const focusedMaterial=material.clone();resources.add(focusedMaterial);focusedMaterial.map=detail.albedo;
    // Only albedo uses local UVs. Normal and roughness maps retain their
    // original global UV coordinates and texture transforms.
    detail.albedo.repeat.set(1/w,1/h);detail.albedo.offset.set(-x/w,-y/h);detail.albedo.updateMatrix();
    addMesh(focusedGeometry,focusedMaterial);geometry.setIndex(baseIndices);
   }
  }
  if(!geometry.index||geometry.index.count)addMesh(geometry,material);
 });
 return captured;
}

/** Optional software-BVH path tracing on the actual WebGPU backend.
 * start() leaves the last traced image on the canvas. The caller resumes raster
 * rendering on interaction/cancellation and owns its ordinary scene resources.
 */
export async function createPathPreview(renderer){
 if(!renderer.backend?.isWebGPUBackend)throw Error('Ray-traced preview needs WebGPU. The interactive studio remains available with WebGL 2.');
 const {WebGPUPathTracer,OIDNDenoiser}=await import('./vendor/pathtracer.js');
 let generation=0,disposed=false,running=null,active=false,samples=0;
 const cancel=()=>{generation++;return running?.catch(()=>{});};
 async function run(options,token){
  const {scene,camera,bodyMesh,albedoMaterial,decals=[],environment,onProgress=()=>{},signal,roughnessMaterial,inkDetail}=options;
  const resources=new Set();let tracer,denoiser;active=true;samples=0;
  const started=performance.now(),check=()=>{if(disposed||token!==generation||signal?.aborted||document.hidden)throw aborted();};
  const progress=phase=>onProgress({phase,samples,elapsedMs:performance.now()-started});
  try{
   check();progress('baking');await nextFrame();check();
   const bakeSizes=chooseBakeSizes({width:renderer.domElement.clientWidth||renderer.domElement.width,memoryGB:globalThis.navigator?.deviceMemory,maxTextureSize:renderer.backend.device.limits.maxTextureDimension2D});
   const albedo=await bakeAlbedo(renderer,{bodyMesh,albedoMaterial,decals,size:bakeSizes.albedoSize,check,resources});
   const detail=inkDetail?{offset:inkDetail.offset,scale:inkDetail.scale,albedo:await bakeAlbedo(renderer,{bodyMesh,albedoMaterial,decals,size:bakeSizes.albedoSize,bounds:inkDetail,check,resources})}:null;
   const roughness=roughnessMaterial?await bakeAlbedo(renderer,{bodyMesh,albedoMaterial:roughnessMaterial,decals:[],size:bakeSizes.roughnessSize,check,resources}):null;
   progress('preparing');await nextFrame();check();
   if(environment?.mapping===THREE.CubeUVReflectionMapping)throw Error('Ray tracing needs the original HDR environment, rather than its PMREM raster texture.');
   const captured=captureScene({scene,bodyMesh,decals,environment,albedo,roughness,detail,resources});
   const capturedCamera=camera.clone();capturedCamera.updateMatrixWorld(true);
   tracer=new WebGPUPathTracer(renderer);tracer.maxBounces=5;tracer.maxSamples=32;tracer.frameBudget=262144;tracer.dynamicLowRes=false;tracer.renderDelay=0;tracer.fadeDuration=0;tracer.minSamples=1;
   // Desktop detail remains bounded to two megapixels; compact/low-memory
   // devices retain the smaller still. The existing time budget bounds work.
   tracer.renderScale=chooseTraceScale({width:renderer.domElement.width,height:renderer.domElement.height,viewportWidth:renderer.domElement.clientWidth,memoryGB:globalThis.navigator?.deviceMemory});
   tracer.setScene(captured,capturedCamera);check();
   const renderStarted=performance.now();let lastMeasure=0,minSamples=0;
   while(minSamples<32&&performance.now()-renderStarted<45000){
    check();tracer.renderSample();await renderer.backend.device.queue.onSubmittedWorkDone();check();
    if(performance.now()-lastMeasure>350){const counts=await tracer.getSampleCountsAsync();samples=counts.avg;minSamples=counts.min;lastMeasure=performance.now();progress('rendering');}
    await nextFrame();
   }
   check();const counts=await tracer.getSampleCountsAsync();samples=counts.avg;
   if(!(samples>0))throw Error('The GPU did not produce a ray-traced sample.');
   // Pause accumulation and explicitly filter even when the time budget ended
   // before every pixel reached maxSamples. Keep the raw still on any failure.
   tracer.pause=true;denoiser=createGuidedDenoiser(OIDNDenoiser,verifiedOIDNLoader);tracer.setDenoiser(denoiser);
   progress('denoising');const denoiseStarted=performance.now();
   try{denoiser.update(tracer.target);}catch(error){denoiser.fail(error);}
   while(!denoiser.complete&&!denoiser.error&&performance.now()-denoiseStarted<20000){
    check();tracer.renderSample();await renderer.backend.device.queue.onSubmittedWorkDone();check();await nextFrame();
   }
   check();const denoised=denoiser.complete;
   const denoiseWarning=denoised?null:(denoiser.error?.message||'Denoising exceeded its time budget; showing the raw traced image.');
   if(!denoised){tracer.setDenoiser(null);denoiser.reset();}
   tracer.renderSample();await renderer.backend.device.queue.onSubmittedWorkDone();check();
   progress('complete');return {samples,denoised,denoiseWarning};
  }finally{
   // Stop tiled work before freeing the baked maps or resuming the live studio.
   denoiser?.reset();if(denoiser)tracer?.setDenoiser(null);
   try{await renderer.backend.device.queue.onSubmittedWorkDone();}catch{/* Device loss still needs cleanup. */}
   try{denoiser?.dispose();tracer?.dispose();}finally{for(const resource of resources)resource.dispose();active=false;}
  }
 }
 return {
  async start(options){
   if(disposed)throw Error('Ray-traced preview has been disposed.');
   cancel();const token=generation;const prior=running;if(prior)await prior.catch(()=>{});
   if(token!==generation)throw aborted();
   const task=run(options,token);running=task;
   try{return await task;}finally{if(running===task)running=null;}
  },cancel,get active(){return active;},get samples(){return samples;},dispose(){disposed=true;cancel();}
 };
}
