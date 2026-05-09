// Swarm pinning — empty function. Wired in a future iteration.
//
// Once a Bee node is reachable, this should pin the bytes via the
// `/bzz` endpoint and return `{ swarmRef: 'bzz://<hash>', mocked: false }`.
// Until then the orchestrator falls back to a `bzz://<keccak256>`
// placeholder so the rest of the pipeline still has something to write
// into the ENS `avatar` and `vessel.orbital.image` records.

/**
 * @param {object} opts
 * @param {Buffer} opts.bytes
 * @param {string} [opts.hint]
 * @returns {Promise<{swarmRef: string|null, mocked: boolean}>}
 */
export async function uploadToSwarm(_opts) {
  // TODO: POST opts.bytes to a Bee endpoint, return the bzz reference.
  return { swarmRef: null, mocked: true };
}
