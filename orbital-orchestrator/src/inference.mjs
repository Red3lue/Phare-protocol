// Mocked TEE inference per DESIGN_DOCUMENT §7.2.
//
// Picks a destination port deterministically from ports.json based on the
// IMO (so the same vessel always points at the same port for demos).
// Output JSON always carries `mocked: true` so consumers can filter.

import { readFileSync } from 'node:fs';
import { paths } from './paths.mjs';

let portsCache = null;

function loadPorts() {
  if (portsCache) return portsCache;
  const raw = readFileSync(paths.portsJson, 'utf8');
  portsCache = JSON.parse(raw).ports;
  return portsCache;
}

/**
 * @param {object} input
 * @param {number|string|bigint} input.imo
 * @param {number} [input.lat]
 * @param {number} [input.lon]
 * @returns {{destination:string,destinationLat:number,destinationLon:number,confidence:number,mocked:true,method:string}}
 */
export function inferDestination({ imo }) {
  const ports = loadPorts();
  if (ports.length === 0) throw new Error('ports.json has no ports');

  const idx = Number(BigInt(imo) % BigInt(ports.length));
  const port = ports[idx];

  const confidence = port.shadow_fleet_known ? 0.78 : 0.55;

  return {
    destination:    `${port.name}, ${port.country}`,
    destinationLat: port.lat,
    destinationLon: port.lon,
    confidence,
    mocked:         true,
    method:         'imo-modulo',
  };
}
