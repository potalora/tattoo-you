import * as THREE from 'three/webgpu';
import {Fn,If,ivec2,screenCoordinate,textureLoad,clamp} from 'three/tsl';
import {assertBakeUVs,expandPatchUVs,BAKE_PADDING_RADIUS,BAKE_PADDING_OFFSETS} from './uv-bake.js';

function atlasSize(renderer,requested){
 const width=renderer.domElement?.clientWidth||renderer.domElement?.width||1024;
 const memory=globalThis.navigator?.deviceMemory;
 const compact=width<=700||(Number.isFinite(memory)&&memory<=4);
 const gl=renderer.backend?.gl;
 const limit=renderer.backend?.device?.limits?.maxTextureDimension2D||
  (gl?gl.getParameter(gl.MAX_TEXTURE_SIZE):4096);
 if(requested!==undefined&&(!Number.isInteger(requested)||requested<1))throw new RangeError('Ink atlas size must be a positive integer.');
 return Math.max(1,Math.min(requested??(compact?2048:4096),4096,limit));
}

function makeTarget(size){
 const target=new THREE.RenderTarget(size,size,{type:THREE.UnsignedByteType,depthBuffer:false});
 target.texture.colorSpace=THREE.LinearSRGBColorSpace;
 target.texture.generateMipmaps=false;
 target.texture.name='Linear ink transmittance atlas';
 return target;
}

function bakeScene(bodyGeometry,decals,resources){
 if(!bodyGeometry?.index||!bodyGeometry.attributes?.uv)throw Error('Ink composition requires original indexed body UV geometry.');
 const bodyUVs=bodyGeometry.attributes.uv;
 assertBakeUVs(bodyUVs.array);
 const scene=new THREE.Scene(),geometry=new THREE.BufferGeometry();resources.add(geometry);
 const positions=new Float32Array(bodyUVs.count*3);
 for(let i=0;i<bodyUVs.count;i++){positions[i*3]=bodyUVs.getX(i);positions[i*3+1]=bodyUVs.getY(i);}
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
 geometry.setIndex(bodyGeometry.index.clone());
 const white=new THREE.MeshBasicNodeMaterial({color:0xffffff,toneMapped:false,side:THREE.DoubleSide,depthTest:false,depthWrite:false,blending:THREE.NoBlending});resources.add(white);
 const body=new THREE.Mesh(geometry,white);body.frustumCulled=false;scene.add(body);
 for(let i=0;i<decals.length;i++){
  const decal=decals[i],source=decal.mesh.geometry;
  const mapping=expandPatchUVs({bodyIndices:bodyGeometry.index.array,bodyUVs:bodyUVs.array,
   patchIndices:source.index.array,patchUVs:source.attributes.uv.array,sourceFaceIndices:decal.sourceFaceIndices});
  const patchGeometry=new THREE.BufferGeometry();resources.add(patchGeometry);
  patchGeometry.setAttribute('position',new THREE.BufferAttribute(mapping.positions,3));
  patchGeometry.setAttribute('uv',new THREE.BufferAttribute(mapping.uvs,2));
  const material=decal.mesh.material.clone();resources.add(material);
  material.toneMapped=false;material.side=THREE.DoubleSide;material.depthTest=false;material.depthWrite=false;
  // Input decals are the current visible layers. Their original mesh may be
  // hidden in the live scene because only this atlas now displays the ink.
  const patch=new THREE.Mesh(patchGeometry,material);patch.frustumCulled=false;patch.renderOrder=i+1;scene.add(patch);
 }
 return scene;
}

function padAtlas(renderer,target,resources){
 const scratch=makeTarget(target.width);resources.add(scratch);
 const materials=[target,scratch].map(source=>{
  const material=new THREE.MeshBasicNodeMaterial({toneMapped:false,depthTest:false,depthWrite:false,blending:THREE.NoBlending});resources.add(material);
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
  return material;
 });
 const quad=new THREE.QuadMesh(materials[0]);
 // The even pass count returns the padded result to the stable public target.
 for(let pass=0;pass<BAKE_PADDING_RADIUS;pass++){
  quad.material=materials[pass%2];renderer.setRenderTarget(pass%2===0?scratch:target);quad.render(renderer);
 }
}

/** Edit-time ink only: white leaves skin unchanged; RGB multiplies its linear
 * albedo. The caller owns renderer scheduling and must serialize this operation
 * with ordinary rendering and tracing. This object's own updates are queued.
 */
