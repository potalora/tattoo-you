import * as THREE from 'three';
import {RectAreaLightTexturesLib} from './vendor/RectAreaLightTexturesLib.js';
import {HDRLoader} from './vendor/HDRLoader.js';
import {GLTFLoader} from './environment/atelier/gltf-loader.js';

// The atlases are embedded in this GLB; one asset revision refreshes all of them.
const asset=name=>new URL(`./environment/treatment-room/${name}?v=indirect-studio-2`,import.meta.url).href;
const walls={Room_BackWall:['z',-2.75,-1],Room_FrontWall:['z',2.6,1],Room_LeftWall:['x',-2.75,-1],Room_WindowGlass:['x',-2.75,-1],Room_RightWall:['x',2.75,1]};
const ceilingWalls={Room_CeilingRear:'Room_BackWall',Room_CeilingRight:'Room_RightWall'};
const furniture=/^Room_(Cabinetry|Supplies|TreatmentBed|Stool|ProcedureCart|TaskLight|Glass|GlassFrame|PlantBroadleaf|PlantPalm|PlantSculptural|FloorLampLeft|FloorLampRight)$/;

/** Baked radiance is displayed once; live lighting only shades the person. */
export function prepareTreatmentRoom(group){
 const oldMaterials=new Set(),materials=new Map();
 group.name='Tattoo treatment room';
 group.traverse(object=>{
  if(!object.isMesh)return;
  const source=object.material;if(Array.isArray(source))throw Error('Treatment room requires one material per mesh.');
  if(object.userData.roomGlass||object.name==='Room_Glass'){
   source.userData.roomGlass=true;source.userData.bakedRoom=false;
   // Thin architectural glass uses inexpensive alpha + specular in the live
   // view. Live transmission triggered destroyed-texture errors after a traced
   // preview in Three r186. Avoid that path and its extra full-frame pass.
   source.userData.traceGlass??={transmission:source.transmission,opacity:source.opacity,transparent:source.transparent};
   source.transmission=0;source.transparent=true;source.opacity=.22;source.color.set('#c1d3cd');source.roughness=.14;source.depthWrite=false;source.forceSinglePass=true;
   object.castShadow=false;object.receiveShadow=false;return;
  }
  if(!materials.has(source)){
   const material=new THREE.MeshBasicMaterial({map:source.map,color:source.color,toneMapped:false,side:THREE.FrontSide});
   material.name=source.name;material.userData.bakedRoom=true;material.userData.bakedFloor=object.name==='Room_Floor';materials.set(source,material);oldMaterials.add(source);
   if(material.map){material.map.colorSpace=THREE.SRGBColorSpace;material.map.anisotropy=4;}
  }
  object.material=materials.get(source);object.castShadow=false;object.receiveShadow=false;
 });
 for(const material of oldMaterials)material.dispose();
 group.updateMatrixWorld(true);
 // Cached world bounds avoid geometry raycasts in the interactive render loop.
 group.traverse(object=>{if(object.isMesh&&furniture.test(object.name))object.userData.occlusionBounds=new THREE.Box3().setFromObject(object);});
 // The captured pane and all three mounting channels cut away as one assembly.
 const glass=group.getObjectByName('Room_Glass'),frame=group.getObjectByName('Room_GlassFrame');
 if(glass&&frame){glass.userData.occlusionBounds.union(frame.userData.occlusionBounds);frame.userData.occlusionBounds=glass.userData.occlusionBounds;}
 return group;
}

const origin=new THREE.Vector3(),direction=new THREE.Vector3(),point=new THREE.Vector3(),hit=new THREE.Vector3(),ray=new THREE.Ray();
export function updateTreatmentView(group,camera,target=new THREE.Vector3(0,.85,0)){
 camera.getWorldPosition(origin);
 group.traverse(object=>{
  const ceilingWall=ceilingWalls[object.name];
  if(ceilingWall){const wall=walls[ceilingWall];object.visible=origin.y<2.65&&(wall[2]<0?origin[wall[0]]>wall[1]:origin[wall[0]]<wall[1]);return;}
  const wall=walls[object.name];
  if(wall){object.visible=wall[2]<0?origin[wall[0]]>wall[1]:origin[wall[0]]<wall[1];return;}
  const bounds=object.userData.occlusionBounds;if(!bounds)return;
  object.visible=true;
  // Only cut away furniture that actually sits in front of the working area.
  for(const [dx,dy] of [[0,0],[0,.55],[0,-.55],[-.28,0],[.28,0]]){
   point.copy(target).add(new THREE.Vector3(dx,dy,0));direction.subVectors(point,origin);const distance=direction.length();
   ray.set(origin,direction.normalize());
   if(ray.intersectBox(bounds,hit)&&hit.distanceTo(origin)<distance-.55){object.visible=false;break;}
  }
 });
}

