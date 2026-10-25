/** Best-effort reflection guard, not general DLP or a guarantee against arbitrary encodings. */
export class SecretGuard {
  #needles: string[];
  #fragments: string[] = [];
  constructor(key: string) {
    this.#needles = key ? [key, encodeURIComponent(key), Buffer.from(key).toString('base64'), Buffer.from(key).toString('hex')]
      .map(value => value.toLowerCase()) : [];
    const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (compact.length >= 12) for (let i = 0; i <= compact.length - 8; i++) this.#fragments.push(compact.slice(i, i + 8));
  }
  reflects(text: string): boolean {
    let decoded = text;
    try { decoded = decodeURIComponent(decoded); } catch { /* keep malformed percent sequences literal */ }
    decoded = decoded.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    const lower = decoded.toLowerCase(), compact = lower.replace(/[^a-z0-9]/g, '');
    return this.#needles.some(value => lower.includes(value)) || this.#fragments.some(value => compact.includes(value));
  }
}