function createUVInkAtlas(renderer,{size}={}){
 let target=null,disposed=false,pending=Promise.resolve();
 const fence=async()=>{if(renderer.backend?.isWebGPUBackend)await renderer.backend.device.queue.onSubmittedWorkDone();};
 async function compose({bodyGeometry,decals=[],bounds={offset:[0,0],scale:[1,1]}}){
  if(disposed)throw Error('Ink atlas is disposed.');
  const resources=new Set();let prior=null,success=false,fenced=false,createdTarget=false;
  try{
   // Validate and build before allocating or modifying renderer state.
   const scene=bakeScene(bodyGeometry,decals,resources);
   if(!target){target=makeTarget(atlasSize(renderer,size));createdTarget=true;}
   // Put logical UV v=0 at the top on both backends. Three's TextureNode
   // already flips render-target samples on WebGL; changing this camera as
   // well would flip the atlas twice. Browser parity still needs pixel checks.
   const [x,y]=bounds.offset,[w,h]=bounds.scale;
   const camera=new THREE.OrthographicCamera(x,x+w,y,y+h,.1,10);camera.position.z=1;camera.updateMatrixWorld();
   prior={target:renderer.getRenderTarget(),toneMapping:renderer.toneMapping,autoClear:renderer.autoClear,
    clearColor:renderer.getClearColor(new THREE.Color()),clearAlpha:renderer.getClearAlpha()};
   renderer.setRenderTarget(target);renderer.toneMapping=THREE.NoToneMapping;renderer.autoClear=true;renderer.setClearColor(0,0);
   renderer.render(scene,camera);renderer.autoClear=false;padAtlas(renderer,target,resources);
   await fence();fenced=true;
   target.texture.source.needsUpdate=true;success=true;
   return target.texture;
  }finally{
   if(prior){
    renderer.setRenderTarget(prior.target);renderer.toneMapping=prior.toneMapping;renderer.autoClear=prior.autoClear;
    renderer.setClearColor(prior.clearColor,prior.clearAlpha);
    if(!fenced)await fence().catch(()=>{});
   }
   for(const resource of resources)resource.dispose();
   if(!success&&(prior||createdTarget)){target?.dispose();target=null;}
  }
 }
 return {
  get texture(){return target?.texture??null;},
  update(input){
   if(disposed)return Promise.reject(Error('Ink atlas is disposed.'));
   const task=pending.then(()=>compose(input));pending=task.catch(()=>{});return task;
  },
  dispose(){
   disposed=true;
   const task=pending.then(async()=>{await fence().catch(()=>{});target?.dispose();target=null;});
   pending=task.catch(()=>{});return task;
  },
 };
}

function focusBounds(bodyGeometry,decals){
 if(!decals.length)return null;
 const uv=bodyGeometry.attributes.uv,index=bodyGeometry.index;
 let left=1,bottom=1,right=0,top=0;
 for(const decal of decals)for(const face of decal.sourceFaceIndices)for(let k=0;k<3;k++){
  const vertex=index.getX(face*3+k),x=uv.getX(vertex),y=uv.getY(vertex);
  if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Focused ink requires valid body UV faces.');
  left=Math.min(left,x);bottom=Math.min(bottom,y);right=Math.max(right,x);top=Math.max(top,y);
 }
 if(right<=left||top<=bottom)return null;
 // Leave a white guard around the supporting triangles so bilinear sampling
 // cannot carry a cropped edge onto neighboring skin.
 const dx=(right-left)*.01,dy=(top-bottom)*.01;
 left=Math.max(0,left-dx);bottom=Math.max(0,bottom-dy);right=Math.min(1,right+dx);top=Math.min(1,top+dy);
 return {offset:[left,bottom],scale:[right-left,top-bottom]};
}

/** One full-body atlas plus one reusable local atlas. All visible layers are
 * composed into the local window, preserving their order and overlap. Detail
 * follows selection without allocating a texture per tattoo. */
export function createInkAtlas(renderer,{size,focusSize=size}={}){
 const base=createUVInkAtlas(renderer,{size}),focus=createUVInkAtlas(renderer,{size:focusSize});
 let detail=null,disposed=false,pending=Promise.resolve();
 return {
  get texture(){return base.texture;},
  get detail(){return detail;},
  update(input){
   if(disposed)return Promise.reject(Error('Ink atlas is disposed.'));
   const task=pending.then(async()=>{
    const bounds=focusBounds(input.bodyGeometry,input.focusDecals||[]);
    await base.update(input);
    if(bounds){await focus.update({...input,bounds});detail={texture:focus.texture,...bounds};}
    else detail=null;
    return base.texture;
   });
   pending=task.catch(()=>{detail=null;});return task;
  },
  dispose(){
   disposed=true;
   const task=pending.then(async()=>{await Promise.all([base.dispose(),focus.dispose()]);detail=null;});
   pending=task.catch(()=>{});return task;
  },
 };
}
