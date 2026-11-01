import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {createLocalApi} from '../studio/local-api.js';
import {project, addTattoo} from '../studio/model.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const image = overrides => ({name: 'Design', width: 1,height: 1,dataUrl: PNG,...overrides});
function fixture(indexedDB = new IDBFactory(), name = 'test') {
 const created = [], revoked = [];
 const browser = {decodeImage: async () => ({width: 1,height:1}), URL:{createObjectURL(blob){const url='blob:test-'+created.length;created.push({url,blob});return url;},revokeObjectURL(url){revoked.push(url);}}};
 const api=createLocalApi({indexedDB,name,browser});return {api,created,revoked,indexedDB,browser};
}
const save = async (api, p, revision) => api('workspace','PUT',{revision:revision ?? (await api('workspace')).revision,projects:[p],activeProjectId:p.id});

test('new device is empty, save commits and reopening preserves workspace and artwork', async () => {
 const f=fixture(); assert.deepEqual(await f.api('workspace'),{version:3,revision:0,projects:[],activeProjectId:null,assets:[]});
 const asset=await f.api('assets','POST',image()); const p=project('Saved');addTattoo(p,asset);
 const result=await save(f.api,p);assert.equal(result.revision,2); assert.equal(result.assets[0].url,asset.url);
 await f.api.close();assert.deepEqual(f.revoked,[asset.url]);
 const reopened=fixture(f.indexedDB); const current=await reopened.api('workspace'); assert.equal(current.projects[0].name,'Saved');assert.equal(current.assets[0].mime,'image/png');assert.equal(reopened.created[0].blob.size,68);
 await reopened.api.close();
});

test('version 3 export imports into a clean database, preserving metadata and bytes while ignoring URLs',async()=>{
 const f=fixture(); const asset=await f.api('assets','POST',image({legacyWhite:true}));const p=project('Portable');addTattoo(p,asset);await save(f.api,p);
 const backup=await f.api('backup');assert.equal(backup.assets[0].dataUrl,PNG);assert.equal(backup.assets[0].url,undefined);
 backup.assets[0].url='https://example.invalid/untrusted'; const next=fixture(new IDBFactory());const result=await next.api('restore','POST',{revision:0,backup});
 assert.equal(result.revision,1);assert.match(result.assets[0].url,/^blob:/); const roundtrip=await next.api('backup');assert.deepEqual({...roundtrip,revision:backup.revision},backupWithoutUrl(backup));
 await f.api.close();await next.api.close();
});
function backupWithoutUrl(value){const copy=structuredClone(value);for(const a of copy.assets)delete a.url;return copy;}

