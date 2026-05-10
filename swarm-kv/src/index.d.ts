// Type declarations for swarm-kv.

export class KvError extends Error {
  constructor(message: string, extra?: Record<string, unknown>);
}

export interface KVReaderOpts {
  gateway: string;
  owner: string | Uint8Array;
  namespace: string;
}

export interface KVOpts {
  gateway: string;
  signer: string | Uint8Array;
  namespace: string;
}

export interface ReadOpts {
  signal?: AbortSignal;
}

export interface WriteOpts extends ReadOpts {
  stamp?: string;
}

export type KvValue = string | number | boolean | null | KvObject | KvValue[] | Uint8Array;
export interface KvObject { [k: string]: KvValue }

export class KVReader {
  readonly gateway: string;
  readonly owner: string | Uint8Array;
  readonly namespace: string;
  constructor(opts: KVReaderOpts);
  get<T = KvValue>(key: string, opts?: ReadOpts): Promise<T | undefined>;
  has(key: string, opts?: ReadOpts): Promise<boolean>;
  list(opts?: ReadOpts): Promise<string[]>;
  entries(opts?: ReadOpts): Promise<Array<[string, KvValue]>>;
}

export class KV extends KVReader {
  readonly signer: string | Uint8Array;
  constructor(opts: KVOpts);
  static reader(opts: KVReaderOpts): KVReader;
  put(
    key: string,
    value: KvValue,
    opts?: WriteOpts,
  ): Promise<{ key: string; owner: string; identifier: string; payloadLength: number }>;
  del(key: string, opts?: WriteOpts): Promise<{ key: string; tombstoned: true }>;
}

export { GatewayFetchError, SocVerifyError } from 'swarm';
