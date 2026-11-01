import React, {useEffect, useRef} from 'react';
import {createArtworkPreview} from '../artwork-preview.js';
// This legacy preview owns its complete static subtree, decoding, and finite animation.
// React never writes inside it; the controller calls application commands directly.
const markup = "<dialog id=\"artwork-preview\" class=\"artwork-preview glass-surface\" aria-labelledby=\"artwork-preview-title\" aria-describedby=\"artwork-preview-status\">\n<div class=\"artwork-preview-content\">\n<div class=\"preview-heading\">\n<div>\n<h2 id=\"artwork-preview-title\">Artwork</h2>\n<p id=\"artwork-preview-position\">\n</p>\n</div>\n<div class=\"preview-actions\">\n<details class=\"preview-menu\">\n<summary aria-label=\"Artwork options\">···</summary>\n<div class=\"preview-menu-content glass-surface\">\n<button type=\"button\" id=\"artwork-preview-remove\">Remove from library</button>\n</div>\n</details>\n<button type=\"button\" data-preview-close aria-label=\"Close artwork preview\">Close</button>\n</div>\n</div>\n<div class=\"preview-paper\">\n<img id=\"artwork-preview-image\" alt=\"\" width=\"800\" height=\"800\" hidden>\n<canvas id=\"artwork-preview-canvas\" aria-hidden=\"true\" hidden>\n</canvas>\n<p id=\"artwork-preview-status\" role=\"status\">\n</p>\n</div>\n<div class=\"preview-toolbar\">\n<nav aria-label=\"Browse artwork\">\n<button type=\"button\" id=\"artwork-preview-previous\">Previous</button>\n<button type=\"button\" id=\"artwork-preview-next\">Next</button>\n</nav>\n<button type=\"button\" id=\"artwork-preview-add\" class=\"primary\">Add to study</button>\n</div>\n</div>\n</dialog>";
export function ArtworkPreview({app}) {
  const host = useRef(null);
  useEffect(() => {
    const adapter = createArtworkPreview({dialog: host.current.querySelector('dialog'),
      onAdd: id => app.actions.addArtwork(id), onRemove: id => app.actions.removeArtwork(id)});
    app.setArtworkPreview(adapter);
    return () => {app.setArtworkPreview(null); adapter.destroy();};
  }, [app]);
  return <div ref={host} dangerouslySetInnerHTML={{__html: markup}} />;
}
