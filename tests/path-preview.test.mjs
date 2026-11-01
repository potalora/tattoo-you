import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSurfacePatch} from '../studio/surface-map.js';
import * as THREE from 'three';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('traced architectural glass preserves transmission and attenuation',async()=>{
 const {physicalMaterial}=await import('../studio/path-preview.js');
 const source=new THREE.MeshPhysicalMaterial({transmission:1,thickness:.012,ior:1.45,roughness:.065,attenuationDistance:1.8,attenuationColor:'#d7e3de'}),resources=new Set();
 const target=physicalMaterial(source,resources);
 for(const key of ['transmission','thickness','ior','roughness','attenuationDistance'])assert.equal(target[key],source[key],key);
 assert.equal(target.attenuationColor.getHexString(),source.attenuationColor.getHexString());source.dispose();target.dispose();
});

test('trace restores physical glass from its inexpensive live-preview material',async()=>{
 const {prepareTreatmentRoom}=await import('../studio/gallery-environment.js'),{physicalMaterial}=await import('../studio/path-preview.js');
 const group=new THREE.Group(),source=new THREE.MeshPhysicalMaterial({transmission:1,ior:1.45}),glass=new THREE.Mesh(new THREE.BoxGeometry(),source);glass.name='Room_Glass';group.add(glass);
 prepareTreatmentRoom(group);assert.equal(source.transmission,0);
 const target=physicalMaterial(source,new Set());assert.equal(target.transmission,1);assert.equal(target.opacity,1);assert.equal(target.transparent,false);
 target.dispose();source.dispose();glass.geometry.dispose();
});

// Two adjacent triangles share physical positions, but their UV seam is split.
const positions=new Float32Array([0,0,0, 1,0,0, 0,1,0, 1,0,0, 1,1,0, 0,1,0]);
const indices=new Uint32Array([0,1,2, 3,4,5]);
const bodyUVs=new Float32Array([0,0, .25,0, 0,.25, .75,0, 1,.25, .75,.25]);

test('albedo bake accepts finite UV pairs including atlas boundaries without changing them',async()=>{
 const {assertBakeUVs}=await import('../studio/uv-bake.js');assert.equal(typeof assertBakeUVs,'function');
 for(const values of [[0,0,1,1,.5,.25],new Float32Array([0,1,1,0,.25,.5])]){const before=Array.from(values);assert.doesNotThrow(()=>assertBakeUVs(values));assert.deepEqual(Array.from(values),before);}
});

test('albedo bake rejects malformed nonfinite and out-of-atlas coordinates',async()=>{
 const {assertBakeUVs}=await import('../studio/uv-bake.js');assert.equal(typeof assertBakeUVs,'function');
 for(const values of [null,{},[],[0],[0,0,1],['0',0],[NaN,0],[0,Infinity],[-.001,0],[0,1.001],[8.94,3.96],new Float32Array([0,NaN])])assert.throws(()=>assertBakeUVs(values),/UV.*\[0, ?1\].*atlas/i);
});

test('actual albedo bake rejects unsupported body UVs before allocating GPU bake resources',async()=>{
 const {assertBakeUVs}=await import('../studio/uv-bake.js'),source=await readFile(new URL('../studio/path-preview.js',import.meta.url),'utf8'),start=source.indexOf('async function bakeAlbedo('),end=source.indexOf('\nexport function physicalMaterial(',start);let allocations=0;
 assert.ok(start>=0&&end>start);const context=vm.createContext({assertBakeUVs,THREE:{...THREE,RenderTarget:class{constructor(){allocations++;throw Error('GPU allocation reached');}}}});vm.runInContext(source.slice(start,end),context);
 const resources=new Set();await assert.rejects(context.bakeAlbedo({}, {bodyMesh:{geometry:{index:{},attributes:{uv:{array:new Float32Array([0,0,8.94,3.96])}}}},decals:[],resources}),/UV.*\[0, ?1\].*atlas/i);assert.equal(allocations,0);assert.equal(resources.size,0);
});

test('surface patch retains original face identity across welded UV seams',()=>{
 const patch=buildSurfacePatch({positions,indices,anchor:{faceIndex:0,barycentric:[.3,.3,.4]},width:3,height:3});
 assert.ok(patch.sourceFaceIndices instanceof Uint32Array,'source face mapping is present');
 assert.deepEqual([...patch.sourceFaceIndices],[0,1]);
 assert.equal(patch.sourceFaceIndices.length,patch.indices.length/3);
});

