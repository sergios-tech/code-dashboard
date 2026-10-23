// Credential masking. Everything the pane stores about a tool call passes through here first.

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?[^\s"']+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"']+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])[^\s"']+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)[^\s"']+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
]

/** `s` with credentials masked: auth headers, bearer and vendor tokens, key/secret assignments, URL passwords. */
export const redact = (s: string): string => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * One line saying what a call was about, `<tool> → <command|path|pattern|url|description>`, redacted.
 * A path keeps only its last two segments, split on `/` or `\`.
 */
export const describeInput = (tool: string, input: unknown): string => {
  const i = isRecord(input) ? input : {}
  const path = typeof i.file_path === 'string' ? i.file_path.split(/[\\/]/).slice(-2).join('/') : ''
  const what =
    typeof i.command === 'string'
      ? i.command
      : path ||
        (typeof i.pattern === 'string'
          ? i.pattern
          : typeof i.url === 'string'
            ? i.url
            : typeof i.description === 'string'
              ? i.description
              : '')
  return redact(what ? `${tool} → ${what}` : tool)
}
