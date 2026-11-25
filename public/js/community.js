/**
 * Shareable community alert: copy to clipboard (with a select-text fallback)
 * and the native share sheet where available.
 */

export function renderCommunityAlert(text) {
  document.getElementById('community-alert').textContent = text;
  document.getElementById('copy-status').textContent = '';
  document.getElementById('share-alert').hidden = typeof navigator.share !== 'function';
}

/** Wires the copy / share buttons (call once). */
export function initCommunityAlert() {
  document.getElementById('copy-alert').addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    const text = document.getElementById('community-alert').textContent;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Alert copied — paste it into your group chat.';
    } catch {
      // Clipboard can be blocked (permissions / insecure context): select the text instead.
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('community-alert'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Copy is blocked here — the text is selected, press Ctrl+C / ⌘+C.';
    }
  });

  document.getElementById('share-alert').addEventListener('click', async () => {
    try {
      await navigator.share({ title: 'Air alert', text: document.getElementById('community-alert').textContent });
    } catch {
      /* user cancelled the share sheet */
    }
  });
}
