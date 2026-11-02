/** Geometry uses CSS pixels; the original PNG is never redrawn or re-encoded. */
export function referenceFitScale(image, viewport) {
  if (!viewport.width || !viewport.height) return 1;
  return Math.min(1, viewport.width / image.width, viewport.height / image.height);
}

export function referenceZoomStep(scale, direction, fit) {
  const minimum = Math.min(.1, fit);
  const steps = [minimum, .1, .25, .5, .75, 1, 1.5, 2, 3, 4];
  return direction > 0
    ? steps.find(step => step > scale + .0001) ?? 4
    : steps.findLast(step => step < scale - .0001) ?? minimum;
}

export function referenceZoomScroll(scroll, previous, next, image, viewport) {
  const axis = (offset, size, available) => {
    const point = (offset + available / 2 - Math.max(0, (available - size * previous) / 2)) / previous;
    const target = point * next + Math.max(0, (available - size * next) / 2) - available / 2;
    return Math.max(0, Math.min(Math.max(0, size * next - available), target));
  };
  return {left: axis(scroll.left, image.width, viewport.width), top: axis(scroll.top, image.height, viewport.height)};
}

/** Mouse drag supplements native scrolling; touch keeps browser pan/pinch gestures. */
export function createReferencePan(viewport) {
  let active = null;
  const end = event => {
    if (!active || event && event.pointerId !== active.id) return;
    const id = active.id; active = null;
    if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  };
  return {
    start(event) {
      if (active) {end(); return false;}
      if (event.pointerType !== 'mouse' || event.button !== 0) return false;
      active = {id:event.pointerId, x:event.clientX, y:event.clientY, left:viewport.scrollLeft, top:viewport.scrollTop};
      viewport.setPointerCapture(active.id); event.preventDefault(); return true;
    },
    move(event) {
      if (!active || event.pointerId !== active.id) return;
      viewport.scrollLeft = active.left + active.x - event.clientX;
      viewport.scrollTop = active.top + active.y - event.clientY;
    },
    end,
  };
}