test('UV bake expands each source face corner instead of borrowing welded seam UVs',async()=>{
 const module=await import('../studio/uv-bake.js').catch(()=>({}));
 assert.equal(typeof module.expandPatchUVs,'function','UV bake mapping is available');
 const result=module.expandPatchUVs({bodyIndices:indices,bodyUVs,patchIndices:new Uint32Array([0,1,2,1,3,2]),patchUVs:new Float32Array([0,0,1,0,0,1,1,1]),sourceFaceIndices:new Uint32Array([0,1])});
 assert.deepEqual([...result.positions],[0,0,0,.25,0,0,0,.25,0,.75,0,0,1,.25,0,.75,.25,0]);
 assert.deepEqual([...result.uvs],[0,0,1,0,0,1,1,0,1,1,0,1]);
 assert.deepEqual([...result.patchVertexIndices],[0,1,2,1,3,2]);
});

test('UV bake rejects incomplete or out of range source face mappings',async()=>{
 const module=await import('../studio/uv-bake.js').catch(()=>({}));
 assert.equal(typeof module.expandPatchUVs,'function','UV bake mapping is available');
 const input={bodyIndices:indices,bodyUVs,patchIndices:new Uint32Array([0,1,2]),patchUVs:new Float32Array([0,0,1,0,0,1])};
 assert.throws(()=>module.expandPatchUVs({...input,sourceFaceIndices:new Uint32Array()}),RangeError);
 assert.throws(()=>module.expandPatchUVs({...input,sourceFaceIndices:new Uint32Array([2])}),RangeError);
});

test('optional ray tracing refuses a WebGL backend before loading GPU code',async()=>{
 const {createPathPreview}=await import('../studio/path-preview.js');
 await assert.rejects(createPathPreview({backend:{isWebGPUBackend:false}}),/needs WebGPU/);
});

test('captured direct light and target retain world direction under different parents',async()=>{
 const {cloneTraceLight}=await import('../studio/path-preview.js');
 assert.equal(typeof cloneTraceLight,'function');
 const scene=new THREE.Scene(),lightParent=new THREE.Group(),targetParent=new THREE.Group();
 lightParent.position.set(2,0,0);targetParent.position.set(4,-1,0);scene.add(lightParent,targetParent);
 const source=new THREE.DirectionalLight();source.position.set(1,2,3);source.target.position.set(0,2,1);lightParent.add(source);targetParent.add(source.target);scene.updateMatrixWorld(true);
 const captured=cloneTraceLight(source),destination=new THREE.Scene();destination.add(captured,captured.target);destination.updateMatrixWorld(true);
 assert.deepEqual(captured.position.toArray(),[3,2,3]);
 assert.deepEqual(captured.target.position.toArray(),[4,1,1]);
 assert.deepEqual(captured.target.getWorldPosition(new THREE.Vector3()).toArray(),[4,1,1]);
 assert.equal(source.target.parent,targetParent);
});

test('UV bake places logical v at the same top-down GPU row consumed by the tracer atlas',async()=>{
 const {createUVBakeCamera}=await import('../studio/path-preview.js');
 assert.equal(typeof createUVBakeCamera,'function');
 const camera=createUVBakeCamera();
 for(const [v,want] of [[0,0],[.25,.25],[1,1]]){
  const clip=new THREE.Vector3(.2,v,0).project(camera);
  const gpuRow=(1-clip.y)/2;
  assert.equal(gpuRow,want,`logical UV v=${v} must reach GPU row ${want}`);
 }
});

test('ink bake budgets retain desktop detail and reduce allocations on compact devices',async()=>{
 const {chooseBakeSizes}=await import('../studio/path-preview.js');
 assert.deepEqual(chooseBakeSizes({width:1200,memoryGB:8}),{albedoSize:4096,roughnessSize:1024});
 assert.deepEqual(chooseBakeSizes({width:430,memoryGB:8}),{albedoSize:2048,roughnessSize:512});
 assert.deepEqual(chooseBakeSizes({width:1200,memoryGB:4}),{albedoSize:2048,roughnessSize:512});
 assert.deepEqual(chooseBakeSizes({width:1200,maxTextureSize:1024}),{albedoSize:1024,roughnessSize:1024});
});

