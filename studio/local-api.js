import {assetReferences, jsonBytes, validateAsset, validateBackup, validateStorageTotals, validateWorkspace} from './workspace-validation.js';
import {STORAGE_LIMITS} from './storage-limits.js';

const DATABASE_VERSION = 1;
const WORKSPACE_KEY = 'workspace';
const errorWithStatus = (message, status) => Object.assign(Error(message),{status});

function storageError(error) {
  if (error?.status) return error;
  if (error?.name === 'QuotaExceededError') return errorWithStatus('Device storage is full. Your saved workspace was preserved. Export a backup, free some storage or remove unused artwork, then retry.',507);
  if (['SecurityError','NotAllowedError'].includes(error?.name)) return errorWithStatus('Browser storage is blocked or denied. Allow site storage in your browser settings, then reload. Keep your open edits and export a backup if available.',503);
  if (error?.name === 'VersionError') return errorWithStatus('This workspace uses a newer storage version. Reload the latest Inkform version to open it safely.',503);
  if (error?.name === 'AbortError') return errorWithStatus('The storage transaction was aborted; changes were not saved. Your previous workspace is still available. Retry or export a backup.',503);
  if (['InvalidStateError','UnknownError'].includes(error?.name)) return errorWithStatus('Browser storage is unavailable. Your edits are still open. Export a backup, check site storage settings, and retry.',503);
  return error;
}

/**
 * Device-local implementation of the private server's api(path, method, body).
 * No network or localStorage fallback: a successful write means IndexedDB committed.
 * Pass browser.decodeImage(blob) only in tests; production uses the native decoder.
 */
