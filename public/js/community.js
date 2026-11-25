/**
 * Shareable community alert: copy to clipboard (with a select-text fallback)
 * and the native share sheet where available.
 */

import { byId } from './dom.js';

const COPIED = 'Alert copied — paste it into your group chat.';
const COPY_BLOCKED = 'Copy is blocked here — the text is selected, press Ctrl+C / ⌘+C.';

/** @returns {string} */
const alertText = () => byId('community-alert').textContent ?? '';

/**
 * Shows the alert text and the Share button only where the Web Share API exists.
 * @param {string} text
 */
export function renderCommunityAlert(text) {
  byId('community-alert').textContent = text;
  byId('copy-status').textContent = '';
  byId('share-alert').hidden = typeof navigator.share !== 'function';
}

/** Selects the alert text so the user can copy it manually. */
function selectAlertText() {
  const range = document.createRange();
  range.selectNodeContents(byId('community-alert'));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Wires the Copy / Share buttons (call once on load). */
export function initCommunityAlert() {
  byId('copy-alert').addEventListener('click', async () => {
    const status = byId('copy-status');
    try {
      await navigator.clipboard.writeText(alertText());
      status.textContent = COPIED;
    } catch {
      // Clipboard can be blocked (permissions / insecure context): select the text instead.
      selectAlertText();
      status.textContent = COPY_BLOCKED;
    }
  });

  byId('share-alert').addEventListener('click', async () => {
    try {
      await navigator.share({ title: 'Air alert', text: alertText() });
    } catch {
      /* user cancelled the share sheet */
    }
  });
}
