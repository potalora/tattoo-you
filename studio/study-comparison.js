import {referenceCrop} from './reference-caption.js';

const owners = new WeakSet();
const copy = value => structuredClone(value);
// OrbitControls normalizes spherical coordinates while restoring; roundoff is
// harmless, but a visible pan/orbit during capture must invalidate the result.
const sameCamera = (a, b) => ['position', 'target'].every(key =>
  Array.isArray(a?.[key]) && a[key].length === 3
    && a[key].every((value, i) => Number.isFinite(value) && Math.abs(value - b[key][i]) < 1e-8));
const bodyKey = body => JSON.stringify(Object.keys(body || {}).sort().map(key => [key, body[key]]));

/** Only identical body references, anatomy, proportions and appearance compare fairly. */
export function compatibleComparisonStudies(studies, activeStudy) {
  if (!activeStudy?.body) return [];
  const key = bodyKey(activeStudy.body);
  return studies.filter(study => study.id !== activeStudy.id && study.body && bodyKey(study.body) === key);
}

function immutable(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

async function cropSnapshot(source, region, browser) {
  const image = new browser.Image();
  image.src = source;
  await image.decode();
  const crop = referenceCrop(image.naturalWidth || image.width, image.naturalHeight || image.height, region);
  const canvas = browser.document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext('2d');
  if (!context) throw Error('The comparison image could not be created.');
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return {image: canvas.toDataURL('image/png'), width: crop.width, height: crop.height};
}

/**
 * Read-only, single-renderer capture. The caller must hold state.reviewing=true,
 * block editing/study navigation and suppress onCamera persistence until this
 * promise settles. No study, history, saved camera or active ID is changed here.
 * Camera restoration retains the original named view without animation and
 * clears delayed camera-save callbacks; result.view also records that identity.
 */
export async function captureStudyComparison(state, {active, targetId, browser = globalThis}) {
  const studio = state.studio;
  if (!state.reviewing) throw Error('Comparison requires reviewing mode to hold the editor still.');
  if (!studio || !state.ready) throw Error('Preview is not ready for comparison.');
  if (owners.has(studio)) throw Error('A comparison already owns this preview.');
  owners.add(studio);
  let restoreStudy, camera, workspace, activeId, view, assets;
  let touched = false;
  const assertOwner = () => {
    if (state.studio !== studio || state.workspace !== workspace || state.workspace.activeProjectId !== activeId || !state.reviewing) {
      throw Error('Comparison lost ownership of the active preview.');
    }
  };
  try {
    if ((state.renderTask && !await state.renderTask) || !state.lastRenderOK || !state.ready) {
      throw Error('Preview could not be rendered for comparison.');
    }
    workspace = state.workspace;
    activeId = workspace.activeProjectId;
    assertOwner();
    const source = active ? active() : workspace.projects.find(study => study.id === activeId);
    const target = compatibleComparisonStudies(workspace.projects, source).find(study => study.id === targetId);
    if (!source || source.id !== activeId || !target) throw Error('Choose another study with the same body reference and proportions.');
    restoreStudy = copy(source);
    const a = copy(source), b = copy(target);
    assets = copy(workspace.assets || []);
    camera = copy(studio.getCamera());
    view = studio.getViewName?.() || state.currentView || 'custom';
    const region = copy(studio.getCaptureRegion?.() || null);
    async function capture(study) {
      assertOwner();
      touched = true;
      // Both sides omit selection emphasis. Pass disposable copies because a
      // renderer adapter must never gain mutable access to saved domain data.
      await studio.update(copy(study.body), copy(study.tattoos), copy(assets), []);
      assertOwner();
      studio.restoreCamera(copy(camera), {viewName: view, silent: true});
      const source = await studio.snapshot();
      assertOwner();
      if (!sameCamera(studio.getCamera(), camera)
          || JSON.stringify(studio.getCaptureRegion?.() || null) !== JSON.stringify(region)) {
        throw Error('The comparison view changed during capture. Try again.');
      }
      const image = await cropSnapshot(source, region, browser);
      assertOwner();
      return {id: study.id, name: study.name, ...image, tattooCount: study.tattoos.length,
        visibleTattooCount: study.tattoos.filter(tattoo => tattoo.visible !== false).length,
        existingTattooCount: study.tattoos.filter(tattoo => tattoo.existing).length,
        updatedAt: study.updatedAt};
    }
    const imageA = await capture(a), imageB = await capture(b);
    if (imageA.width !== imageB.width || imageA.height !== imageB.height) {
      throw Error('The comparison viewport changed during capture. Try again.');
    }
    return immutable({a: imageA, b: imageB, camera, view});
  } finally {
    try {
      if (touched) {
        assertOwner();
        // Camera restoration must still run if restoring the active ink fails.
        try { await studio.update(copy(restoreStudy.body), copy(restoreStudy.tattoos), copy(assets), copy(restoreStudy.selectedIds || [])); }
        finally { studio.restoreCamera(copy(camera), {viewName: view, silent: true}); }
        await studio.snapshot(); // Fence the restored frame before releasing ownership.
        assertOwner();
      }
    } catch (error) {
      state.lastRenderOK = false;
      throw error;
    } finally {
      owners.delete(studio);
    }
  }
}
