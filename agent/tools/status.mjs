// Read-only status dump. Used by Claude to introspect current phase,
// wallet, ENS handle, last-seen UMA scan position, and stats.

import { readState, readWallet, emit } from './_common.mjs';

const state  = readState();
const wallet = readWallet();

emit({
  ok: true,
  phase:   state.phase,
  handle:  state.handle,
  node:    state.node,
  address: wallet?.address ?? null,
  hasWallet: Boolean(wallet),
  lastSeenBlock: state.lastSeenBlock,
  seenReports:   state.seenReports.length,
  stats: state.stats,
});
