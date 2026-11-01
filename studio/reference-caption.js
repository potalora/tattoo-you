// The image is a conversation reference. Keep all enabled tattoos and label
// bounded note excerpts explicitly instead of silently clipping export text.
export function referenceCrop(imageWidth,imageHeight,region){
 const width=Number.isFinite(imageWidth)&&imageWidth>0?Math.max(1,Math.floor(imageWidth)):1;
 const height=Number.isFinite(imageHeight)&&imageHeight>0?Math.max(1,Math.floor(imageHeight)):1;
 const full={x:0,y:0,width,height};
 if(!region||!['x','y','width','height'].every(key=>Number.isFinite(region[key]))||region.width<=0||region.height<=0)return full;
 const clamp=value=>Math.max(0,Math.min(1,value));
 const left=clamp(region.x),top=clamp(region.y),right=clamp(region.x+region.width),bottom=clamp(region.y+region.height);
 if(right<=left||bottom<=top)return full;
 // Normalize against the decoded capture, whose pixel size can differ from
 // CSS viewport dimensions. Outward rounding retains every clear edge pixel.
 const x=Math.floor(left*width),y=Math.floor(top*height);
 return {x,y,width:Math.ceil(right*width)-x,height:Math.ceil(bottom*height)-y};
}

export function referenceLines(study,regions,measure,width,{view,mappingWarnings=[]}={}){
 const notes=String(study.notes||'').trim(),excerpt=notes.length>1200;
 const paragraphs=[String(study.name||'Untitled study'),'Enabled tattoos (may be outside the current view):',...study.tattoos.filter(t=>t.visible).map(t=>`${t.name} ≈ ${t.width.toFixed(1)} cm · ${t.existing?'Existing':'New'} · ${t.region==='custom'?'Custom surface position':regions.find(r=>r.id===t.region)?.label||'Placement not specified'}`)];
 if(view)paragraphs.splice(1,0,'View: '+({body:'Orbit',side:'Side',front:'Front',back:'Back',left:'Left side',right:'Right side',detail:'Detail',custom:'Custom view'}[view]||view));
 for(const warning of new Set(mappingWarnings))paragraphs.push('Surface mapping limitation: '+warning);
 if(notes)paragraphs.push(excerpt?'Notes excerpt for your artist:':'Notes for your artist:',notes.slice(0,1200));
 if(excerpt)paragraphs.push('Full notes remain in your study.');
 paragraphs.push('tattoo you · Approximate placement reference. Confirm final fit with your artist.');
 const lines=[];
 for(const paragraph of paragraphs)for(const line of paragraph.split(/\r?\n/)){
  let current='';
  for(const word of line.split(/\s+/).filter(Boolean)){
   const next=current?current+' '+word:word;
   if(measure(next)<=width){current=next;continue;}
   if(current){lines.push(current);current='';}
   for(const character of word){if(current&&measure(current+character)>width){lines.push(current);current='';}current+=character;}
  }
  if(current)lines.push(current);
 }
 return lines;
}
