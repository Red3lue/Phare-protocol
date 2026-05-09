// ENS ledger writer — mocked.
//
// Builds vessel + verifier record snapshots and re-renders the two
// ledger markdown files at the project root on every pipeline run.
// Mirrors the on-chain text-record set from LIGHTHOUSE_SPEC.md §6.

import { writeFile } from 'node:fs/promises';
import { paths } from './paths.mjs';

const VESSELS_HEADER = `# ENS — Vessel records ledger

> Mock ledger of \`imo-N.vessel.phare.eth\` ENS text records as written by
> the orbital-orchestrator pipeline. Mirrors the on-chain Lighthouse
> contract writes specified in LIGHTHOUSE_SPEC.md §6. Not authoritative —
> the chain is ground truth. Auto-regenerated on every pipeline run.

`;

const VERIFIERS_HEADER = `# ENS — Verifier records ledger

> Mock ledger of \`<handle>.verifier.phare.eth\` ENS text records emitted
> by the orbital-orchestrator pipeline (acting in lieu of a live verifier
> skill). Mirrors LIGHTHOUSE_SPEC.md §6. Auto-regenerated on every
> pipeline run.

`;

export const vesselSubname = imo => `imo-${imo}.vessel.phare.eth`;
export const verifierSubname = handle => `${handle}.verifier.phare.eth`;

/**
 * Build a vessel ENS record snapshot. Avatar + orbital.image both point
 * at the latest fetched space image so an ENS-aware UI shows it as the
 * vessel's profile picture (LIGHTHOUSE_SPEC.md §6.1).
 */
export function buildVesselRecord({ imo, timestamp, imageLocalPath, imageMime, imageHashHex, avatarRef, inference }) {
  return {
    subname:   vesselSubname(imo),
    updatedAt: new Date(timestamp).toISOString(),
    records: {
      'vessel.imo':                    String(imo),
      'avatar':                        avatarRef,
      'vessel.orbital.image':          avatarRef,
      'vessel.orbital.imageHash':      `0x${imageHashHex}`,
      'vessel.orbital.tee.prediction': `${inference.destination} (confidence ${inference.confidence}, mocked)`,
      'vessel.orbital.tee.lat':        String(inference.destinationLat),
      'vessel.orbital.tee.lon':        String(inference.destinationLon),
    },
    meta: {
      localImage: imageLocalPath,
      imageMime,
      inference,
    },
  };
}

/**
 * Build a verifier ENS activity snapshot. Records align with the verifier
 * namespace in LIGHTHOUSE_SPEC.md §6.2.
 */
export function buildVerifierActivity({ handle, imo, timestamp, decision }) {
  return {
    subname:   verifierSubname(handle),
    updatedAt: new Date(timestamp).toISOString(),
    records: {
      'verifier.handle':       handle,
      'verifier.runtime':      'orbital-orchestrator-mock',
      'verifier.lastDecision': `${decision.destination} (mock inference, confidence ${decision.confidence})`,
    },
    meta: {
      lastImo: String(imo),
    },
  };
}

function shorten(value) {
  const s = String(value);
  if (s.startsWith('data:') && s.length > 80) {
    return `${s.slice(0, 60)}… (data URI, ${(s.length / 1024).toFixed(1)} KB)`;
  }
  return s;
}

function renderEntry(entry) {
  let s = `\n## ${entry.subname}\n\n`;
  s += `_last update: \`${entry.updatedAt}\`_\n\n`;
  s += `| key | value |\n|---|---|\n`;
  for (const [k, v] of Object.entries(entry.records)) {
    s += `| \`${k}\` | \`${shorten(v)}\` |\n`;
  }
  if (entry.meta?.localImage) {
    s += `\n**Local image:** \`${entry.meta.localImage}\` (\`${entry.meta.imageMime}\`)\n`;
  }
  if (entry.meta?.lastImo) {
    s += `\n**Last sighting touched:** \`imo-${entry.meta.lastImo}\`\n`;
  }
  return s;
}

export async function renderVesselsLedger(state) {
  const entries = Object.values(state.vessels).sort((a, b) => a.subname.localeCompare(b.subname));
  let body = VESSELS_HEADER;
  body += entries.length === 0 ? '_No vessels recorded yet._\n' : entries.map(renderEntry).join('');
  await writeFile(paths.ensVesselsMd, body);
}

export async function renderVerifiersLedger(state) {
  const entries = Object.values(state.verifiers).sort((a, b) => a.subname.localeCompare(b.subname));
  let body = VERIFIERS_HEADER;
  body += entries.length === 0 ? '_No verifier activity recorded yet._\n' : entries.map(renderEntry).join('');
  await writeFile(paths.ensVerifiersMd, body);
}
