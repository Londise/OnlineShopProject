const STORAGE_KEY = 'ferchu.checkout.submission';
let inMemory;
const browserStorage = () => { try { return globalThis.sessionStorage; } catch { return undefined; } };

// Store a digest and a random capability, never customer contact data.
// An uncertain response retains the key, including after reloading this tab.
export async function submissionKey(body, storage = browserStorage()) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  const fingerprint = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  let previous = inMemory;
  try { previous = JSON.parse(storage.getItem(STORAGE_KEY)); } catch { /* Restricted browser storage. */ }
  const key = previous?.fingerprint === fingerprint && /^[0-9a-f-]{36}$/i.test(previous.key ?? '')
    ? previous.key : globalThis.crypto.randomUUID();
  inMemory = { fingerprint, key };
  try { storage.setItem(STORAGE_KEY, JSON.stringify(inMemory)); } catch { /* Keep retry safety in memory. */ }
  return key;
}

export function acknowledgeSubmission(key, storage = browserStorage()) {
  if (inMemory?.key === key) inMemory = undefined;
  try {
    if (JSON.parse(storage.getItem(STORAGE_KEY))?.key === key) storage.removeItem(STORAGE_KEY);
  } catch { /* Restricted browser storage. */ }
}
