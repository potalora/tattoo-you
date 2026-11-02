/** Attach native-disclosure dismissal for the study actions menu. */
export function bindStudyMenuDismissal(menu) {
  const document = menu.ownerDocument;
  const keydown = event => {
    if (!menu.open || event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    menu.removeAttribute('open');
    menu.querySelector(':scope > summary')?.focus();
  };
  const pointerdown = event => {
    if (menu.open && !menu.contains(event.target)) menu.removeAttribute('open');
  };
  document.addEventListener('keydown', keydown);
  document.addEventListener('pointerdown', pointerdown, {capture: true});
  return () => {
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('pointerdown', pointerdown, {capture: true});
  };
}