test('refined capture keeps focused albedo on its original body triangles without remapping normal or roughness UVs',async()=>{
 const api=await import('../studio/path-preview.js');
 const originalIndices=[...indices,0,3,4];
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(originalIndices);
 const uvs=new Float32Array([.6,.8,.7,.8,.6,.84,.1,.1,.2,.1,.1,.2]);geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.computeVertexNormals();
 const normal=new THREE.Texture(),base=new THREE.Texture(),focused=new THREE.Texture(),roughness=new THREE.Texture();
 const original=new THREE.MeshPhysicalMaterial({normalMap:normal}),body=new THREE.Mesh(geometry,original),scene=new THREE.Scene();scene.add(body);
 const intact=geometry.clone();intact.computeTangents();
 const resources=new Set();
 try{
  const source=await readFile(new URL('../studio/path-preview.js',import.meta.url),'utf8'),start=source.indexOf('function captureScene('),end=source.indexOf('/** Optional software-BVH',start);
  const context=vm.createContext({THREE,physicalMaterial:api.physicalMaterial,cloneTraceLight:api.cloneTraceLight});vm.runInContext(source.slice(start,end),context);
  const captured=context.captureScene({scene,bodyMesh:body,decals:[],albedo:base,roughness,detail:{albedo:focused,offset:[.59,.79],scale:[.12,.06]},resources});
  const baseMesh=captured.children.find(mesh=>mesh.material.map===base),detailMesh=captured.children.find(mesh=>mesh.material.map===focused);
  assert.ok(baseMesh&&detailMesh,'focused body triangles retain a separate high-resolution albedo map');
  assert.deepEqual([...baseMesh.geometry.index.array],[3,4,5,0,3,4],'triangles crossing the crop boundary remain on the global map');assert.deepEqual([...detailMesh.geometry.index.array],[0,1,2]);
  for(const mesh of [baseMesh,detailMesh]){
   assert.deepEqual([...mesh.geometry.attributes.uv.array],[...uvs]);
   assert.equal(mesh.material.normalMap,normal);assert.equal(mesh.material.roughnessMap,roughness);
   assert.ok(mesh.geometry.attributes.tangent,'both partitions inherit tangents from the intact body');
   assert.deepEqual([...mesh.geometry.attributes.tangent.array],[...intact.attributes.tangent.array]);
  }
  const sample=new THREE.Vector2(.65,.82).applyMatrix3(focused.matrix);
  assert.ok(Math.abs(sample.x-.5)<1e-8&&Math.abs(sample.y-.5)<1e-8);
  assert.deepEqual([...geometry.index.array],originalIndices,'capture leaves the interactive body intact');
  assert.equal(geometry.attributes.tangent,undefined,'trace tangent generation does not mutate the live body');
  assert.deepEqual(normal.matrix.elements,new THREE.Matrix3().elements);assert.deepEqual(roughness.matrix.elements,new THREE.Matrix3().elements);
 }finally{for(const resource of resources)resource.dispose();intact.dispose();geometry.dispose();original.dispose();for(const texture of [normal,base,focused,roughness])texture.dispose();}
});

test('refined detail bake camera uses the selected UV window at full bake resolution',async()=>{
 const {createUVBakeCamera}=await import('../studio/path-preview.js');
 const camera=createUVBakeCamera({offset:[.6,.8],scale:[.1,.04]});
 const corners=[[.6,.8,-1,1],[.7,.84,1,-1]];
 for(const [u,v,x,y]of corners){const point=new THREE.Vector3(u,v,0).project(camera);assert.ok(Math.abs(point.x-x)<1e-8&&Math.abs(point.y-y)<1e-8);}
});

test('the actual refined albedo bake allocates the full local target and waits for submitted pixels',async()=>{
 const api=await import('../studio/path-preview.js'),{assertBakeUVs}=await import('../studio/uv-bake.js');
 const source=await readFile(new URL('../studio/path-preview.js',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('function linearBakeMaterial('),source.indexOf('export function createUVBakeCamera('));
 const bake=source.slice(source.indexOf('async function bakeAlbedo('),source.indexOf('export function physicalMaterial('));
 let target=null,draw,release;const gate=new Promise(resolve=>release=resolve),prior={name:'prior'};
 const renderer={backend:{device:{queue:{onSubmittedWorkDone:()=>gate}}},toneMapping:THREE.NeutralToneMapping,autoClear:false,getRenderTarget:()=>target||prior,setRenderTarget:value=>target=value,getClearColor:out=>out.set('#123456'),getClearAlpha:()=>1,setClearColor(){},render(scene,camera){draw={scene,camera,target};}};
 const context=vm.createContext({THREE,assertBakeUVs,createUVBakeCamera:api.createUVBakeCamera,padBakeTarget:async()=>{}});vm.runInContext(helper+bake,context);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(bodyUVs,2));geometry.setIndex([...indices]);
 const material=new THREE.MeshBasicMaterial(),resources=new Set();let settled=false;
 try{
  const task=context.bakeAlbedo(renderer,{bodyMesh:{geometry},albedoMaterial:material,decals:[],size:4096,bounds:{offset:[.6,.8],scale:[.1,.04]},check(){},resources}).then(value=>{settled=true;return value;});
  await Promise.resolve();assert.equal(settled,false,'the cropped result cannot be consumed before GPU completion');
  assert.equal(draw.target.width,4096);assert.equal(draw.target.height,4096);
  const point=new THREE.Vector3(.65,.82,0).project(draw.camera);assert.ok(Math.abs(point.x)<1e-8&&Math.abs(point.y)<1e-8);
  release();const texture=await task;assert.equal(texture,draw.target.texture);assert.equal(target,prior);
 }finally{release();for(const resource of resources)resource.dispose();geometry.dispose();material.dispose();}
});

