// packages/scar/src/ignore.ts
// -----------------------------------------------------------------------------
// The ignore ledger. When a person says "do not ask me about this again", that
// decision is data in the repository, reviewed like code. It is not a hidden
// cache, so it can be audited, diffed and reversed.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_IGNORE_FILE = 'scar-tissue.ignore.json';

export interface IgnoreEntry {
  /** Content fingerprint of the candidate that was dismissed. */
  fingerprint: string;
  reason: string;
  at: string;
  subject?: string;
}

export interface IgnoreLedger {
  version: number;
  ignored: IgnoreEntry[];
}

export function emptyLedger(): IgnoreLedger {
  return { version: 1, ignored: [] };
}

export function loadIgnoreLedger(path: string): IgnoreLedger {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<IgnoreLedger>;
    const ignored = Array.isArray(raw.ignored)
      ? raw.ignored.filter(
          (entry): entry is IgnoreEntry =>
            Boolean(entry) && typeof entry.fingerprint === 'string',
        )
      : [];
    return { version: 1, ignored };
  } catch {
    return emptyLedger();
  }
}

export function saveIgnoreLedger(path: string, ledger: IgnoreLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

export function findIgnore(
  ledger: IgnoreLedger,
  entryFingerprint: string,
): IgnoreEntry | undefined {
  return ledger.ignored.find((entry) => entry.fingerprint === entryFingerprint);
}

export function addIgnore(ledger: IgnoreLedger, entry: IgnoreEntry): void {
  const existing = ledger.ignored.findIndex((item) => item.fingerprint === entry.fingerprint);
  if (existing === -1) ledger.ignored.push(entry);
  else ledger.ignored[existing] = { ...ledger.ignored[existing], ...entry };
}
