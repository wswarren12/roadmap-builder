'use client';

/**
 * Copy text with a fallback that works inside the LabOS dashboard iframe.
 * The async Clipboard API needs the `clipboard-write` permission, which a
 * cross-origin iframe doesn't get unless the embedder's <iframe allow=...>
 * grants it — so navigator.clipboard.writeText rejects there. The hidden
 * textarea + execCommand('copy') path still works in that context.
 * Returns true when the text made it to the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to execCommand
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
