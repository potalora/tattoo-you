import {raster as defaultRaster, download as defaultDownload} from './browser-files.js';
import {MAX_TATTOOS, copy, addTattoo} from './model.js';
import {referenceLines, referenceCrop} from './reference-caption.js';

/** File workflows depend on commands and browser capabilities, never UI nodes. */
export function createWorkspaceFiles(state, services) {
  const {
    api, raster = defaultRaster, download = defaultDownload,
    active, mutate, flush, say, setInteractionBlocked, setDataStatus, invalidateArtworkHistory,
    showSurface, focusPlacement, publish, regions = [],
    confirm = message => globalThis.confirm(message),
    getInteractionBlocked = () => false,
    getStatus = () => state.status || '',
  } = services;
  const browser = {
    Image: globalThis.Image,
    FileReader: globalThis.FileReader,
    document: globalThis.document, Blob: globalThis.Blob,
    ...services.browser,
  };

  async function uploadFiles(files, {existing = false} = {}) {
    const errors = [];
    let imported = 0, added = 0;
    const wasBlocked = getInteractionBlocked();
    setInteractionBlocked(true);
    try {
      for (const file of files) {
        try {
          say('Importing ' + file.name + '…');
          const image = await raster(file);
          if (!await flush()) throw Error('Save or resolve the open changes before importing artwork.');
          const result = await api('assets', 'POST', {
            revision: state.workspace.revision, name: file.name.replace(/\.[^.]+$/, '').slice(0, 120), ...image,
          });
          const {revision, ...asset} = result;
          if (Number.isSafeInteger(revision)) state.workspace.revision = revision;
          state.workspace.assets.push(asset);
          imported++;
          if (active().tattoos.length < MAX_TATTOOS && mutate(study => {
            const layer = addTattoo(study, asset, existing);
            layer.locked = false;
          })) added++;
        } catch (error) {
          errors.push(`${file.name}: ${error.message}`);
        }
      }
    } finally {
      setInteractionBlocked(wasBlocked);
      publish();
    }
    if (added) {
      showSurface('composition');
      focusPlacement();
    }
    const summary = [`${imported} artwork imported; ${added} added to this study.`];
    if (added) summary.push(existing
      ? 'Position your existing tattoos, then Lock in place to protect them.'
      : 'Choose a body area or Place on body, then adjust width.');
    if (imported > added) {
      summary.push(`This study is full (${MAX_TATTOOS} tattoos). ${imported - added} artwork kept in your library; start a new study or remove an editable tattoo.`);
    }
    if (errors.length) {
      summary.push(`${errors.length} file${errors.length === 1 ? '' : 's'} failed. ${errors.join(' · ')} You can retry these files.`);
    }
    say(summary.join(' '));
  }

  async function removeArtwork(id) {
    const wasBlocked = getInteractionBlocked();
    setInteractionBlocked(true);
    try {
      if (state.workspace.projects.some(study => study.tattoos.some(layer => layer.assetId === id))) {
        throw Error('This artwork belongs to a study. Remove its layers before deleting the artwork.');
      }
      if (!await flush()) throw Error('Save the workspace before deleting artwork.');
      if (!confirm('Remove this artwork from your library? Export a workspace backup first if you want to keep it.')) return;
      const result = await api('assets/' + id, 'DELETE', {revision: state.workspace.revision});
      if (Number.isSafeInteger(result?.revision)) state.workspace.revision = result.revision;
      state.workspace.assets = state.workspace.assets.filter(asset => asset.id !== id);
      invalidateArtworkHistory(id);
      publish();
      say('Artwork removed from library.');
    } catch (error) {
      say(error.message);
    } finally {
      setInteractionBlocked(wasBlocked);
    }
  }

  async function exportBackup() {
    const wasBlocked = getInteractionBlocked();
    setInteractionBlocked(true);
    const captured = copy(state.workspace);
    const {projects, activeProjectId} = captured;
    try {
      const backup = api.exportWorkspace ? await api.exportWorkspace(captured) : await api('backup');
      const assets = new Set(backup.assets.map(asset => asset.id));
      const checkReferences = value => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          if (['assetId', 'uploadedAssetId'].includes(key) && typeof child === 'string' && !assets.has(child)) {
            throw Error('The backup is missing artwork referenced by your open edits. Keep this tab open and resolve changes from other tabs before exporting.');
          }
          checkReferences(child);
        }
      };
      checkReferences(projects);
      backup.projects = projects;
      backup.activeProjectId = activeProjectId;
      download('inkform-workspace.json', new browser.Blob([JSON.stringify(backup)], {type: 'application/json'}));
      setDataStatus('Workspace download started, including artwork and open edits. Keep the file as a separate backup.');
    } finally { setInteractionBlocked(wasBlocked); }
  }

  async function prepareReference() {
    const wasBlocked = getInteractionBlocked();
    setInteractionBlocked(true);
    try {
      if ((state.renderTask && !await state.renderTask) || !state.lastRenderOK) {
        throw Error('Preview could not be rendered. Adjust the study or reload before exporting.');
      }
      const study = copy(active());
      const capture = {view: state.studio.getViewName?.() || state.currentView || 'custom', mappingWarnings: copy(state.mappingWarnings || [])};
      const image = new browser.Image();
      image.src = await state.studio.snapshot();
      const captureRegion = state.studio.getCaptureRegion?.();
      const region = captureRegion ? copy(captureRegion) : captureRegion;
      await image.decode();
      const crop = referenceCrop(image.width, image.height, region);
      const canvas = browser.document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = Math.max(640, crop.width);
      context.font = '14px Helvetica Neue, Helvetica, Arial, sans-serif';
      const lines = referenceLines(study, regions, text => context.measureText(text).width, canvas.width - 40, capture);
      canvas.height = crop.height + 40 + lines.length * 22;
      context.fillStyle = '#262928';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, (canvas.width - crop.width) / 2, 0, crop.width, crop.height);
      context.fillStyle = '#f2f5f6';
      context.font = '14px Helvetica Neue, Helvetica, Arial, sans-serif';
      lines.forEach((line, index) => context.fillText(line, 20, crop.height + 30 + index * 22));
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw Error('The reference image could not be created. Try again.');
      // Read the encoded PNG itself so the review and download share exact bytes.
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new browser.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || Error('The reference preview could not be read. Try again.'));
        reader.readAsDataURL(blob);
      });
      return {
        blob, dataUrl,
        filename: 'inkform-' + study.name.replace(/[^a-z0-9]/gi, '-') + '-' + (capture.view === 'custom' ? 'custom-view' : capture.view).replace(/[^a-z0-9]/gi, '-') + '.png',
        studyName: study.name, view: capture.view,
        width: canvas.width, height: canvas.height, caption: lines.join('\n'),
      };
    } finally {
      setInteractionBlocked(wasBlocked);
    }
  }

  function downloadReference(prepared) {
    download(prepared.filename, prepared.blob);
    say('Reference download started. Save another view for wrapping artwork.');
  }

  async function saveImage() {
    downloadReference(await prepareReference());
  }

  return {uploadFiles, removeArtwork, exportBackup, prepareReference, downloadReference, saveImage};
}
