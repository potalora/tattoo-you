/** Release this studio's resources after asynchronous work gives up the GPU. */
export function disposeStudioResources(owned) {
  if(owned.disposal)return owned.disposal;
  // Cache ownership before stopping callbacks. Late preview construction is
  // included in pending(), so it is also disposed before renderer release.
  owned.disposal=Promise.resolve().then(async()=>{
    await Promise.allSettled([
      Promise.resolve().then(()=>owned.preview?.cancel()),
      ...(owned.pending?.()||[]),
    ]);
    try {
      if(owned.renderer?.backend?.isWebGPUBackend) {
        await owned.renderer.backend.device?.queue.onSubmittedWorkDone();
      }
    } catch {}
    await Promise.allSettled([
      Promise.resolve().then(()=>owned.inkAtlas?.dispose()),
      Promise.resolve().then(()=>owned.preview?.dispose()),
    ]);
    for(const resource of [owned.gallery,owned.library]) {
      try { await resource?.dispose(); } catch {}
    }
    const loaded=await Promise.allSettled([...owned.textures.values()]);
    for(const result of loaded) {
      if(result.status==='fulfilled')owned.resources.add(result.value);
    }
    owned.textures.clear();
    owned.scene?.traverse(object=>{
      if(!object.isMesh)return;
      owned.resources.add(object.geometry);
      for(const material of Array.isArray(object.material)?object.material:[object.material]) {
        owned.resources.add(material);
      }
    });
    for(const resource of owned.resources) {
      try { resource?.dispose(); } catch {}
    }
    owned.resources.clear();
    try { await owned.renderer?.dispose(); } catch {}
  });
  owned.stop();
  return owned.disposal;
}
