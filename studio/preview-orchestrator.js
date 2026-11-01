/** Owns the transition between raster editing, refined stills and captures.
 * Resource construction, scene inputs and GPU fences stay with their owners.
 */
export function createPreviewOrchestrator({isDisposed,finishCamera,getInkTask,scheduler,createPreview,getTraceInput,onPreview=()=>{},onError=()=>{},capture,preview=null}) {
  const state={preview,sequence:0,pending:false,still:false,task:null,initTask:null,intentTask:null};
  function cancel() {
    state.sequence++;
    const wasPreview=state.pending||state.task||state.still;
    state.pending=false;
    state.still=false;
    const cleanup=state.preview?.cancel();
    if(wasPreview&&!isDisposed())onPreview({phase:'idle',samples:0});
    return cleanup;
  }
  function requestRender() {
    if(isDisposed())return;
    cancel();
    scheduler.request();
  }
  async function run() {
    if(isDisposed())return;
    finishCamera();
    const cleanup=cancel(),sequence=state.sequence;
    state.pending=true;
    let task;
    onPreview({phase:'loading',samples:0});
    try {
      await cleanup;
      await scheduler.flush();
      if(sequence!==state.sequence||isDisposed())return;
      if(!state.preview) {
        if(!state.initTask)state.initTask=Promise.resolve().then(createPreview);
        const initializing=state.initTask;
        try { state.preview=await initializing; }
        finally { if(state.initTask===initializing)state.initTask=null; }
      }
      const inkTask=getInkTask();
      if(inkTask)await inkTask;
      if(sequence!==state.sequence||isDisposed())return;
      state.pending=false;
      task=state.preview.start({...getTraceInput(),onProgress:status=>{
        if(sequence===state.sequence&&!isDisposed())onPreview(status);
      }});
      state.task=task;
      const result=await task;
      if(sequence===state.sequence&&!isDisposed()) {
        state.still=true;
        onPreview({phase:'complete',...result});
      }
      return result;
    } catch(error) {
      if(sequence===state.sequence&&!isDisposed()) {
        if(error.name!=='AbortError') {
          onPreview({phase:'error',message:error.message});
          onError(error);
        }
        scheduler.request();
      }
    } finally {
      if(state.task===task)state.task=null;
      if(sequence===state.sequence)state.pending=false;
    }
  }
  function raytrace() {
    const task=run();
    state.intentTask=task;
    // A snapshot must also wait for initial scheduler flush / lazy loading,
    // before the lower-level preview task has acquired the canvas.
    const release=()=>{if(state.intentTask===task)state.intentTask=null;};
    void task.then(release,release);
    return task;
  }
  async function snapshot() {
    finishCamera();
    while(state.intentTask)await state.intentTask.catch(()=>{});
    if(state.task)await state.task.catch(()=>{});
    if(!state.still)await scheduler.flush();
    return capture();
  }
  return {state,cancel,requestRender,raytrace,snapshot};
}