test('concurrent tab writes serialize revision checks and expose the winning saved state',async()=>{
 const db=new IDBFactory(),a=fixture(db),b=fixture(db); await Promise.all([a.api('workspace'),b.api('workspace')]);
 const outcomes=await Promise.allSettled([save(a.api,project('A')),save(b.api,project('B'))]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 const error=outcomes.find(x=>x.status==='rejected').reason;assert.equal(error.status,409);assert.equal(error.revision,1);assert.equal(error.workspace.projects.length,1);
 await a.api.close();await b.api.close();
});

test('malformed imports and missing references leave saved state and blob URLs untouched',async()=>{
 const f=fixture(),asset=await f.api('assets','POST',image());const p=project();addTattoo(p,asset);await save(f.api,p);const before=await f.api('backup');
 for(const change of [b=>{b.assets[0].dataUrl='data:image/png;base64,bm90LWltYWdl';},b=>{b.assets=[];},b=>{b.projects[0].body.skin='invalid';}]){const backup=structuredClone(before);change(backup);await assert.rejects(f.api('restore','POST',{revision:1,backup}));assert.deepEqual(await f.api('backup'),before);assert.deepEqual(f.revoked,[]);}
 await f.api.close();
});

test('referenced artwork cannot be removed, successful replacement revokes old URLs after commit',async()=>{
 const f=fixture(),asset=await f.api('assets','POST',image());const p=project();addTattoo(p,asset);await save(f.api,p);
 await assert.rejects(f.api('assets/'+asset.id,'DELETE'),e=>e.status===409);
 const backup={version:3,projects:[],activeProjectId:null,assets:[]};await f.api('restore','POST',{revision:2,backup});assert.deepEqual(f.revoked,[asset.url]);assert.equal((await f.api('workspace')).revision,3);
 await assert.rejects(f.api('assets/'+asset.id,'DELETE'),e=>e.status===404);await f.api.close();
});

test('quota error aborts an entire restore and keeps prior saved workspace available for export',async()=>{
 const f=fixture();const p=project('Keep');await save(f.api,p);const before=await f.api('backup');const original=IDBObjectStore.prototype.put;
 try{IDBObjectStore.prototype.put=function(value,...rest){if(this.name==='assets')throw new DOMException('full','QuotaExceededError');return original.call(this,value,...rest);};
 await assert.rejects(f.api('restore','POST',{revision:1,backup:{version:3,projects:[],activeProjectId:null,assets:[{...image(),id:'new',createdAt:'2026-10-11T12:00:00Z'}]}}),/storage.*full|quota/i);
 }finally{IDBObjectStore.prototype.put=original;}
 assert.deepEqual(await f.api('backup'),before);await f.api.close();
});

test('a transaction aborted after requests succeed is never reported as saved',async()=>{
 const f=fixture();await f.api('workspace');const original=IDBObjectStore.prototype.put;
 try{IDBObjectStore.prototype.put=function(value,...rest){const request=original.call(this,value,...rest);if(this.name==='workspace')request.addEventListener('success',()=>this.transaction.abort());return request;};await assert.rejects(save(f.api,project('Do not save')),/abort|not saved/i);
 }finally{IDBObjectStore.prototype.put=original;}
 assert.equal((await f.api('workspace')).revision,0);await f.api.close();
});

test('denied browser storage fails helpfully and never falls back to volatile persistence',async()=>{
 const f=fixture({open(){throw new DOMException('Denied','SecurityError');}});await assert.rejects(f.api('workspace'),/allow.*storage|storage.*blocked|storage.*denied/i);await f.api.close();
 const absent=createLocalApi({indexedDB:null});await assert.rejects(absent('workspace'),/storage.*unavailable|IndexedDB/i);await absent.close();
});

test('close revokes URLs once and rejects later calls',async()=>{const f=fixture();const a=await f.api('assets','POST',image());await f.api.close();await f.api.close();assert.deepEqual(f.revoked,[a.url]);await assert.rejects(f.api('workspace'),/closed/);});

async function editStoredFixture(indexedDB,mutate){
 const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('test',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{await new Promise((resolve,reject)=>{const tx=database.transaction(['workspace','assets'],'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);mutate(tx);});}finally{database.close();}
}

test('500-asset acceptance limit preserves existing oversized storage for reading, export and removal',async()=>{
 const f=fixture();await f.api('workspace');
 const bytes=Uint8Array.from(atob(PNG.split(',')[1]),c=>c.charCodeAt(0));
 await editStoredFixture(f.indexedDB,tx=>{for(let i=0;i<501;i++)tx.objectStore('assets').put({id:'old-'+i,name:'Old '+i,mime:'image/png',width:1,height:1,createdAt:'2026-10-11T12:00:00Z',legacyWhite:false,token:'old-'+i,blob:new Blob([bytes],{type:'image/png'})});});
 assert.equal((await f.api('workspace')).assets.length,501);assert.equal((await f.api('backup')).assets.length,501);
 await assert.rejects(f.api('assets','POST',image()),/500 assets/);await assert.rejects(save(f.api,project()),/500 assets/);
 await f.api('assets/old-500','DELETE');await f.api('assets/old-499','DELETE');await f.api('assets','POST',image());assert.equal((await f.api('workspace')).assets.length,500);await f.api.close();
});

test('tab reload reconciles remotely restored artwork URL tokens even if IDs and metadata match',async()=>{
 const db=new IDBFactory(),a=fixture(db),b=fixture(db);const original=await a.api('assets','POST',image());const backup=await a.api('backup');
 await b.api('restore','POST',{revision:backup.revision,backup});assert.deepEqual(a.revoked,[]);
 const latest=await a.api('workspace');assert.notEqual(latest.assets[0].url,original.url);assert.deepEqual(a.revoked,[]);await a.api.close();assert.equal(a.revoked.length,2);await b.api.close();
});

test('delete releases only its own blob URL and later reads keep remaining artwork URLs stable',async()=>{
 const f=fixture(),first=await f.api('assets','POST',image()),second=await f.api('assets','POST',image());
 await f.api('assets/'+first.id,'DELETE');assert.deepEqual(f.revoked,[first.url]);assert.equal((await f.api('workspace')).assets[0].url,second.url);await f.api.close();assert.deepEqual(f.revoked,[first.url,second.url]);
});

test('asynchronous image validation cannot persist changes to caller-owned restore data',async()=>{
 const f=fixture();let release;const gate=new Promise(resolve=>{release=resolve;});f.browser.decodeImage=async()=>{await gate;return {width:1,height:1};};
 const p=project('Original');const body={revision:0,backup:{version:3,projects:[p],activeProjectId:p.id,assets:[{...image(),id:'new',createdAt:'2026-10-11T12:00:00Z'}]}};
 const restoring=f.api('restore','POST',body);body.backup.projects[0].name='Changed later';body.backup.assets[0].name='Changed later';release();
 const result=await restoring;assert.equal(result.projects[0].name,'Original');assert.equal(result.assets[0].name,'Design');await f.api.close();
});

test('a newer database schema fails safely without deleting or migrating its contents',async()=>{
 const db=new IDBFactory();const database=await new Promise((resolve,reject)=>{const request=db.open('test',2);request.onupgradeneeded=()=>{request.result.createObjectStore('future').put('preserved','sentinel');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});database.close();
 const f=fixture(db);await assert.rejects(f.api('workspace'),/newer storage version/);await f.api.close();
 const check=await new Promise((resolve,reject)=>{const r=db.open('test',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const sentinel=await new Promise((resolve,reject)=>{const r=check.transaction('future').objectStore('future').get('sentinel');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});assert.equal(sentinel,'preserved');check.close();
});

test('open workspace exports its original artwork after another tab restores an empty workspace',async()=>{
 const db=new IDBFactory(),a=fixture(db),b=fixture(db);const asset=await a.api('assets','POST',image());const p=project('Open edits');addTattoo(p,asset);const captured=await save(a.api,p);
 await b.api('restore','POST',{revision:2,backup:{version:3,projects:[],activeProjectId:null,assets:[]}});
 await assert.rejects(save(a.api,p,1),e=>e.status===409);await a.api('workspace'); // workspace-sync conflict refresh
 assert.deepEqual(a.revoked,[]);captured.projects[0].notes='Unsaved open edits';
 const exported=await a.api.exportWorkspace(captured);assert.equal(exported.assets[0].dataUrl,PNG);assert.equal(exported.projects[0].notes,'Unsaved open edits');assert.equal(exported.revision,2);
 await a.api.close();await b.api.close();
});

test('captured URL version exports original bytes when another tab replaces the same artwork ID',async()=>{
 const replacement='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNg+A8AAQIBAEK+vGgAAAAASUVORK5CYII=';
 const db=new IDBFactory(),a=fixture(db),b=fixture(db);const asset=await a.api('assets','POST',image());const p=project();addTattoo(p,asset);const captured=await save(a.api,p);const backup=await b.api('backup');backup.assets[0].dataUrl=replacement;
 await b.api('restore','POST',{revision:2,backup});const latest=await a.api('workspace');assert.notEqual(latest.assets[0].url,asset.url);assert.deepEqual(a.revoked,[]);
 assert.equal((await a.api.exportWorkspace(captured)).assets[0].dataUrl,PNG);assert.equal((await a.api.exportWorkspace(latest)).assets[0].dataUrl,replacement);
 await a.api.close();assert.equal(a.revoked.length,2);await b.api.close();
});

test('artwork mutations advance restore freshness and return an adoptable save revision',async()=>{
 const db=new IDBFactory(),a=fixture(db),b=fixture(db); const before=await a.api('backup');
 const asset=await b.api('assets','POST',image()); assert.equal(asset.revision,1);
 await assert.rejects(a.api('restore','POST',{revision:0,backup:before}),e=>e.status===409);
 assert.equal((await b.api('backup')).assets[0].dataUrl,PNG);
 const saved=await save(b.api,project('Import owner'),asset.revision); assert.equal(saved.revision,2);
 const removed=await b.api('assets/'+asset.id,'DELETE'); assert.equal(removed.revision,3);
 await assert.rejects(a.api('restore','POST',{revision:2,backup:before}),e=>e.status===409);
 await save(b.api,saved.projects[0],removed.revision); await a.api.close();await b.api.close();
});

test('stale import and deletion preconditions preserve all existing artwork bytes',async()=>{
 const f=fixture(), first=await f.api('assets','POST',image({revision:0}));
 await assert.rejects(f.api('assets','POST',image({revision:0})),e=>e.status===409);
 await assert.rejects(f.api('assets/'+first.id,'DELETE',{revision:0}),e=>e.status===409);
 const current=await f.api('backup');assert.equal(current.revision,1);assert.equal(current.assets.length,1);assert.equal(current.assets[0].dataUrl,PNG);
 await f.api.close();
});
