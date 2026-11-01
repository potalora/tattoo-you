import React, {memo, useEffect, useRef, useState} from 'react';
import {BODY_DEFAULTS} from '../model.js';
import {bodyParams} from '../body-controls.js';
import {BODY_PROFILES, bodyProfileId} from '../body-profiles.js';
import {resolveBodyModel, SELECTABLE_BODY_MODELS} from '../model-catalog.js';
import {SKIN_TONES, LEGACY_SKIN_COLORS, skinColor} from '../skin-tones.js';
import {Button, Field, Select, RangeControl, PreparedCompositionGuidance} from './primitives.jsx';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BUSY_PHASES = new Set(['loading', 'baking', 'preparing', 'rendering', 'denoising']);
const MEASUREMENTS = [['leftUpperArm', 'Left arm'], ['rightUpperArm', 'Right arm'], ['waist', 'Waist'], ['hips', 'Hips']];

export function bodySourceItems(model) {
  return [...(model.legacyOnly ? [{value: model.id, label: `${model.label} · saved reference`, disabled: true}] : []),
    ...SELECTABLE_BODY_MODELS.map(source => ({value: source.id, label: source.label}))];
}

export function anatomyItems(model) {
  return (model.anatomies || ['male', 'female']).map(id => ({value: id,
    label: model.anatomyLabels?.[id] || (id === 'female' ? 'Female' : 'Male')}));
}

function bodyValue(id, value) {
  if (id === 'stature') return Number(value).toFixed(1) + ' cm';
  if (id === 'mass' || id === 'muscle') return `${value} / 100`;
  return `${value > 0 ? '+' : ''}${value}`;
}

function previewDescription(preview) {
  const labels = {
    idle: '',
    loading: 'Preparing preview…',
    baking: 'Preparing preview…',
    preparing: 'Preparing preview…',
    rendering: 'Refining light',
    denoising: 'Finishing preview…',
    complete: `Preview ready. Export image to save it.${preview.denoiseWarning ? ' Some grain may remain.' : ''}`,
    error: preview.message,
  };
  return labels[preview.phase] || '';
}

