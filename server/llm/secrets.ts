import { ProviderError } from './types.ts';

/** Bounded, best-effort reflection guard, not general DLP. Never serialize keys. */
export class SecretGuard {
  #needles: string[];
  #fragments: string[] = [];
  constructor(key: string) {
    this.#needles = key ? [key, encodeURIComponent(key), Buffer.from(key).toString('base64').replace(/=+$/, ''),
      Buffer.from(key).toString('base64url'), Buffer.from(key).toString('hex')]
      .map(value => value.toLowerCase()) : [];
    const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Seven compact characters for keys of at least twelve; shorter fragments
    // are too collision-prone to treat as credentials.
    if (compact.length >= 12) for (let i = 0; i <= compact.length - 7; i++) this.#fragments.push(compact.slice(i, i + 7));
  }
  reflects(text: string): boolean {
    if (!this.#needles.length) return false;
    let candidates = [text];
    // Two decoding layers cover double Base64, including URL-safe/unpadded
    // variants and hex. No recursive unbounded decoding of upstream content.
    for (let depth = 0; depth <= 2; depth++) {
      const next: string[] = [];
      for (let decoded of candidates) {
        try { decoded = decodeURIComponent(decoded); } catch { /* keep malformed percent sequences literal */ }
        decoded = decoded.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        const lower = decoded.toLowerCase(), compact = lower.replace(/[^a-z0-9]/g, '');
        if (this.#needles.some(value => lower.includes(value)) || this.#fragments.some(value => compact.includes(value))) return true;
        if (depth === 2) continue;
        for (const match of decoded.matchAll(/[a-zA-Z0-9+/_=-]{8,}/g)) {
          const token = match[0];
          if (token.length > 131072) continue;
          next.push(Buffer.from(token, 'base64url').toString('utf8'));
          if (/^(?:[0-9a-f]{2}){4,}$/i.test(token)) next.push(Buffer.from(token, 'hex').toString('utf8'));
        }
      }
      candidates = next;
    }
    return false;
  }
  /** An export must fail closed, without including rejected content in errors. */
  assertSafe(value: unknown): void {
    if (this.reflects(typeof value === 'string' ? value : JSON.stringify(value) ?? '')) throw new ProviderError('schema');
  }
}