export function environmentMetrics(group){
 const textures=new Set();let meshes=0,triangles=0;
 group.traverse(object=>{if(!object.isMesh)return;meshes++;triangles+=(object.geometry.index?.count||object.geometry.attributes.position.count)/3;for(const value of Object.values(object.material))if(value?.isTexture)textures.add(value);});
 const decodedTextureBytes=[...textures].reduce((sum,t)=>sum+(t.image?.width||0)*(t.image?.height||0)*4*4/3,0);
 return {meshes,triangles,textures:textures.size,decodedTextureBytes:Math.ceil(decodedTextureBytes)};
}

export function disposeAtelierGroup(group){
 const geometries=new Set(),materials=new Set(),textures=new Set();
 group.traverse(object=>{if(!object.isMesh)return;geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
 textures.forEach(texture=>texture.dispose());materials.forEach(material=>material.dispose());geometries.forEach(geometry=>geometry.dispose());
}

// A small local occlusion term grounds the feet on the baked floor. It follows
// actual sole bounds after morphing; the existing shadow map supplies direction.
export function createBodyContact(){
 const size=64,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const r=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2));
  data[(y*size+x)*4+3]=Math.round(255*Math.pow(Math.max(0,1-r*r),2));
 }
 const texture=new THREE.DataTexture(data,size,size);texture.needsUpdate=true;texture.magFilter=texture.minFilter=THREE.LinearFilter;
 const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,opacity:.26,toneMapped:false}),group=new THREE.Group();group.name='Sole contact occlusion';
 for(let i=0;i<2;i++){const plane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);plane.rotation.x=-Math.PI/2;plane.position.y=.002;plane.userData.rasterOnly=true;group.add(plane);}
 return {group,update(geometry){
  const p=geometry.attributes.position;let low=Infinity;
  for(let i=0;i<p.count;i++)low=Math.min(low,p.getY(i));
  const bounds=[new THREE.Box3(),new THREE.Box3()],v=new THREE.Vector3();
  for(let i=0;i<p.count;i++)if(p.getY(i)<low+.055){v.fromBufferAttribute(p,i);bounds[v.x<0?0:1].expandByPoint(v);}
  bounds.forEach((b,i)=>{const plane=group.children[i];plane.visible=!b.isEmpty()&&low<.08;if(!plane.visible)return;const center=b.getCenter(new THREE.Vector3()),span=b.getSize(new THREE.Vector3());plane.position.set(center.x,.002,center.z);plane.scale.set(Math.max(.09,span.x+.07),Math.max(.16,span.z+.09),1);});
 }};
}

/** Presentation changes room geometry only; inspection modes retain their contract. */
export function createGalleryPresentation(scene,group,room,{presentation='glass'}={}){
 const instrument=presentation==='instrument';
 if(instrument){
  // A flat live color remains seamless. In refined stills the existing physical
  // material adapter shades one continuous cyclorama instead of exposing the
  // horizon between a diffuse floor and an unlit scene background. Its circular
  // sweep keeps the same presentation through every orbit without moving it.
  const profile=[new THREE.Vector2(0,0),new THREE.Vector2(5,0)];
  for(let step=1;step<=24;step++){
   const angle=step/24*Math.PI/2;
   profile.push(new THREE.Vector2(5+3*Math.sin(angle),3*(1-Math.cos(angle))));
  }
  profile.push(new THREE.Vector2(8,10));
  // Top-to-center winding faces the enclosure inward and its floor upward.
  const geometry=new THREE.LatheGeometry(profile.reverse(),96);
  // Close the sweep exactly: sin(2π)'s tiny residual can leave a ray-visible
  // slit when a front/back camera lies precisely on the shared meridian.
  for(const attribute of [geometry.attributes.position,geometry.attributes.normal])for(let at=0;at<profile.length;at++){
   attribute.setXYZ(96*profile.length+at,attribute.getX(at),attribute.getY(at),attribute.getZ(at));
  }
  const ground=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#d9dcd5',toneMapped:false}));
  ground.name='Instrument seamless ground';ground.position.y=-.002;group.add(ground);
 }
 if(room)room.visible=!instrument;
 return {setMode(mode){
  const studio=mode==='studio';group.visible=studio;
  scene.environmentIntensity=studio?.42:0;
  scene.background=new THREE.Color(studio?(instrument?'#d9dcd5':'#bbbebc'):'#45423f');scene.fog=null;
 }};
}

