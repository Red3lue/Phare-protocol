// CLI-friendly thin wrapper over the `swarm` workspace package.
//
// The library itself takes the gateway URL as an argument (browser-safe,
// no env reads). For Node CLI ergonomics we keep a single env-aware
// entry point here so existing tools (fetch-metadata.mjs, pin-reasoning.mjs,
// enroll.mjs) continue to work without each reading SWARM_BEE_URL.

import {
  verifyAndFetch as _verifyAndFetch,
  verifyAndFetchJson as _verifyAndFetchJson,
  pinImmutable as _pinImmutable,
  verifyAndFetchSoc as _verifyAndFetchSoc,
  verifyAndFetchSocJson as _verifyAndFetchSocJson,
  pinSoc as _pinSoc,
  verifySocChunk,
  makeSocAddressHex,
  parseBzzRef,
  formatBzzRef,
  BmtMismatchError,
  GatewayFetchError,
  SocVerifyError,
  NULL_STAMP,
} from 'swarm';

function gateway() {
  const url = process.env.SWARM_BEE_URL;
  if (!url) throw new Error('SWARM_BEE_URL not set in /agent/.env');
  return url.replace(/\/$/, '');
}

export async function verifyAndFetch(ref, opts = {}) {
  return _verifyAndFetch(ref, { gateway: gateway(), ...opts });
}

export async function verifyAndFetchJson(ref, opts = {}) {
  return _verifyAndFetchJson(ref, { gateway: gateway(), ...opts });
}

export async function pinImmutable(payload, opts = {}) {
  return _pinImmutable(payload, { gateway: gateway(), ...opts });
}

// ─── SOC (mutable) ──────────────────────────────────────────────────────

export async function verifyAndFetchSoc(opts = {}) {
  return _verifyAndFetchSoc({ gateway: gateway(), ...opts });
}

export async function verifyAndFetchSocJson(opts = {}) {
  return _verifyAndFetchSocJson({ gateway: gateway(), ...opts });
}

export async function pinSoc(opts = {}) {
  return _pinSoc({ gateway: gateway(), ...opts });
}

export {
  verifySocChunk,
  makeSocAddressHex,
  parseBzzRef,
  formatBzzRef,
  BmtMismatchError,
  GatewayFetchError,
  SocVerifyError,
  NULL_STAMP,
};
