import {copy, History, createBodyModelCopy, uid} from './model.js';
import {validateWorkspace} from './workspace-validation.js';
import {STORAGE_LIMITS} from './storage-limits.js';
import {resolveBodyModel} from './model-catalog.js';

/** Study commands own history and transactions; services own rendering and UI. */
export function createStudyController(state, services) {
  const histories = new Map();
  const {
    render, renderScene, scheduleSave, flush, say, api, askName, placeMode,
    chooseCamera, setInteractionBlocked, setLoading, setCameraSelection,
  } = services;

  function active() {
    return state.workspace.projects.find(project => project.id === state.workspace.activeProjectId);
  }

  function hist() {
    const id = active().id;
    if (!histories.has(id)) histories.set(id, new History());
    return histories.get(id);
  }

  function clearHistory() {
    histories.clear();
  }

  function invalidateArtworkHistory(assetId) {
    for (const history of histories.values()) {
      if ([...history.past, ...history.future].some(study => study.tattoos.some(layer => layer.assetId === assetId))) {
        history.clear();
      }
    }
  }

  function mutate(change, {history = true, scene = true} = {}) {
    if (state.convertingBody) return false;
    const study = active();
    const before = copy(study), candidate = copy(study);
    try {
      change(candidate);
      candidate.updatedAt = new Date().toISOString();
      validateWorkspace({projects: state.workspace.projects.map(p => p.id === candidate.id ? candidate : p), activeProjectId: candidate.id}, new Set(state.workspace.assets.map(asset => asset.id)));
    } catch (error) {
      say(error.message);
      return false;
    }
    if (history) hist().push(before);
    for (const key of Object.keys(study)) delete study[key];
    Object.assign(study, candidate);
    render();
    if (scene) renderScene();
    scheduleSave();
    return true;
  }

  function hasStudyCapacity() {
    if (state.workspace.projects.length < STORAGE_LIMITS.maxProjects) return true;
    say(`A workspace can hold ${STORAGE_LIMITS.maxProjects} studies. Remove a study before creating another.`);
    return false;
  }

  function canAddStudy(study) {
    if (!hasStudyCapacity()) return false;
    try {
      validateWorkspace({projects: [...state.workspace.projects, study], activeProjectId: study.id}, new Set(state.workspace.assets.map(asset => asset.id)));
      return true;
    } catch (error) { say(error.message); return false; }
  }

  function setProject(study) {
    const index = state.workspace.projects.findIndex(project => project.id === study.id);
    state.workspace.projects[index] = study;
    render();
    renderScene();
    scheduleSave();
  }

  async function saveAlternative() {
    if (state.convertingBody || !hasStudyCapacity()) return false;
    const name = await askName('Create an alternative', (active().name + ' — alternative').slice(0, 120), {
      submitLabel: 'Create alternative', description: 'Create a separate study. Your original is kept.',
    });
    if (!name?.trim()) return false;
    const study = copy(active());
    study.id = uid(); study.name = name.trim().slice(0, 120);
    if (!canAddStudy(study)) return false;
    const wasReady = state.ready;
    state.convertingBody = true;
    state.ready = false;
    setInteractionBlocked(true);
    try {
      active().camera = state.studio.getCamera();
      scheduleSave();
      if (!await flush()) {
        say('Save or resolve the open changes before saving an alternative.');
        return false;
      }
      Object.assign(study, copy(active()), {id: study.id, name: study.name});
      study.updatedAt = new Date().toISOString();
      state.workspace.projects.push(study);
      state.workspace.activeProjectId = study.id;
      placeMode(false);
      render();
      scheduleSave();
      const rendered = await renderScene();
      if (!await flush()) {
        say('Alternative is open but not saved. Use Retry save or resolve the conflict; your original is kept.');
        return false;
      }
      say(rendered
        ? 'Alternative saved. Your original is kept.'
        : 'Alternative saved, but its preview could not load. Change the view to retry.');
      return true;
    } catch (error) {
      say('Could not finish saving the alternative. ' + error.message);
      return false;
    } finally {
      state.convertingBody = false;
      state.ready = wasReady;
      setInteractionBlocked(false);
      render();
    }
  }

  async function switchProject(id) {
    if (state.convertingBody || id === state.workspace.activeProjectId ||
        !state.workspace.projects.some(project => project.id === id)) return false;
    const previous = active();
    const wasReady = state.ready;
    previous.camera = state.studio.getCamera();
    state.convertingBody = true;
    state.ready = false;
    setInteractionBlocked(true);
    try {
      state.workspace.activeProjectId = id;
      placeMode(false);
      render();
      if (!await renderScene()) throw Error('The selected study could not load.');
      const selected = active();
      if (selected.camera) {
        state.currentView = 'custom';
        state.studio.restoreCamera(selected.camera);
        setCameraSelection('custom');
      }
      else if (!await chooseCamera('body')) throw Error('The selected study preview could not finish.');
      scheduleSave();
      return true;
    } catch (error) {
      state.workspace.activeProjectId = previous.id;
      render();
      await renderScene();
      state.studio.restoreCamera(previous.camera);
      say(error.message);
      return false;
    } finally {
      state.convertingBody = false;
      state.ready = wasReady;
      setInteractionBlocked(false);
      render();
    }
  }

  async function changeAnatomy(anatomy) {
    if (state.convertingBody) return false;
    const model = resolveBodyModel(active().body);
    return model.anatomyTopologyCompatible === false
      ? useBodyModel(model.id, anatomy)
      : mutate(study => { study.body.body = anatomy; });
  }

  async function useBodyModel(targetId, requestedAnatomy) {
    if (state.convertingBody) return false;
    let target;
    try {
      if (typeof targetId !== 'string') throw Error('Unsupported body model.');
      target = resolveBodyModel(targetId);
      if (!target.ready) throw Error('This body model is not ready for comparison.');
      if (requestedAnatomy !== undefined && !(target.anatomies || ['male', 'female']).includes(requestedAnatomy)) {
        throw Error('Unsupported anatomy for this body model.');
      }
    } catch (error) {
      render();
      say(error.message);
      return false;
    }
    if (target.id === resolveBodyModel(active().body).id &&
        (requestedAnatomy === undefined || requestedAnatomy === active().body.body)) {
      render();
      return false;
    }
    if (!hasStudyCapacity()) return false;
    let prepared;
    try { prepared = createBodyModelCopy(active(), target.id, {anatomy: requestedAnatomy}); }
    catch (error) { say(error.message); return false; }
    if (!canAddStudy(prepared)) return false;
    state.convertingBody = true;
    const wasReady = state.ready;
    state.ready = false;
    setInteractionBlocked(true);
    let source, created, sourceCamera, copySaveFailed = false;
    const sourceView = state.currentView;
    setLoading(true);
    render();
    try {
      if (!await flush()) throw Error('Save or resolve the open changes before trying another body.');
      source = active();
      sourceCamera = state.studio.getCamera();
      created = prepared;
      state.workspace.projects.push(created);
      state.workspace.activeProjectId = created.id;
      placeMode(false);
      render();
      if (!await renderScene()) throw Error('The new body could not load. Your original study is still open.');
      if (!await chooseCamera('body')) throw Error('The new preview could not finish. Your original study is still open.');
      created.camera = state.studio.getCamera();
      scheduleSave();
      if (!await flush()) {
        copySaveFailed = true;
        throw Error('The comparison study could not be saved. Your original study is still open.');
      }
      say(`${target.label} opened in a separate study. Review placements on this body; your original is kept.`);
      return true;
    } catch (error) {
      if (created) {
        // A failed acknowledgement may hide a committed PUT. Advance only if
        // the persisted workspace exactly matches this comparison.
        if (copySaveFailed && !state.conflict) {
          try {
            const latest = await api('workspace');
            if (JSON.stringify(latest.projects) === JSON.stringify(state.workspace.projects) &&
                latest.activeProjectId === state.workspace.activeProjectId) {
              state.workspace.revision = latest.revision;
            }
          } catch {
            // The normal save/conflict flow will report an unavailable server.
          }
        }
        state.workspace.projects = state.workspace.projects.filter(project => project.id !== created.id);
        state.workspace.activeProjectId = source.id;
        render();
        await renderScene();
        state.studio.restoreCamera(sourceCamera);
        state.currentView = sourceView;
        setCameraSelection(sourceView);
        scheduleSave();
        await flush();
      }
      say(error.message);
      return false;
    } finally {
      setInteractionBlocked(false);
      setLoading(false);
      state.ready = wasReady;
      state.convertingBody = false;
      render();
    }
  }

  return {
    active, hist, mutate, setProject, saveAlternative, switchProject,
    changeAnatomy, useBodyModel, clearHistory, invalidateArtworkHistory, hasStudyCapacity, canAddStudy,
  };
}
