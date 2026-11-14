// packages/scar/src/capture.ts
// -----------------------------------------------------------------------------
// The capture queue. A "yes" at commit time means "keep this incident, I will
// write the rule" - so the decision has to outlive the shell. The queue is
// committed data, not a cache: a reviewer can see every incident a person
// promised to turn into a rule, and delete an entry they disagree with.
//
// It stores the draft, not the rule. Nothing here is enforced until a person
// moves it into the rule set and proves it with fixtures.
// -----------------------------------------------------------------------------
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export const DEFAULT_CAPTURE_FILE = 'scar-tissue.candidates.json';
export function emptyQueue() {
    return { version: 1, candidates: [] };
}
export function loadCaptureQueue(path) {
    try {
        const raw = JSON.parse(readFileSync(path, 'utf8'));
        const candidates = Array.isArray(raw.candidates)
            ? raw.candidates.filter((entry) => Boolean(entry) && typeof entry.fingerprint === 'string')
            : [];
        return { version: 1, candidates };
    }
    catch {
        return emptyQueue();
    }
}
export function saveCaptureQueue(path, queue) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}
export function findCapture(queue, entryFingerprint) {
    return queue.candidates.find((entry) => entry.fingerprint === entryFingerprint);
}
export function addCapture(queue, entry) {
    const existing = queue.candidates.findIndex((item) => item.fingerprint === entry.fingerprint);
    if (existing === -1)
        queue.candidates.push(entry);
    else
        queue.candidates[existing] = { ...queue.candidates[existing], ...entry };
}
