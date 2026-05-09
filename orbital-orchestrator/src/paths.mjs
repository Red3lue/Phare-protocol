// Centralised path constants for the orchestrator.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR  = resolve(__dirname, '..');
const PROJECT_ROOT = resolve(PACKAGE_DIR, '..');

export const paths = {
  packageDir:    PACKAGE_DIR,
  projectRoot:   PROJECT_ROOT,
  imagesDir:     resolve(PACKAGE_DIR, 'images'),
  stateFile:     resolve(PACKAGE_DIR, 'state', 'state.json'),
  portsJson:     resolve(PROJECT_ROOT, 'ports.json'),
  ensVesselsMd:  resolve(PROJECT_ROOT, 'ENS_VESSELS.md'),
  ensVerifiersMd: resolve(PROJECT_ROOT, 'ENS_VERIFIERS.md'),
};
