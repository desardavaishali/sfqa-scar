// packages/scar/src/hash.ts
// -----------------------------------------------------------------------------
// Stable fingerprints for the ignore ledger. A decision to ignore a candidate
// must survive a reboot, a rebase and a different shell, so it is keyed on
// content, not on a process id or a line number.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';
export function fingerprint(parts) {
    return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}
