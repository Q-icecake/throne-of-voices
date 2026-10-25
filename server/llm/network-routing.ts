import { execFileSync } from 'node:child_process';
import { Agent, ProxyAgent } from 'undici';
import type { Dispatcher } from 'undici';
import type { NetworkMode, NetworkRoute } from '../../shared/contracts.ts';
import { ProviderError } from './types.ts';

export interface SystemProxy { enabled: boolean; server: string; pac: boolean }
export type SystemProxyReader = () => SystemProxy;
const noProxy = (): SystemProxy => ({ enabled: false, server: '', pac: false });
/** Read only the requested HKCU values. Never execute PAC or publish registry output. */
export function readWindowsProxy(platform = process.platform, query = (name: string) => execFileSync('reg.exe',
  ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name],
  { encoding: 'utf8', windowsHide: true, timeout: 750, stdio: ['ignore', 'pipe', 'pipe'] })): SystemProxy {
  if (platform !== 'win32') return noProxy();
  const read = (name: string) => {
    try { return query(name).match(new RegExp(`\\b${name}\\s+REG_\\w+\\s+([^\\r\\n]*)`))?.[1]?.trim() ?? ''; }
    catch { return ''; }
  };
  return { enabled: /^(?:0x)?0*1$/i.test(read('ProxyEnable')), server: read('ProxyServer'), pac: !!read('AutoConfigURL') };
}

export function normalizeProxy(value: string): string {
  if (value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) throw new ProviderError('request');
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash)
      throw new Error();
    return url.href;
  } catch { throw new ProviderError('request'); }
}

function systemAddress(server: string): string {
  if (!server.includes('=')) return server.trim();
  const entries = new Map(server.split(';').map(entry => {
    const index = entry.indexOf('='); return [entry.slice(0, index).trim().toLowerCase(), entry.slice(index + 1).trim()];
  }));
  return entries.get('https') || entries.get('http') || '';
}

/** Contains a private address; only metadata() may cross the status/log boundary. */
export class NetworkSelection {
  #proxy: string;
  #invalid: boolean;
  readonly networkMode: NetworkMode;
  readonly route: NetworkRoute;
  readonly pacUnsupported: boolean;
  constructor(mode: NetworkMode, route: NetworkRoute, proxy = '', pac = false) {
    this.networkMode = mode; this.route = route; this.pacUnsupported = pac;
    try { this.#proxy = proxy ? normalizeProxy(proxy) : ''; this.#invalid = mode === 'proxy' && !proxy; }
    catch { this.#proxy = ''; this.#invalid = true; }
  }
  metadata() { return { networkMode: this.networkMode, route: this.route }; }
  proxyRefused(error: unknown): boolean {
    if (!this.#proxy) return false;
    const url = new URL(this.#proxy), host = url.hostname.replace(/^\[|\]$/g, ''), port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const walk = (value: unknown, depth: number): boolean => {
      if (!value || typeof value !== 'object' || depth > 4) return false;
      const item = value as Record<string, unknown>;
      return item.code === 'ECONNREFUSED' && item.port === port &&
        (item.address === host || item.hostname === host || host === 'localhost' && ['127.0.0.1', '::1'].includes(String(item.address))) ||
        walk(item.cause, depth + 1) || Array.isArray(item.errors) && item.errors.slice(0, 4).some(child => walk(child, depth + 1));
    };
    return walk(error, 0);
  }
  async fetch(transport: typeof fetch, url: string, init: RequestInit): Promise<Response> {
    // Never alter local/Vite or other-provider requests, nor the global dispatcher/environment.
    if (new URL(url).hostname !== 'generativelanguage.googleapis.com') return transport(url, init);
    if (this.#invalid) throw Object.assign(new Error(), { code: this.route === 'direct' ? 'PROXY_NOT_CONFIGURED' : 'PROXY_CONFIG_INVALID' });
    const dispatcher: Dispatcher = this.#proxy
      ? new ProxyAgent({ uri: this.#proxy, autoSelectFamily: false, allowH2: false })
      : new Agent({ autoSelectFamily: false, allowH2: false });
    try { return await transport(url, { ...init, dispatcher } as RequestInit); }
    finally { void dispatcher.close().catch(() => {}); }
  }
}

export class NetworkRouter {
  #mode: NetworkMode = 'auto';
  #manual = '';
  #env: NodeJS.ProcessEnv;
  #read: SystemProxyReader;
  constructor(env: NodeJS.ProcessEnv, read?: SystemProxyReader) {
    this.#env = env;
    // Synthetic/offline transports must opt in to a fake registry instead of inspecting this PC.
    this.#read = read ?? (process.env.NODE_TEST_CONTEXT || process.env.LLM_DIAGNOSTIC_SOURCE === 'test' ? noProxy : readWindowsProxy);
  }
  configure(mode: NetworkMode, address = '') {
    if (!['auto', 'proxy', 'direct'].includes(mode)) throw new ProviderError('request');
    const normalized = address ? normalizeProxy(address) : '';
    this.#mode = mode; if (normalized) this.#manual = normalized;
  }
  clearManual() { this.#manual = ''; }
  select(): NetworkSelection {
    if (this.#mode === 'direct') return new NetworkSelection('direct', 'direct');
    if (this.#manual) return new NetworkSelection(this.#mode, 'manual-proxy', this.#manual);
    const env = this.#env.HTTPS_PROXY || this.#env.https_proxy || this.#env.HTTP_PROXY || this.#env.http_proxy;
    if (env) return new NetworkSelection(this.#mode, 'env-proxy', env);
    let system: SystemProxy;
    try { system = this.#read(); } catch { system = noProxy(); }
    const address = system.enabled ? systemAddress(system.server) : '';
    return new NetworkSelection(this.#mode, address ? 'system-proxy' : 'direct', address, system.pac);
  }
  status() { const selection = this.select(); return { ...selection.metadata(), pacUnsupported: selection.pacUnsupported, manualProxyConfigured: !!this.#manual }; }
}
