// JSON-RPC transport for the Orbitport gateway.
//
// The gateway exposes a single `plugin.Call` method which dispatches by
// (plugin, method) string pair to the matching gRPC plugin sidecar. We hide
// that envelope behind pluginCall() so callers just supply the method name
// and request body.

const DEFAULT_GATEWAY = 'http://localhost:8080';
const DEFAULT_BEARER  = 'dev';
const DEFAULT_PLUGIN  = 'orbitalimager';

let _id = 1;

/**
 * @typedef {object} GatewayOpts
 * @property {string} [gateway]  base URL (default http://localhost:8080)
 * @property {string} [bearer]   bearer token (default 'dev')
 * @property {string} [plugin]   plugin name (default 'orbitalimager')
 * @property {AbortSignal} [signal]
 * @property {number} [timeoutMs] (default 30000)
 */

/**
 * Invoke a plugin method through the gateway and return the proto3-JSON
 * `result` object. Throws on transport failure or JSON-RPC error.
 *
 * @param {string} method   e.g. "orbitalimager.OrbitalImagerPlugin.GetImageMetadata"
 * @param {object} request  proto fields (camelCase)
 * @param {GatewayOpts} [opts]
 * @returns {Promise<any>}
 */
export async function pluginCall(method, request = {}, opts = {}) {
  const {
    gateway   = DEFAULT_GATEWAY,
    bearer    = DEFAULT_BEARER,
    plugin    = DEFAULT_PLUGIN,
    signal,
    timeoutMs = 30_000,
  } = opts;

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new Error(`pluginCall ${method} timed out`)), timeoutMs);

  try {
    const res = await fetch(`${gateway.replace(/\/$/, '')}/api/v1/rpc`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: _id++,
        method: 'plugin.Call',
        params: { plugin, method, request },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new GatewayError(`HTTP ${res.status} ${res.statusText}: ${body}`);
    }

    const json = await res.json();
    if (json.error) {
      throw new GatewayError(`JSON-RPC error: ${JSON.stringify(json.error)}`, json.error);
    }
    return json.result ?? {};
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export class GatewayError extends Error {
  constructor(message, jsonRpcError = null) {
    super(message);
    this.name = 'GatewayError';
    this.jsonRpcError = jsonRpcError;
  }
}
