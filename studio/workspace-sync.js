// Framework-neutral owners for workspace persistence and scene updates.
// Read through state on each operation: loading a backup can replace workspace.
export function createWorkspaceSync(state, {
  api,
  copy = value => globalThis.structuredClone(value),
  savedStatus = () => {},
  say = () => {},
  saveFailed = say,
  saveRecovered = () => {},
  persistenceChanged = () => {},
  setRetry = () => {},
  setRenderBusy = () => {},
  setPreviewError = () => {},
  renderedComposition = () => {},
  // Browser timer methods require their Window receiver. Keep native calls
  // behind wrappers so an injected clock object never becomes that receiver.
  clock = {
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: timer => globalThis.clearTimeout(timer),
  },
}) {
  function scheduleSave() {
    state.dirty = true;
    savedStatus('Unsaved changes');
    clock.clearTimeout(state.saveTimer);
    state.saveTimer = clock.setTimeout(flush, 450);
  }

  async function savePending() {
    try {
      while (state.dirty && !state.conflict) {
        state.dirty = false;
        savedStatus('Saving…');
        const payload = {
          revision: state.workspace.revision,
          projects: copy(state.workspace.projects),
          activeProjectId: state.workspace.activeProjectId,
        };
        const assetVersions = copy(state.workspace.assets || []);
        try {
          const result = await api('workspace', 'PUT', payload);
          state.workspace.revision = result.revision;
        } catch (error) {
          state.dirty = true;
          if (error.status === 409) {
            const latest = await api('workspace');
            const artworkIdentity = assets => JSON.stringify((assets || []).map(asset => ({
              id:asset.id, url:asset.url, name:asset.name, mime:asset.mime,
              width:asset.width, height:asset.height, createdAt:asset.createdAt, legacyWhite:asset.legacyWhite,
            })).sort((a,b) => a.id.localeCompare(b.id)));
            if (JSON.stringify(latest.projects) === JSON.stringify(payload.projects)
                && latest.activeProjectId === payload.activeProjectId
                && artworkIdentity(latest.assets) === artworkIdentity(assetVersions)) {
              state.workspace.revision = latest.revision;
              state.dirty = JSON.stringify(state.workspace.projects) !== JSON.stringify(payload.projects)
                || state.workspace.activeProjectId !== payload.activeProjectId;
              continue;
            }
            state.conflict = true;
            savedStatus('Changed in another tab', true);
            saveFailed('Another tab saved this workspace. Export your open edits before reloading the saved copy.');
          } else {
            savedStatus('Not saved · retry', true);
            saveFailed(error.message);
          }
          setRetry(state.conflict ? {hidden: false, text: 'Resolve conflict'} : {hidden: false});
          break;
        }
      }
      return !state.dirty && !state.conflict;
    } catch (error) {
      state.dirty = true;
      setRetry({hidden: false});
      savedStatus('Not saved · retry', true);
      saveFailed(error.message);
      return false;
    }
  }

  async function flush() {
    clock.clearTimeout(state.saveTimer);
    if (state.saveTask) return state.saveTask;
    if (!state.dirty || state.conflict) return !state.dirty && !state.conflict;
    state.saving = true;
    // Start immediately so the first payload captures the initiating edit.
    // A promise finalizer also releases ownership after a synchronous API error.
    state.saveTask = savePending().finally(() => {
      state.saving = false;
      state.saveTask = null;
      // Acknowledging one payload is insufficient if later edits are queued.
      // Publish durable success only once every pending edit has persisted.
      if (!state.dirty && !state.conflict) {
        savedStatus('Saved to workspace');
        setRetry({hidden: true});
        saveRecovered();
      }
      persistenceChanged();
    });
    return state.saveTask;
  }

  async function renderPending() {
    try {
      while (state.renderAgain) {
        state.renderAgain = false;
        const active = state.workspace.projects.find(project => project.id === state.workspace.activeProjectId);
        const project = copy(active);
        await state.studio.update(project.body, project.tattoos, state.workspace.assets, project.selectedIds);
        if (!state.renderAgain) renderedComposition(project);
      }
      state.lastRenderOK = true;
      setPreviewError('');
      return true;
    } catch (error) {
      console.error(error);
      setPreviewError(error.message);
      say('Preview unavailable. Change the view to retry.');
      return false;
    }
  }

  async function renderScene() {
    if (!state.studio) return;
    state.renderAgain = true;
    if (state.renderTask) return state.renderTask;
    state.rendering = true;
    setRenderBusy(true);
    state.lastRenderOK = false;
    state.renderTask = renderPending().finally(() => {
      state.rendering = false;
      state.renderTask = null;
      setRenderBusy(false);
    });
    return state.renderTask;
  }

  return {scheduleSave, flush, renderScene};
}
