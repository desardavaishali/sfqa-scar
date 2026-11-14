// packages/scar/src/redact.ts
// -----------------------------------------------------------------------------
// Discovery reads failures, and failures sometimes contain the secret that
// caused them. Nothing from a credential-shaped line reaches stdout, a JSON
// report or a draft. The name stays; the value is replaced.
// -----------------------------------------------------------------------------
const SECRET_NAME = /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|credential|authorization|bearer|private[_-]?key|access[_-]?key)\b/i;
export function redactLine(line) {
    if (!SECRET_NAME.test(line))
        return line;
    return line
        .replace(/(['"])([^'"\n]{2,})\1/g, '$1<redacted>$1')
        .replace(/(=\s*)([^\s;,'"]+)/, '$1<redacted>');
}
export function redactText(text) {
    return text.split('\n').map(redactLine).join('\n');
}
export function isSecretShaped(line) {
    return redactLine(line) !== line;
}
