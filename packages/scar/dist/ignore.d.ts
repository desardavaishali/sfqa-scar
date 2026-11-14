export declare const DEFAULT_IGNORE_FILE = "scar-tissue.ignore.json";
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
export declare function emptyLedger(): IgnoreLedger;
export declare function loadIgnoreLedger(path: string): IgnoreLedger;
export declare function saveIgnoreLedger(path: string, ledger: IgnoreLedger): void;
export declare function findIgnore(ledger: IgnoreLedger, entryFingerprint: string): IgnoreEntry | undefined;
export declare function addIgnore(ledger: IgnoreLedger, entry: IgnoreEntry): void;
