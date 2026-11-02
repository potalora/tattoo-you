import React, {useEffect, useRef, useState} from 'react';
import {Button, Select, Dialog, DialogContent, DialogTitle, DialogDescription} from './primitives.jsx';
import {compatibleComparisonStudies} from '../study-comparison.js';
import {ReferenceReview} from './reference-inspector.jsx';

export function JourneyDialogs({app, snapshot}) {
  const {ui, study, workspace} = snapshot, a = app.actions;
  const [side, setSide] = useState('a');
  const captureButton = useRef(null), wasBusy = useRef(false);
  useEffect(() => { setSide('a'); }, [ui.comparison]);
  useEffect(() => {
    if (wasBusy.current && !ui.reviewBusy && ui.dialog === 'compare') captureButton.current?.focus();
    wasBusy.current = ui.reviewBusy;
  }, [ui.reviewBusy, ui.dialog]);
  if (!study) return null;
  const candidates = compatibleComparisonStudies(workspace.projects, study);
  const comparison = ui.comparison;
  return <>
    <Dialog open={ui.dialog === 'compare'} onOpenChange={open => { if (!open) a.closeDialog(); }}>
      <DialogContent id="comparison-dialog" className="journey-dialog comparison-dialog" showCloseButton={!ui.reviewBusy} finalFocus={() => document.getElementById('compare-studies')}>
        <DialogTitle>Compare placements</DialogTitle>
        <DialogDescription>Two studies, one camera position. Your saved studies stay independent.</DialogDescription>
        <div className="comparison-choices">
          <div><span className="comparison-letter">A</span><strong title={study.name}>{study.name}</strong><small>Current study</small></div>
          <div><label htmlFor="comparison-target" className="comparison-letter">B</label>
            <Select id="comparison-target" aria-label="Compare with study" value={ui.comparisonTarget} disabled={ui.reviewBusy || !candidates.length} onValueChange={a.setComparisonTarget}
              items={candidates.map(p => ({value:p.id,label:p.name}))} />
          </div>
        </div>
        {!candidates.length ? <div className="comparison-empty"><h3>Make room for another idea</h3><p>Save an alternative, change its placement or size, then compare it here. Both studies need the same body reference and proportions.</p>
          <Button variant="primary" onClick={() => { a.closeDialog(); a.saveAlternative(); }}>Create an alternative</Button></div> :
          <Button ref={captureButton} id="capture-comparison" variant={comparison ? 'secondary' : 'primary'} disabled={ui.reviewBusy} onClick={a.compareStudies}>{ui.reviewBusy ? 'Preparing views…' : comparison ? 'Refresh comparison' : 'Compare these studies'}</Button>}
        <p className="review-error" role="alert" hidden={!ui.reviewError}>{ui.reviewError}</p>
        {comparison && <>
          <nav className="comparison-switch" aria-label="Comparison view">{['a','b'].map(key => <Button key={key} aria-pressed={side === key} onClick={() => setSide(key)}>{key.toUpperCase()}<span>{comparison[key].name}</span></Button>)}</nav>
          <div className="comparison-images" data-side={side}>{['a','b'].map(key => <figure key={key} data-comparison-side={key}>
            <img src={comparison[key].image} width={comparison[key].width} height={comparison[key].height} alt={`Placement comparison ${key.toUpperCase()}: ${comparison[key].name}`} />
            <figcaption><strong>{key.toUpperCase()} · {comparison[key].name}</strong><span>{comparison[key].visibleTattooCount} visible tattoo{comparison[key].visibleTattooCount === 1 ? '' : 's'}</span></figcaption>
            <Button variant="secondary" onClick={() => a.editComparedStudy(comparison[key].id)}>Edit {key.toUpperCase()}</Button>
          </figure>)}</div>
          <p className="hint comparison-note">Same framing and scale. Captured previews; return to editing to change the view.</p>
        </>}
        <div className="review-actions"><Button disabled={ui.reviewBusy} onClick={a.closeDialog}>Back to editing</Button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={ui.dialog === 'reference'} onOpenChange={open => { if (!open) a.closeDialog(); }}>
      <DialogContent id="reference-dialog" className="journey-dialog reference-dialog" finalFocus={() => document.getElementById('save-image')}>
        <DialogTitle>Review your reference</DialogTitle>
        <DialogDescription>This is the PNG you’ll download. Check the artwork, framing and placement notes.</DialogDescription>
        <p className="review-error" role="alert" hidden={!ui.reviewError}>{ui.reviewError}</p>
        {ui.dialog === 'reference' && ui.reference && <ReferenceReview reference={ui.reference} downloaded={ui.referenceDownloaded} actions={a} />}
        {!ui.reference && <div className="review-actions"><Button variant="primary" disabled={ui.reviewBusy} onClick={a.reviewReference}>Try again</Button><Button onClick={a.closeDialog}>Back to editing</Button></div>}
      </DialogContent>
    </Dialog>
  </>;
}