export function createLocalApi({indexedDB = globalThis.indexedDB, name = 'inkform-public-v1', browser = {}} = {}) {
  const URL = browser.URL || globalThis.URL;
  const uuid = () => (browser.crypto || globalThis.crypto).randomUUID();
  const urls = new Map();
  // A conflict refresh can discover new saved artwork while the editor still
  // holds the previous version. Keep those exact Blob/URL versions exportable.
  const versions = new Map();
  let databasePromise, database, closed = false;

  function revokeAll() {
    for (const url of versions.keys()) URL.revokeObjectURL(url);
    urls.clear();
    versions.clear();
  }
  function ensureOpen() {
    if (closed) throw errorWithStatus('This workspace connection is closed. Reload to open the saved workspace.',503);
  }
  function open() {
    ensureOpen();
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve,reject) => {
      if (!indexedDB?.open) {reject(errorWithStatus('IndexedDB device storage is unavailable in this browser. Use a browser that allows site storage.',503)); return;}
      let request, failed = false;
      const fail = error => {failed = true; reject(storageError(error));};
      try {request = indexedDB.open(name,DATABASE_VERSION);} catch (error) {fail(error); return;}
      request.onupgradeneeded = event => {
        // Explicit migrations only. Never reset or overwrite a pre-existing schema.
        if (event.oldVersion !== 0) {request.transaction.abort(); return;}
        const db = request.result;
        const workspace = db.createObjectStore('workspace',{keyPath:'id'});
        db.createObjectStore('assets',{keyPath:'id'});
        workspace.put({id:WORKSPACE_KEY,revision:0,projects:[],activeProjectId:null});
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(errorWithStatus('Workspace storage is waiting for another tab. Close other Inkform tabs, then reload to finish opening it.',503));
      request.onsuccess = () => {
        const db = request.result;
        if (closed || failed) {db.close(); if (!failed) fail(errorWithStatus('This workspace connection is closed.',503)); return;}
        if (!db.objectStoreNames.contains('workspace') || !db.objectStoreNames.contains('assets')) {db.close(); fail(errorWithStatus('Unrecognized workspace storage schema. Saved data has been preserved; reload the latest Inkform version.',503)); return;}
        database = db;
        db.onversionchange = () => {closed = true; db.close(); revokeAll();};
        resolve(db);
      };
    });
    return databasePromise;
  }

  async function transaction(mode, work, catalogId) {
    const db = await open();
    ensureOpen();
    return new Promise((resolve,reject) => {
      let tx, result, failure;
      try {tx = db.transaction(['workspace','assets'],mode);} catch (error) {reject(storageError(error)); return;}
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(storageError(failure || tx.error || new DOMException('Aborted','AbortError')));
      // IndexedDB errors bubble to the transaction. Let the default action abort;
      // resolving/rejecting before oncomplete/onabort would misreport durability.
      tx.onerror = () => {};
      const stores = {workspace:tx.objectStore('workspace'), assets:tx.objectStore('assets')};
      const stateRequest = stores.workspace.get(WORKSPACE_KEY), assetsRequest = stores.assets.getAll();
      const catalogRequest = catalogId ? stores.workspace.get('catalog:' + catalogId) : null;
      let ready = 0;
      const run = () => {
        if (++ready !== (catalogRequest ? 3 : 2)) return;
        try {
          const state = stateRequest.result;
          if (!state || !Number.isSafeInteger(state.revision) || !Array.isArray(state.projects)) throw errorWithStatus('Workspace storage is not recognized. Saved data has been preserved; export it using the original Inkform version.',503);
          const assets = assetsRequest.result.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
          result = work(state,assets,stores,catalogRequest?.result);
        } catch (error) {failure = error; tx.abort();}
      };
      stateRequest.onsuccess = run;
      assetsRequest.onsuccess = run;
      if (catalogRequest) catalogRequest.onsuccess = run;
    });
  }

  function assetMetadata(asset, withUrl = true) {
    const {id,name,mime,width,height,createdAt,legacyWhite} = asset;
    const result = {id,name,mime,width,height,createdAt,legacyWhite};
    if (withUrl) {
      ensureOpen();
      let cached = urls.get(id);
      if (!cached || cached.token !== asset.token) {
        cached = {token:asset.token,url:URL.createObjectURL(asset.blob)};
        urls.set(id,cached);
        versions.set(cached.url,asset);
      }
      result.url = cached.url;
    }
    return result;
  }
  function snapshot(state,assets) {return {version:3,revision:state.revision,projects:state.projects,activeProjectId:state.activeProjectId,assets};}
  function present(raw) {
    ensureOpen();
    const ids = new Set(raw.assets.map(asset => asset.id));
    // Removing a current-cache entry must not invalidate a URL still held by
    // an open editor after another tab deleted/replaced its saved artwork.
    for (const id of urls.keys()) if (!ids.has(id)) urls.delete(id);
    return {...raw,assets:raw.assets.map(asset => assetMetadata(asset))};
  }
  function checkRevision(value,state,assets) {
    if (!Number.isSafeInteger(value?.revision) || value.revision !== state.revision) {
      const error = errorWithStatus('Workspace revision conflict',409);
      error.revision = state.revision;
      // Materialize after the aborted transaction, so a failed write cannot
      // change URLs belonging to the caller's currently open workspace.
      error.savedSnapshot = snapshot(state,assets);
      throw error;
    }
  }
  async function backup(raw) {
    const assets = [];
    for (const asset of raw.assets) {
      const bytes = new Uint8Array(await asset.blob.arrayBuffer());
      // Bound the spread call while avoiding a FileReader/dataURL dependency.
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i,i + 0x8000)));
      assets.push({...assetMetadata(asset,false),dataUrl:'data:' + asset.mime + ';base64,' + (browser.btoa || globalThis.btoa)(chunks.join(''))});
    }
    return {...raw,assets};
  }

  async function api(path, method = 'GET', body) {
    try {
      ensureOpen();
      path = String(path).replace(/^\/api\//,'').replace(/^\//,'');
      method = method.toUpperCase();
      // Isolate caller-owned state before asynchronous image decoding begins.
      const value = body === undefined ? undefined : structuredClone(body);
      if (method === 'GET' && (path === 'workspace' || path === 'backup')) {
        const raw = await transaction('readonly',(state,assets) => snapshot(state,assets));
        return path === 'backup' ? await backup(raw) : present(raw);
      }
      if (path.startsWith('catalog/') && ['GET','POST'].includes(method)) {
        const id = path.slice(8);
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw errorWithStatus('Invalid personal catalog id',400);
        if (method === 'GET') return transaction('readonly', (state,assets,stores,marker) => ({applied:marker?.applied === true}),id);
        if (!Array.isArray(value?.projectIds) || !value.projectIds.length || value.projectIds.length > STORAGE_LIMITS.maxProjects || value.projectIds.some(projectId => typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) || new Set(value.projectIds).size !== value.projectIds.length) throw errorWithStatus('Personal catalog requires unique project ids',400);
        if (jsonBytes(value) > STORAGE_LIMITS.maxRestoreBytes) throw errorWithStatus('Workspace import exceeds the 160 MiB restore envelope.',413);
        const imported = await validateBackup(value.backup,{browser});
        const selected = new Set(value.projectIds);
        if (value.projectIds.some(projectId => !imported.projects.some(project => project.id === projectId))) throw errorWithStatus('Personal catalog project is missing from its seed',400);
        const raw = await transaction('readwrite',(state,assets,stores,marker) => {
          // The marker and additions commit together. Competing tabs recheck it
          // after image decoding, against the latest committed user work.
          if (marker?.applied === true) return snapshot(state,assets);
          const pristine = state.revision === 0 && !state.projects.length && !assets.length;
          const existingIds = new Set(state.projects.map(project => project.id));
          const additions = imported.projects.filter(project => pristine || (selected.has(project.id) && !existingIds.has(project.id)));
          const references = new Set(assetReferences(additions));
          const assetIds = new Set(assets.map(asset => asset.id));
          const addedAssets = imported.assets.filter(asset => !assetIds.has(asset.id) && (pristine || references.has(asset.id))).map(asset => ({...asset,token:uuid()}));
          const nextAssets = [...assets,...addedAssets];
          const next = validateWorkspace({projects:[...state.projects,...additions],activeProjectId:pristine ? imported.activeProjectId : state.activeProjectId},new Set(nextAssets.map(asset => asset.id)));
          validateStorageTotals(nextAssets);
          // Existing artwork wins an id collision, including its exact bytes,
          // metadata and Blob URL. Never clear either object store here.
          for (const asset of addedAssets) stores.assets.add(asset);
          const nextState = {...state,...next,revision:state.revision + 1};
          stores.workspace.put(nextState);
          // A separate row also survives saves from an older already-open tab.
          stores.workspace.put({id:'catalog:' + id,applied:true});
          return snapshot(nextState,nextAssets);
        },id);
        return present(raw);
      }
      if (method === 'POST' && path === 'assets') {
        const asset = {...await validateAsset(value,{browser}),token:uuid()};
        const revision = await transaction('readwrite',(state,assets,stores) => {
          if (value.revision !== undefined) checkRevision(value,state,assets);
          validateStorageTotals([...assets,asset]);
          // Existing oversized states remain readable/exportable; additions
          // must fit the same portable-state budget as workspace saves.
          validateWorkspace(state,new Set(assets.map(asset => asset.id)));
          stores.assets.add(asset);
          stores.workspace.put({...state,revision:state.revision + 1});
          return state.revision + 1;
        });
        return {...assetMetadata(asset),revision};
      }
      if (method === 'DELETE' && path.startsWith('assets/')) {
        const id = path.slice(7);
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw errorWithStatus('Invalid asset id',400);
        const revision = await transaction('readwrite',(state,assets,stores) => {
          if (value?.revision !== undefined) checkRevision(value,state,assets);
          if (!assets.some(asset => asset.id === id)) throw errorWithStatus('Asset not found',404);
          if ([...assetReferences(state.projects)].includes(id)) throw errorWithStatus('Asset is referenced by a project',409);
          stores.assets.delete(id);
          stores.workspace.put({...state,revision:state.revision + 1});
          return state.revision + 1;
        });
        for (const [url,asset] of versions) if (asset.id === id) {URL.revokeObjectURL(url); versions.delete(url);}
        urls.delete(id);
        return {deleted:id,revision};
      }
      if ((method === 'PUT' && path === 'workspace') || (method === 'POST' && path === 'restore')) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw errorWithStatus('Request must be an object',400);
        let imported;
        if (path === 'restore') {
          if (jsonBytes(value) > STORAGE_LIMITS.maxRestoreBytes) throw errorWithStatus('Workspace import exceeds the 160 MiB restore envelope.',413);
          imported = await validateBackup(value.backup,{browser});
          imported.assets = imported.assets.map(asset => ({...asset,token:uuid()}));
        }
        const raw = await transaction('readwrite',(state,assets,stores) => {
          checkRevision(value,state,assets);
          if (imported && value.onlyIfEmpty === true && (state.revision !== 0 || state.projects.length || assets.length)) {
            throw errorWithStatus('Workspace already contains saved work',409);
          }
          const nextAssets = imported ? imported.assets : assets;
          const next = imported || validateWorkspace(value,new Set(assets.map(asset => asset.id)));
          validateStorageTotals(nextAssets);
          if (imported) {
            stores.assets.clear();
            for (const asset of imported.assets) stores.assets.put(asset);
          }
          const nextState = {id:WORKSPACE_KEY,revision:state.revision + 1,projects:next.projects,activeProjectId:next.activeProjectId};
          stores.workspace.put(nextState);
          return snapshot(nextState,nextAssets);
        });
        if (path === 'restore') revokeAll();
        return present(raw);
      }
      throw errorWithStatus('Not found',404);
    } catch (error) {
      if (error.savedSnapshot) {
        // Attach the same useful conflict payload as Python without introducing
        // replacement URLs into a failed operation's active workspace.
        error.workspace = {...error.savedSnapshot,assets:error.savedSnapshot.assets.map(asset => assetMetadata(asset,false))};
        delete error.savedSnapshot;
      }
      throw storageError(error);
    }
  }

  /** Export open edits with their exact session artwork, even after conflicts. */
  api.exportWorkspace = async capturedWorkspace => {
    ensureOpen();
    const captured = structuredClone(capturedWorkspace);
    if (!captured || !Array.isArray(captured.projects) || !Array.isArray(captured.assets)) throw errorWithStatus('Capture the open workspace before exporting it.',400);
    const assets = captured.assets.map(metadata => {
      const asset = versions.get(metadata.url);
      if (!asset || asset.id !== metadata.id) throw errorWithStatus('An open artwork version is no longer available in this tab. Your edits are still open; export before replacing or reloading the workspace.',409);
      return asset;
    });
    const ids = new Set(assets.map(asset => asset.id));
    for (const reference of assetReferences(captured.projects)) if (!ids.has(reference)) throw errorWithStatus('The open study refers to missing artwork. Keep this tab open and recover the artwork before exporting.',409);
    // Read/export deliberately bypass acceptance limits, so an older oversized
    // workspace can still be recovered. Restore performs full validation.
    return backup({version:3,revision:Number.isSafeInteger(captured.revision) ? captured.revision : 0,projects:captured.projects,activeProjectId:captured.activeProjectId ?? null,assets});
  };

  api.close = async () => {
    if (closed) return;
    closed = true;
    revokeAll();
    if (database) database.close();
    else if (databasePromise) {try {(await databasePromise).close();} catch { /* Opening may have been denied or cancelled. */ }}
  };
  return api;
}
