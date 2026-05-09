// Persistent state for the orchestrator. Keeps a JSON snapshot of every
// vessel and verifier seen so the ENS ledgers can be re-rendered as a
// stable "current state" view, not append-only churn.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths.mjs';

const EMPTY_STATE = { vessels: {}, verifiers: {} };

export async function loadState() {
  if (!existsSync(paths.stateFile)) return structuredClone(EMPTY_STATE);
  try {
    return JSON.parse(await readFile(paths.stateFile, 'utf8'));
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export async function saveState(state) {
  await mkdir(dirname(paths.stateFile), { recursive: true });
  await writeFile(paths.stateFile, JSON.stringify(state, null, 2));
}