test('refined still retains desktop close-up pixels within a two-megapixel budget',async()=>{
 const {chooseTraceScale}=await import('../studio/path-preview.js');assert.equal(typeof chooseTraceScale,'function');
 assert.equal(chooseTraceScale({width:3072,height:1536,viewportWidth:1200}),.5);
 assert.equal(chooseTraceScale({width:3072,height:1536,viewportWidth:430}),.25);
 assert.equal(chooseTraceScale({width:3072,height:1536,viewportWidth:1200,memoryGB:4}),.25);
 assert.equal(chooseTraceScale({width:1000,height:600,viewportWidth:1200}),1);
 assert.ok(Math.abs(chooseTraceScale({width:2000,height:2000,viewportWidth:1200})-Math.sqrt(.5))<1e-10);
});

test('UV gutter padding prevents transparent-black bilinear seams and preserves tattoo/roughness values',async()=>{
 const {dilateBakePixels,BAKE_PADDING_RADIUS}=await import('../studio/uv-bake.js');
 // A narrow opaque UV island borders empty atlas texels. Its black end is ink,
 // not an empty pixel: alpha must determine validity, never RGB brightness.
 const width=25,height=3,pixels=new Uint8Array(width*height*4),set=(x,y,rgba)=>pixels.set(rgba,(y*width+x)*4);
 const skin=[180,116,82,255],ink=[0,0,0,255],roughness=[153,153,153,255];
 set(12,0,skin);set(12,1,ink);set(12,2,roughness);const before=pixels.slice(),padded=dilateBakePixels(pixels,width,height);
 assert.deepEqual(pixels,before,'source bake is retained');
 for(const [y,rgba]of [[0,skin],[1,ink],[2,roughness]]){
  assert.deepEqual([...padded.slice((y*width+12)*4,(y*width+13)*4)],rgba,'occupied sample unchanged');
  assert.deepEqual([...padded.slice((y*width+11)*4,(y*width+12)*4)],rgba,'adjacent gutter gets edge RGBA');
  // Actual bilinear weights at an island edge now see the same color on both sides.
  for(let c=0;c<3;c++)assert.equal(.25*padded[(y*width+11)*4+c]+.75*padded[(y*width+12)*4+c],rgba[c]);
 }
 assert.equal(padded[(1*width+12-BAKE_PADDING_RADIUS)*4+3],255,'bounded radius filled');
 assert.equal(padded[(1*width+12-BAKE_PADDING_RADIUS-1)*4+3],0,'padding does not fill the whole atlas');
 assert.throws(()=>dilateBakePixels(pixels,width,height,BAKE_PADDING_RADIUS+1),/budget/);
});

test('UV gutter padding treats valid black ink as opaque and does not join distant islands',async()=>{
 const {dilateBakePixels}=await import('../studio/uv-bake.js'),pixels=new Uint8Array(44*4);
 pixels.set([0,0,0,255],2*4);pixels.set([220,160,120,255],41*4);
 const padded=dilateBakePixels(pixels,44,1);
 assert.deepEqual([...padded.slice(0,4)],[0,0,0,255]);assert.deepEqual([...padded.slice(43*4,44*4)],[220,160,120,255]);
 assert.equal(padded[22*4+3],0,'large gutter stays empty');
});

test('trace capture preserves baked room radiance without lighting its atlas twice',async()=>{
 const THREE=await import('three'),{physicalMaterial}=await import('../studio/path-preview.js');
 const map=new THREE.Texture(),source=new THREE.MeshBasicMaterial({map,color:'#d0d0d0'}),resources=new Set();source.userData.bakedRoom=true;
 const material=physicalMaterial(source,resources);
 assert.equal(material.map,null);assert.equal(material.color.getHex(),0);assert.equal(material.emissiveMap,map);assert.equal(material.emissive.getHex(),source.color.getHex());assert.equal(material.emissiveIntensity,1);assert.ok(resources.has(material));
 source.userData.bakedFloor=true;const floor=physicalMaterial(source,resources);assert.equal(floor.emissiveMap,null);assert.equal(floor.map,map);assert.equal(floor.roughness,.9);floor.dispose();
 const ordinary=physicalMaterial(new THREE.MeshBasicMaterial({map}),resources);assert.equal(ordinary.map,map);assert.equal(ordinary.emissiveMap,null);
 material.dispose();ordinary.dispose();source.dispose();map.dispose();
});
