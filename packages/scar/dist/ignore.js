// packages/scar/src/ignore.ts
// -----------------------------------------------------------------------------
// The ignore ledger. When a person says "do not ask me about this again", that
// decision is data in the repository, reviewed like code. It is not a hidden
// cache, so it can be audited, diffed and reversed.
// -----------------------------------------------------------------------------
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export const DEFAULT_IGNORE_FILE = 'scar-tissue.ignore.json';
export function emptyLedger() {
    return { version: 1, ignored: [] };
}
export function loadIgnoreLedger(path) {
    try {
        const raw = JSON.parse(readFileSync(path, 'utf8'));
        const ignored = Array.isArray(raw.ignored)
            ? raw.ignored.filter((entry) => Boolean(entry) && typeof entry.fingerprint === 'string')
            : [];
        return { version: 1, ignored };
    }
    catch {
        return emptyLedger();
    }
}
export function saveIgnoreLedger(path, ledger) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}
export function findIgnore(ledger, entryFingerprint) {
    return ledger.ignored.find((entry) => entry.fingerprint === entryFingerprint);
}
export function addIgnore(ledger, entry) {
    const existing = ledger.ignored.findIndex((item) => item.fingerprint === entry.fingerprint);
    if (existing === -1)
        ledger.ignored.push(entry);
    else
        ledger.ignored[existing] = { ...ledger.ignored[existing], ...entry };
}
