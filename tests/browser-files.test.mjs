import test from 'node:test';
import assert from 'node:assert/strict';
import {raster} from '../studio/browser-files.js';

class DataURLReader{
 readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result=`data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload();},error=>{this.error=error;this.onerror();});}
}

test('upload rejects excessive PNG dimensions before allocating a URL or decoding', async () => {
  const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64'));
  new DataView(bytes.buffer).setUint32(16,32768);
  new DataView(bytes.buffer).setUint32(20,32768);
  // CRC from Python zlib for this modified IHDR; dimensions are the only invalid field.
  new DataView(bytes.buffer).setUint32(29,1260270632);
  const createURL = URL.createObjectURL;
  let allocated = false;
  URL.createObjectURL = () => { allocated=true; throw Error('Image reached decoder'); };
  try {
    await assert.rejects(raster(new Blob([bytes],{type:'image/png'})), /decoded pixels/);
    assert.equal(allocated,false);
  } finally { URL.createObjectURL=createURL; }
});

test('upload keeps 3440px source detail and bounds larger artwork at a 4096px long edge',async()=>{
 const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64'));
 const originalImage=globalThis.Image,originalDocument=globalThis.document,originalReader=globalThis.FileReader;
 globalThis.FileReader=DataURLReader;
 let dimensions=[3440,2448];
 // Native decode and canvas are the browser boundary; run the real upload pipeline.
 globalThis.Image=class{constructor(){[this.width,this.height]=dimensions;}async decode(){}};
 globalThis.document={createElement(){return {getContext(){return {drawImage(){},getImageData(){return {data:new Uint8Array([0,0,0,0])};}};},toDataURL(){return 'data:image/png;base64,';},toBlob(callback){callback(new Blob([bytes],{type:'image/png'}));}};}};
 try{
  for(const [input,want]of [[[3440,2448],[3440,2448]],[[5000,2500],[4096,2048]],[[1000,500],[1000,500]]]){
   dimensions=input;const result=await raster(new Blob([bytes],{type:'image/png'}));
   assert.deepEqual([result.width,result.height],want);
  }
 }finally{globalThis.Image=originalImage;globalThis.document=originalDocument;globalThis.FileReader=originalReader;}
});

test('unresized transparent WebP retains its validated bytes and MIME instead of expanding into PNG',async()=>{
 const encoded='UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',file=new Blob([Buffer.from(encoded,'base64')],{type:'image/webp'});
 const saved={Image:globalThis.Image,document:globalThis.document,FileReader:globalThis.FileReader};
 globalThis.Image=class{width=3000;height=3000;async decode(){}};globalThis.FileReader=DataURLReader;
 globalThis.document={createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8Array([0,0,0,0])})}),toDataURL:()=> 'data:image/png;base64,reencoded',toBlob(){throw Error('Original artwork should not be re-encoded');}})};
 try{const result=await raster(file);assert.equal(result.dataUrl,`data:image/webp;base64,${encoded}`);assert.deepEqual([result.width,result.height],[3000,3000]);}
 finally{Object.assign(globalThis,saved);}
});

test('resized artwork that encodes above the storage budget fails before it can be submitted',async()=>{
 const file=new Blob([Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==','base64')],{type:'image/webp'});
 const saved={Image:globalThis.Image,document:globalThis.document,FileReader:globalThis.FileReader};
 globalThis.Image=class{width=5000;height=2500;async decode(){}};globalThis.FileReader=DataURLReader;
 globalThis.document={createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8Array([0,0,0,0])})}),toDataURL:()=> 'data:image/png;base64,'+'A'.repeat(27_962_032),toBlob(callback){callback(new Blob([new Uint8Array(20*1024**2+1)],{type:'image/png'}));}})};
 try{await assert.rejects(raster(file),/processed.*20 MiB/i);}
 finally{Object.assign(globalThis,saved);}
});
