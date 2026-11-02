import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import postcss from 'postcss';
const sheets=await Promise.all(['studio.css','instrument.css'].map(async file=>postcss.parse(await readFile(new URL(`../studio/${file}`,import.meta.url),'utf8'))));
function matches(query,width,height){
 return query.split(',').some(part=>{
  if(/prefers-|pointer:|forced-colors/.test(part))return false;
  return [...part.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)].every(([,bound,axis,value])=>(bound==='min'? (axis==='width'?width:height)>=Number(value):(axis==='width'?width:height)<=Number(value))) &&
   (!part.includes('orientation: landscape')||width>height)&&(!part.includes('orientation: portrait')||width<=height);
 });
}
function applicable(rule,width,height){for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule'&&parent.name==='media'&&!matches(parent.params,width,height))return false;return true;}
function rootVariables(width,height){const result={};for(const sheet of sheets)sheet.walkRules(rule=>{if(rule.selector!=='html[data-theme=instrument]'||!applicable(rule,width,height))return;rule.walkDecls(decl=>{if(decl.prop.startsWith('--'))result[decl.prop]=decl.value;});});return result;}
function length(value,height){
 const source=value.replace(/([\d.]+)dvh/g,(_,number)=>String(Number(number)*height/100)).replace(/([\d.]+)px/g,'$1').replace(/calc\(/g,'(').replace(/min\(/g,'Math.min(').replace(/max\(/g,'Math.max(');
 assert.match(source,/^[\d\s.()+*,\-Mathminax]+$/);return Function(`return (${source})`)();
}
function statusPosition(width,height){const result={};for(const sheet of sheets)sheet.walkRules(rule=>{if(!rule.selector.includes('#status')||!applicable(rule,width,height))return;const selectors=rule.selector.split(',').filter(selector=>selector.includes('#status')&&(!selector.includes('[data-idle=true]')||selector.includes(':not([data-idle=true])')));if(!selectors.length)return;rule.walkDecls(decl=>result[decl.prop]=decl.value);});return result;}
test('short landscape actionable status resets inherited top and remains anchored above camera bank',()=>{
 for(const [width,height] of [[667,375],[700,375],[844,390]]){const status=statusPosition(width,height);assert.equal(status.position,'absolute');assert.equal(status.top,'auto',`${width} must reset shared fixed-toast top`);assert.equal(length(status.bottom,height),50);}
});
test('short portrait has distinct sheet stops and preserves usable display space at each stop',()=>{
 for(const [width,height] of [[390,460],[390,480],[320,568]]){
  const vars=rootVariables(width,height),normal=length(vars['--sheet-height'],height),expanded=Math.max(normal,length(vars['--expanded-height'],height)),collapsed=length(vars['--collapsed-height'],height);
  assert.ok(normal>collapsed);assert.ok(expanded>=normal+24,`${width}x${height}: Expand must enlarge controls`);
  const stageHeight=height-66-8;
  assert.ok(stageHeight-normal-60>=120,`${width}x${height}: normal retains useful canvas`);
  assert.ok(stageHeight-expanded-48>=120,`${width}x${height}: expanded retains useful canvas`);
 }
 const shortest=rootVariables(390,426);
 assert.ok(length(shortest['--expanded-height'],426)>=length(shortest['--sheet-height'],426)+24,'shorter portrait retains distinct sheet stops');
 for(const [width,height] of [[320,740],[390,844]]){const vars=rootVariables(width,height),expanded=length(vars['--expanded-height'],height);assert.ok(height-66-8-expanded-48>=220,'tall portrait adjustment keeps 220px display');}
});
