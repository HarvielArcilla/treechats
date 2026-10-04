/* Hides things that look like secrets in command output and git diffs before they reach the page, and so before
   they can be sent to Claude: API keys and tokens with a known shape, private keys, passwords in URLs, and the
   value in lines like API_KEY=… . Files themselves are never changed, since they can be saved back to disk; and a
   .env file starts unticked when a folder is linked. This catches the common cases, not every secret there is. */
const HIDDEN = '[hidden secret]';
const SHAPES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,                               // Anthropic
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,          // OpenAI
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g,                    // Stripe
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,                             // AWS access key ids
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, /\bgithub_pat_[A-Za-z0-9_]{40,}/g, // GitHub
  /\bglpat-[A-Za-z0-9_-]{20,}/g,                                // GitLab
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                            // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g,                                 // Google
  /\bnpm_[A-Za-z0-9]{36}\b/g,                                   // npm
  /\bhf_[A-Za-z0-9]{30,}\b/g,                                   // Hugging Face
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
];
/* NAME=value, NAME: value, "name": "value", where the name says it is a secret */
const ASSIGN = /((?:^|[^A-Za-z0-9_])["']?[A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(["']?)([^\s"',;]{8,})\2/gi;
/* values that are code, not secrets: a variable, a call, an env lookup, a template */
const CODE = /^(?:\$|process\.|os\.|env\b|import\.|<|\{|\[|%|\(|[A-Za-z_][\w.]*\(|true$|false$|null$|undefined$|None$)|[()]/;
const URL_PW = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]{3,})@/gi;

export function redact(text: string): { text: string; hidden: number } {
  let hidden = 0;
  let out = text;
  for (const re of SHAPES) out = out.replace(re, () => { hidden++; return HIDDEN; });
  out = out.replace(URL_PW, (_m, a) => { hidden++; return `${a}${HIDDEN}@`; });
  out = out.replace(ASSIGN, (m, a, q, v) => {
    if (v === HIDDEN || v.startsWith('[hidden') || CODE.test(v)) return m;
    hidden++; return `${a}${q}${HIDDEN}${q}`;
  });
  return { text: out, hidden };
}
