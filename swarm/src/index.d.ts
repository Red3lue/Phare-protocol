// Type declarations for @phare/swarm (swarm/src/index.js).

export class BmtMismatchError extends Error {
  expected: string;
  recomputed: string;
  constructor(args: { expected: string; recomputed: string });
}

export class GatewayFetchError extends Error {
  url: string;
  status: number;
  constructor(args: { url: string; status: number; statusText: string });
}

export class SocVerifyError extends Error {
  constructor(message: string, extra?: Record<string, unknown>);
}

export function parseBzzRef(ref: string): string;
export function formatBzzRef(hex: string): string;

export interface FetchOpts {
  gateway: string;
  signal?: AbortSignal;
}

export interface VerifiedBytes {
  bytes: Uint8Array;
  ref: string;
  bmtRoot: string;
  verified: true;
}

export interface VerifiedJson<T = unknown> extends VerifiedBytes {
  json: T;
  text: string;
}

export function verifyAndFetch(ref: string, opts: FetchOpts): Promise<VerifiedBytes>;
export function verifyAndFetchJson<T = unknown>(ref: string, opts: FetchOpts): Promise<VerifiedJson<T>>;

export interface PinOpts {
  gateway: string;
  stamp?: string;
}

export function pinImmutable(
  payload: string | Uint8Array | object,
  opts: PinOpts,
): Promise<{ ref: string; bmtRoot: string }>;

export const NULL_STAMP: string;

// ─── SOC ────────────────────────────────────────────────────────────────

export interface VerifiedSoc {
  identifier: string;
  owner: string;       // 0x-prefixed 20-byte hex
  address: string;     // 64-hex SOC address (no 0x prefix)
  payload: Uint8Array;
  span: Uint8Array;
  verified: true;
}

export interface VerifiedSocJson<T = unknown> extends VerifiedSoc {
  json: T;
  text: string;
}

export type SocExpected =
  | string
  | Uint8Array
  | { owner: string | Uint8Array; identifier: string | Uint8Array };

export function verifySocChunk(
  chunkBytes: Uint8Array,
  expected: SocExpected,
): VerifiedSoc;

export function makeSocAddressHex(
  identifier: string | Uint8Array,
  owner: string | Uint8Array,
): string;

export interface FetchSocOpts {
  gateway: string;
  owner: string | Uint8Array;
  identifier: string | Uint8Array;
  signal?: AbortSignal;
}

export function verifyAndFetchSoc(opts: FetchSocOpts): Promise<VerifiedSoc>;
export function verifyAndFetchSocJson<T = unknown>(opts: FetchSocOpts): Promise<VerifiedSocJson<T>>;

export interface PinSocOpts {
  gateway: string;
  signer: string | Uint8Array;
  identifier: string | Uint8Array;
  payload: Uint8Array | string | object;
  stamp?: string;
}

export function pinSoc(opts: PinSocOpts): Promise<{
  owner: string;
  identifier: string;
  address: string;
  payloadLength: number;
}>;