/** Controls read immutable application snapshots; only partial color text is local. */
function BodyPanelView({app, snapshot}) {
  const {study, ui = {}} = snapshot;
  const body = study?.body || BODY_DEFAULTS;
  const color = skinColor(body);
  const [hex, setHex] = useState(color);
  const hexEditing = useRef(false);
  const hexStudy = useRef(study?.id);
  useEffect(() => {
    if (hexStudy.current !== study?.id || !hexEditing.current) setHex(color);
    hexStudy.current = study?.id;
  }, [study?.id, color]);
  if (!study) return null;

  const actions = app.actions;
  const model = resolveBodyModel(body);
  const fixed = model.supportsShapeControls === false;
  const fixedSkin = model.supportsSkinTone === false;
  const blocked = Boolean(ui.blocked);
  const anatomies = model.anatomies || ['male', 'female'];
  const stats = ui.stats || {};
  const preview = ui.preview || {phase: 'idle'};
  const busy = BUSY_PHASES.has(preview.phase);
  const legacyRefinements = bodyParams.some(([key, , min, max]) => body[key] != null && (body[key] < min || body[key] > max)) || Boolean(body.build);
  const measurements = MEASUREMENTS.filter(([key]) => ui.measurements?.[key] != null)
    .map(([key, label]) => `${label} ${ui.measurements[key].toFixed(1)} cm`).join(' · ');
  const commitColor = () => actions.endGesture('skin-color');
  const updateColor = value => {
    setHex(value);
    if (HEX_COLOR.test(value)) actions.setSkinColor(value.toLowerCase());
  };
  const commitHex = event => {
    commitColor();
    if (!HEX_COLOR.test(event.currentTarget.value)) {
      event.currentTarget.setCustomValidity('Use a six-digit color, such as #a07e56.');
      event.currentTarget.reportValidity();
    }
  };
  const ranges = group => bodyParams.filter(param => param[5] === group).map(([id, label, min, max, step]) => (
    <RangeControl key={`${study.id}:${id}`} id={id} label={label} value={body[id] ?? BODY_DEFAULTS[id] ?? 0}
      min={min} max={max} step={step} disabled={fixed || blocked}
      format={value => bodyValue(id, value)}
      onChange={value => actions.editBody(id, Number(value))}
      onCommit={() => actions.endGesture(id)} />
  ));

  return <section data-surface-content="body"><div data-panel-content="body">
    <h2 className="sr-only">Body reference</h2>
    <PreparedCompositionGuidance app={app} snapshot={snapshot} />
    <p className="hint body-lock-scope">Locks protect tattoo placement. Body proportions can still change.</p>
    <details className="control-details body-source-details">
      <summary>Body source <span>{model.label}</span></summary>
      <div className="body-model-control">
      <Field label="Body source" htmlFor="body-model">
        <Select id="body-model" aria-label="Body source" aria-describedby="body-model-hint body-model-source" value={model.id}
          disabled={blocked} onValueChange={actions.useBodyModel}
          items={bodySourceItems(model)} />
      </Field>
      <p id="body-model-source" className="hint">{model.source.split(' · ')[0]}</p>
      <p id="body-model-hint" className="hint">{model.anatomyTopologyCompatible === false ? 'Changing body or anatomy creates a new study.' : 'Choosing another body creates a new study.'}</p>
      <p id="body-legacy-note" className="hint" hidden={!model.legacyOnly}>Saved reference. {model.id === 'drummyfish-v1' ? 'Hair and underwear are part of this body. ' : ''}Your original study stays unchanged.</p>
      </div>
    </details>
    <p id="body-limit-note" className="hint" hidden={!legacyRefinements}>Saved proportions exceed these sliders. Reset proportions to use the current range.</p>
    <div id="body-ranges" data-shape-control="" hidden={fixed}>{ranges('main')}</div>
    <details className="control-details">
      <summary>Body options</summary>
      <p id="body-shape-hint" className="hint" hidden={fixed}>Adjust a starting shape, then refine it.</p>
      <p id="body-fixed-note" className="hint" hidden={!fixed}>This body has fixed proportions.</p>
      <Field label="Starting profile" data-shape-control="" hidden={fixed}>
        <Select id="body-profile" aria-label="Starting profile" value={bodyProfileId(body)} disabled={fixed || blocked}
          onValueChange={actions.setBodyProfile} items={[...BODY_PROFILES.map(profile => ({value: profile.id, label: profile.label})),
            {value: 'custom', label: 'Custom proportions', disabled: true}]} />
      </Field>
      <Field label="Anatomy model">
        <Select id="body" aria-label="Anatomy model" value={body.body} disabled={blocked || anatomies.length < 2}
          onValueChange={actions.changeAnatomy} items={anatomyItems(model)} />
      </Field>
    </details>
    <details className="control-details" data-shape-control="" hidden={fixed}>
      <summary>Refine proportions</summary>
      <div id="body-refinements">{ranges('refinements')}</div>
    </details>
    <details className="control-details" data-shape-control="" hidden={fixed}>
      <summary>Left and right adjustments</summary>
      <div id="body-asymmetry">{ranges('asymmetry')}</div>
    </details>
    <section className="tone-section">
      <h3>Skin tone</h3>
      <p id="body-skin-fixed-note" className="hint" hidden={!fixedSkin}>This body’s skin color is fixed.</p>
      <div id="body-skin-controls" hidden={fixedSkin}>
        <div id="skin-swatches" className="skin-swatches" aria-label="Skin tone references">
          {SKIN_TONES.map((tone, index) => <Button key={tone.id} variant="" type="button" data-tone={tone.id}
            aria-label={tone.label} title={tone.label} aria-pressed={body.skin === tone.id}
            disabled={fixedSkin || blocked} onClick={() => actions.setSkinTone(tone.id)}>
            <span style={{background: tone.color}} /><small>{index + 1}</small>
          </Button>)}
        </div>
        <Field label="Reference">
          <Select id="skin" aria-label="Reference" value={body.skin} disabled={fixedSkin || blocked} onValueChange={actions.setSkinTone}
            items={[...SKIN_TONES.map(tone => ({value: tone.id, label: tone.label})), {value: 'custom', label: 'Custom color'},
              {label: 'Earlier study colors', items: Object.keys(LEGACY_SKIN_COLORS).map(id => ({value: id, label: `Saved ${id}`}))}]} />
        </Field>
        <div className="custom-color">
          <label htmlFor="skin-color">Custom tone</label>
          <input id="skin-color" type="color" value={color} disabled={fixedSkin || blocked}
            onChange={event => updateColor(event.target.value)} onPointerUp={commitColor} onKeyUp={commitColor} onBlur={commitColor} />
          <input id="skin-hex" type="text" value={hex} pattern="#[0-9a-fA-F]{6}" maxLength="7"
            aria-label="Custom skin tone hex color" spellCheck="false" disabled={fixedSkin || blocked}
            onFocus={() => { hexEditing.current = true; }}
            onChange={event => { event.target.setCustomValidity(''); updateColor(event.target.value); }}
            onPointerUp={commitColor} onKeyUp={commitColor}
            onBlur={event => { hexEditing.current = false; commitHex(event); }} />
        </div>
        <p className="hint">Skin tones adapted from <a href="https://skintone.google/get-started" target="_blank" rel="noopener">Ellis Monk’s scale</a> (2019) · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</p>
      </div>
    </section>
    <output id="body-measurements" className="hint">{measurements && `Approximate model measurements: ${measurements}. These are reference dimensions, not measured personal circumferences.`}</output>
    <Button id="reset-body" data-shape-control="" hidden={fixed} disabled={fixed || blocked} onClick={() => actions.resetBody()}>Reset proportions</Button>
    <div className="preview-controls">
      <div className="small-actions">
        <Button id="raytrace" variant="ghost" type="button" disabled={blocked || busy || stats.renderer !== 'WebGPU'}
          title={stats.renderer !== 'WebGPU' ? 'Refined previews are not available in this browser.' : 'Create a still with softer light and finer detail.'}
          onClick={actions.raytrace}>Refine preview</Button>
        <Button id="cancel-raytrace" variant="ghost" type="button" hidden={!busy && preview.phase !== 'complete'}
          onClick={() => actions.cancelRaytrace()}>{busy ? 'Cancel' : 'Back to editing'}</Button>
      </div>
      <p id="raytrace-status" className="hint" data-phase={preview.phase} hidden={preview.phase === 'idle'}>
        <span id="raytrace-announcement" role="status" aria-live="polite">{previewDescription(preview)}</span>
        {preview.phase === 'rendering' && <span id="raytrace-samples" aria-live="off"> · {Math.floor(preview.samples || 0)} samples</span>}
      </p>
    </div>
  </div></section>;
}

export function bodyPanelPropsEqual(previous, next) {
  const a = previous.snapshot, b = next.snapshot, x = a.ui || {}, y = b.ui || {};
  const previewA = x.preview || {}, previewB = y.preview || {};
  return previous.app === next.app && a.study?.id === b.study?.id && a.study?.body === b.study?.body &&
    a.runtimeCapabilities?.preparedComposition?.projectId === b.runtimeCapabilities?.preparedComposition?.projectId && x.blocked === y.blocked && x.lighting === y.lighting && x.quality === y.quality &&
    MEASUREMENTS.every(([key]) => x.measurements?.[key] === y.measurements?.[key]) &&
    previewA.phase === previewB.phase && Math.floor(previewA.samples || 0) === Math.floor(previewB.samples || 0) &&
    previewA.denoised === previewB.denoised && previewA.denoiseWarning === previewB.denoiseWarning &&
    previewA.message === previewB.message &&
    x.stats?.renderer === y.stats?.renderer && x.stats?.surface === y.stats?.surface &&
    x.stats?.pixelRatio === y.stats?.pixelRatio;
}

export const BodyPanel = memo(BodyPanelView, bodyPanelPropsEqual);

export default BodyPanel;
