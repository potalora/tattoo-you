import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Minus, Plus} from 'lucide-react';
import {Button} from './primitives.jsx';
import {createReferencePan, referenceFitScale, referenceZoomScroll, referenceZoomStep} from '../reference-inspection.js';

export function ReferenceReview({reference, downloaded, actions}) {
  const [inspecting, setInspecting] = useState(false);
  const [zoom, setZoom] = useState(null);
  const [size, setSize] = useState({width:0, height:0});
  const [panning, setPanning] = useState(false);
  const viewport = useRef(null), pan = useRef(null), pendingScroll = useRef(null);
  const fit = referenceFitScale(reference, size), scale = zoom ?? fit;
  useLayoutEffect(() => {
    const node = viewport.current;
    const measure = () => setSize({width:node.clientWidth, height:node.clientHeight});
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    pan.current = createReferencePan(node);
    return () => {observer.disconnect(); pan.current?.end();};
  }, []);
  useEffect(() => {
    const stop = () => {pan.current?.end(); setPanning(false);};
    window.addEventListener('blur', stop);
    return () => window.removeEventListener('blur', stop);
  }, []);
  useLayoutEffect(() => {
    if (!pendingScroll.current) return;
    viewport.current.scrollTo(pendingScroll.current); pendingScroll.current = null;
  }, [zoom, inspecting]);

  const changeZoom = next => {
    const node = viewport.current;
    pan.current?.end(); setPanning(false);
    pendingScroll.current = referenceZoomScroll({left:node.scrollLeft, top:node.scrollTop}, scale, next ?? fit, reference, size);
    setZoom(next);
  };
  const endPan = event => {pan.current?.end(event); setPanning(false);};
  return <>
    <div className="reference-review-content">
      <section className="reference-inspector" aria-label="Reference image inspection" data-inspecting={inspecting}>
        <div className="reference-inspection-controls">
          <Button id="inspect-reference" aria-pressed={inspecting} onClick={() => {
            changeZoom(inspecting ? null : 1); setInspecting(!inspecting);
          }}>{inspecting ? 'Back to overview' : 'Inspect full size'}</Button>
          {inspecting && <div className="reference-zoom-controls" role="group" aria-label="Reference zoom">
            <Button aria-pressed={zoom === null} onClick={() => changeZoom(null)}>Fit</Button>
            <Button aria-pressed={zoom === 1} onClick={() => changeZoom(1)}>100%</Button>
            <Button aria-label="Zoom out" disabled={scale <= Math.min(.1, fit)} onClick={() => changeZoom(referenceZoomStep(scale, -1, fit))}><Minus size={16} aria-hidden="true" /></Button>
            <output aria-label="Image zoom" aria-live="polite">{Math.round(scale * 100)}%</output>
            <Button aria-label="Zoom in" disabled={scale >= 4} onClick={() => changeZoom(referenceZoomStep(scale, 1, fit))}><Plus size={16} aria-hidden="true" /></Button>
          </div>}
        </div>
        <div ref={viewport} className="reference-inspection-viewport" tabIndex={inspecting ? 0 : -1} role="region"
          aria-label="Reference PNG" aria-describedby={inspecting ? 'reference-pan-help' : undefined} data-panning={panning}
          onPointerDown={event => {
            if (!inspecting) return;
            const started = pan.current.start(event); setPanning(started);
            if (started) viewport.current.focus({preventScroll:true});
          }}
          onPointerMove={event => pan.current?.move(event)} onPointerUp={endPan}
          onPointerCancel={endPan} onLostPointerCapture={endPan} onBlur={() => endPan()}>
          <div className="reference-image-space" style={{width:Math.max(size.width, reference.width * scale), height:Math.max(size.height, reference.height * scale)}}>
            <img id="reference-preview" src={reference.dataUrl} width={reference.width} height={reference.height}
              style={{width:reference.width * scale, height:reference.height * scale}} draggable={false}
              alt={`Reference PNG for ${reference.studyName}; ${reference.view} view, with placement notes`} />
          </div>
        </div>
        {inspecting && <p id="reference-pan-help" className="reference-pan-help">Scroll, swipe or drag to pan. Focus the image area to use arrow keys.</p>}
      </section>
      <div className="reference-review-guidance">
        <h3>Ready for the conversation</h3>
        <p>Confirm the final fit on your body with your artist. The preview and measurements are approximate.</p>
        <p>For artwork that wraps around the body, return to editing and save another angle.</p>
      </div>
    </div>
    <div className="reference-review-footer">
      <p className="reference-dimensions">PNG · {reference.width} × {reference.height}</p>
      <div className="reference-review-buttons">
        <Button id="download-reference" variant="primary" onClick={actions.downloadReference}>Download PNG</Button>
        <Button id="reference-back" variant="secondary" onClick={actions.closeDialog}>Back to editing</Button>
      </div>
      <p role="status" aria-atomic="true" className="reference-downloaded">{downloaded ? 'PNG download started.' : ''}</p>
    </div>
  </>;
}
