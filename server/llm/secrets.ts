import { ProviderError } from './types.ts';

/** Bounded, best-effort reflection guard, not general DLP. Never serialize keys. */
export class SecretGuard {
  #needles: string[];
  #fragments: string[] = [];
  constructor(key: string) {
    this.#needles = key ? [key, encodeURIComponent(key), Buffer.from(key).toString('base64').replace(/=+$/, ''),
      Buffer.from(key).toString('base64url'), Buffer.from(key).toString('hex')]
      .map(compact) : [];
    const keyCompact = compact(key);
    // Seven compact characters for keys of at least twelve; shorter fragments
    // are too collision-prone to treat as credentials.
    if (keyCompact.length >= 12) for (let i = 0; i <= keyCompact.length - 7; i++) this.#fragments.push(keyCompact.slice(i, i + 7));
    // Six-character mixed-case alphanumeric pieces cover the review's shuffled
    // chunks without treating ordinary six-letter words (e.g. Review) as keys.
    if (keyCompact.length >= 12) for (let i = 0; i <= key.length - 6; i++) {
      const part = key.slice(i, i + 6);
      if (/^[a-zA-Z0-9]{6}$/.test(part) && /[a-z]/.test(part) && /[A-Z]/.test(part) && /\d/.test(part)) this.#fragments.push(part.toLowerCase());
    }
    // Detect substantial encoded partial reflections, as well as decoded ones.
    for (const value of this.#needles.slice(2)) if (value.length >= 24)
      for (let i = 0; i <= value.length - 16; i++) this.#fragments.push(value.slice(i, i + 16));
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
        decoded = decoded.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\[nrt]/g, ' ').replace(/0x(?=[0-9a-f]{2}(?:[^0-9a-f]|$))/gi, '');
        const normalized = compact(decoded);
        if (this.#needles.some(value => normalized.includes(value)) || this.#fragments.some(value => normalized.includes(value))) return true;
        if (depth === 2) continue;
        // Join separated hex pairs / Base64 quads before decoding. Keep a
        // second spelling because '-' can be either a separator or Base64url.
        const tokens = new Set<string>();
        for (const match of decoded.matchAll(/[a-zA-Z0-9+/_=-]+(?:[:\s.,·]+[a-zA-Z0-9+/_=-]+)*/g)) {
          tokens.add(match[0].replace(/[:\s.,·]/g, ''));
          tokens.add(match[0].replace(/[:\s.,·-]/g, ''));
        }
        // Individual tokens also matter inside English prose / JSON.
        for (const match of decoded.matchAll(/[a-zA-Z0-9+/_=-]{8,}/g)) tokens.add(match[0]);
        for (const token of tokens) {
          if (token.length < 8) continue;
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

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
