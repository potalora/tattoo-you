/** Shared semantic breakpoint: a short portrait is still a sheet. */
export const COMPACT_LAYOUT_QUERY = '(max-width: 700px) and (min-height: 501px), (max-width: 700px) and (orientation: portrait)';
export function isCompactLayout(width, height) { return width <= 700 && !(width > height && height <= 500); }
export function resolveTheme(search = '') { const theme = new URLSearchParams(search).get('theme'); return ['glass', 'precision', 'gallery', 'soft', 'instrument'].includes(theme) ? theme : 'instrument'; }
export function resolvePresentation(search = '') { return resolveTheme(search) === 'instrument' ? 'instrument' : 'glass'; }

// Geometry is measured from the floating controls, never stored in a study.
export function clearViewport({width,height,header,study,studyOnTop=false,panel,panelSide='left',dock,compact=false}){
 const gap=compact?10:16,edge=compact?10:20;
 const left=compact?edge:Math.max(edge,study&&!studyOnTop?study.right+24:edge,panel&&panelSide==='left'?panel.right+24:edge);
 const x=Math.min(left,width-1);
 const y=Math.min(Math.max(edge,(header?.bottom??0)+gap,(compact||studyOnTop)&&study?study.bottom+gap:edge),height-1);
 const right=Math.min(width-edge,!compact&&panel&&panelSide==='right'?panel.left-24:width-edge);
 const bottom=Math.min(height-edge,dock?.top==null?height-edge:dock.top-gap,compact&&panel?panel.top-gap:height-edge);
 return {x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)};
}

export function applyCameraViewport(camera,{width,height,clear,compact=false}){
 if(clear){
  // Begin with the unobstructed virtual view, then extend it to fill the canvas.
  // This shifts projection without moving OrbitControls' subject or saved camera.
  camera.zoom=Math.min(1.08,(clear.width/clear.height)/.58);
  camera.setViewOffset(clear.width,clear.height,-clear.x,-clear.y,width,height);
 }else{
  // The isolated renderer harness retains its original inset framing.
  camera.zoom=compact?.76:height<600?.8:1;
  camera.setViewOffset(width,height,0,compact?16:Math.min(40,height*.06),width,height);
 }
 camera.updateProjectionMatrix();
}

export function observeViewportLayout({root,host,header,study,panel,dock,dockGroup,status,onChange}){
 const measure=()=>{
  const origin=host.getBoundingClientRect();
  const bounds=element=>{if(!element?.getClientRects().length)return null;const r=element.getBoundingClientRect();return {top:r.top-origin.top,bottom:r.bottom-origin.top,left:r.left-origin.left,right:r.right-origin.left};};
  const headerBounds=bounds(header);
  // In-flow status belongs to the controls group. In short landscape the toast
  // is fixed above that group, so keep the subject below its visible lower edge.
  const fixedStatus=status&&status.dataset.idle!=='true'&&getComputedStyle(status).position==='fixed'?bounds(status):null;
  const topBoundary=Math.max(headerBounds?.bottom??0,fixedStatus?.bottom??0);
  const groupBounds=bounds(dockGroup)||bounds(dock);
  // The framed Instrument stage follows the same measured controls boundary
  // as the camera, including feedback that wraps at larger text sizes.
  root.style?.setProperty('--dock-live-height',`${groupBounds?groupBounds.bottom-groupBounds.top:0}px`);
  const absoluteStatus=status&&status.dataset.idle!=='true'&&getComputedStyle(status).position==='absolute'?bounds(status):null;
  const dockBounds=absoluteStatus?{top:Math.min(groupBounds?.top??Infinity,absoluteStatus.top)}:groupBounds;
  const compact=window.matchMedia(COMPACT_LAYOUT_QUERY).matches;
  // CSS owns the portrait-tablet rail breakpoint; measure the same visible
  // layout without keeping a second breakpoint table in camera code.
  const studyOnTop=compact||!!(study&&getComputedStyle(study).getPropertyValue('--study-rail').trim()==='1');
  return clearViewport({width:host.clientWidth,height:host.clientHeight,header:{bottom:topBoundary},study:bounds(study),studyOnTop,panel:bounds(panel),panelSide:panel?.dataset.panelSide||'left',dock:dockBounds,compact});
 };
 const resized=new ResizeObserver(onChange);[header,study,panel,dock,dockGroup,status].filter(Boolean).forEach(element=>resized.observe(element));
 // Panel position can change while its size stays the same; also support the
 // existing CSS-only theme comparison without remounting the renderer.
 const changed=new MutationObserver(onChange);changed.observe(panel,{attributes:true,attributeFilter:['class','data-panel-state','data-panel-side']});changed.observe(root,{attributes:true,attributeFilter:['data-theme']});
 if(study)changed.observe(study,{attributes:true,attributeFilter:['hidden','class','style']});
 if(status)changed.observe(status,{attributes:true,attributeFilter:['data-idle','hidden','class','style']});
 return {measure,dispose(){resized.disconnect();changed.disconnect();root.style?.removeProperty('--dock-live-height');}};
}
