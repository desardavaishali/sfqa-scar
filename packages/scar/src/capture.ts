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

import type { ScarRule } from './types.js';

export const DEFAULT_CAPTURE_FILE = 'scar-tissue.candidates.json';

export interface CaptureEntry {
  /** Content fingerprint of the candidate that was captured. */
  fingerprint: string;
  capturedAt: string;
  subject?: string;
  files?: string[];
  /** The draft a person still has to review and prove. */
  draft?: ScarRule;
}

export interface CaptureQueue {
  version: number;
  candidates: CaptureEntry[];
}

export function emptyQueue(): CaptureQueue {
  return { version: 1, candidates: [] };
}

export function loadCaptureQueue(path: string): CaptureQueue {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<CaptureQueue>;
    const candidates = Array.isArray(raw.candidates)
      ? raw.candidates.filter(
          (entry): entry is CaptureEntry =>
            Boolean(entry) && typeof entry.fingerprint === 'string',
        )
      : [];
    return { version: 1, candidates };
  } catch {
    return emptyQueue();
  }
}

export function saveCaptureQueue(path: string, queue: CaptureQueue): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}

export function findCapture(
  queue: CaptureQueue,
  entryFingerprint: string,
): CaptureEntry | undefined {
  return queue.candidates.find((entry) => entry.fingerprint === entryFingerprint);
}

export function addCapture(queue: CaptureQueue, entry: CaptureEntry): void {
  const existing = queue.candidates.findIndex(
    (item) => item.fingerprint === entry.fingerprint,
  );
  if (existing === -1) queue.candidates.push(entry);
  else queue.candidates[existing] = { ...queue.candidates[existing], ...entry };
}
