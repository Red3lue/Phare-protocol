// Sepolia chain addresses. Defaults are pinned canonical values; project
// addresses (Lighthouse, Registry, SlashPool) are read from env at call
// time so consumers can load a custom .env path before invoking
// `resolveAddresses`. Consumers can also pass overrides directly.

/** Sepolia chain id. */
export const SEPOLIA_CHAIN_ID = 11155111;

/** Pinned external infrastructure on Sepolia. */
export const SEPOLIA_INFRA = {
  nameWrapper:    '0x0635513f179D50A207757E05759CbD106d7dFcE8',
  publicResolver: '0x8FADE66B79cC9f707aB26799354482EB93a5B7dD',
  ensRegistry:    '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
  umaOOv3:        '0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944',
  weth:           '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
};

/** ENS namespace under phare.eth. */
export const PHARE_NAMES = {
  vesselParent:   'vessel.phare.eth',
  verifierParent: 'verifier.phare.eth',
};

/** Read project deploy addresses from process.env at call time. */
export function projectAddresses() {
  return {
    lighthouse:     process.env.LIGHTHOUSE,
    reportRegistry: process.env.REPORT_REGISTRY,
    slashPool:      process.env.SLASH_POOL,
  };
}

/**
 * Resolve a full config blob, allowing overrides. Throws if any required
 * address is missing from both arg and env. Reads env at call time.
 */
export function resolveAddresses(overrides = {}) {
  const cfg = {
    ...SEPOLIA_INFRA,
    ...projectAddresses(),
    ...overrides,
  };
  const required = ['lighthouse', 'reportRegistry', 'nameWrapper', 'publicResolver', 'umaOOv3', 'weth'];
  for (const k of required) {
    if (!cfg[k]) {
      throw new Error(`addresses: missing ${k} (set ${k.toUpperCase()} in env or pass as override)`);
    }
  }
  return cfg;
}