export async function createGalleryEnvironment(renderer,scene,options={}){
 const resources=options.resources||{};
 const initializeAreaLights=resources.initializeAreaLights||(()=>{RectAreaLightTexturesLib.init();THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib);});
 const loadRoom=resources.loadRoom||(()=>new GLTFLoader().loadAsync(asset('treatment-room.glb')));
 const loadHDR=resources.loadHDR||(()=>new HDRLoader().loadAsync(new URL('./environment/studio_small_09_1k.hdr',import.meta.url).href));
 const filterHDR=resources.filterHDR||(raw=>{const generator=new THREE.PMREMGenerator(renderer);try{return generator.fromEquirectangular(raw);}finally{generator.dispose();}});
 initializeAreaLights();
 const group=new THREE.Group();scene.add(group);let raw,filtered,room;
 try{
  const needsRoom=options.presentation!=='instrument';
  const loaded=await Promise.allSettled([needsRoom?Promise.resolve().then(loadRoom):Promise.resolve(null),Promise.resolve().then(loadHDR)]);
  if(loaded[0].status==='fulfilled'&&loaded[0].value){room=loaded[0].value.scene;group.add(room);}
  if(loaded[1].status==='fulfilled')raw=loaded[1].value;
  const failed=loaded.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  if(room)prepareTreatmentRoom(room);
  const contact=createBodyContact();group.add(contact.group);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(6,7),new THREE.ShadowMaterial({color:'#151a20',opacity:.20}));
  shadow.name='Live body contact shadow';shadow.rotation.x=-Math.PI/2;shadow.position.y=.001;shadow.receiveShadow=true;shadow.userData.rasterOnly=true;group.add(shadow);
  // A broad key and a narrow white fill shape the body without changing the
  // authored bake. The fill keeps dark-skin contours readable in reflection.
  const lights=new THREE.Group();lights.name='Neutral treatment daylight';group.add(lights);
  for(const [color,intensity,width,height,x,y,z] of [['#fffdf9',3.0,3.2,3.6,-2.6,2.6,2.6],['#ffffff',1.6,.85,3.2,2.2,1.8,1.0]]){
   const light=new THREE.RectAreaLight(color,intensity,width,height);light.position.set(x,y,z);light.lookAt(0,1,0);lights.add(light);
  }
  raw.mapping=THREE.EquirectangularReflectionMapping;
  filtered=filterHDR(raw);
  scene.environment=filtered.texture;scene.environmentRotation.y=.65;
  const presentation=createGalleryPresentation(scene,group,room,options);
  let disposed=false;
  return {raw,group,metrics:environmentMetrics(group),suggestedLighting:{keyColor:'#fffdf9',fillColor:'#f4f6fa',keyIntensity:1.65,fillIntensity:.35,ambientIntensity:.32,keyPosition:[-2.4,3.2,2.6],keyTarget:[0,.9,0],shadowBounds:1.6},
   updateView(camera,target){if(room)updateTreatmentView(room,camera,target);},updateBody(geometry){contact.update(geometry);},
   setMode:presentation.setMode,
   dispose(){if(disposed)return;disposed=true;disposeAtelierGroup(group);scene.remove(group);if(scene.environment===filtered.texture)scene.environment=null;filtered.dispose();raw.dispose();}
  };
 }catch(error){disposeAtelierGroup(group);scene.remove(group);filtered?.dispose();raw?.dispose();throw error;}
}
