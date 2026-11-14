import { useEffect, useRef } from 'react';

// A modal owns keyboard focus until it closes, then returns it to its opener.
export default function useDialogFocus(dialogRef, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const opener = document.activeElement;
    const controls = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
      .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    (controls()[0] ?? dialog).focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = controls();
      const first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [dialogRef]);
}
