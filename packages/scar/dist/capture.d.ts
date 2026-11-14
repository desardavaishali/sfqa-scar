import type { ScarRule } from './types.js';
export declare const DEFAULT_CAPTURE_FILE = "scar-tissue.candidates.json";
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
export declare function emptyQueue(): CaptureQueue;
export declare function loadCaptureQueue(path: string): CaptureQueue;
export declare function saveCaptureQueue(path: string, queue: CaptureQueue): void;
export declare function findCapture(queue: CaptureQueue, entryFingerprint: string): CaptureEntry | undefined;
export declare function addCapture(queue: CaptureQueue, entry: CaptureEntry): void;
