# orbitalimager — Orbitport plugin spec

> The gRPC contract and build roadmap for `orbitalimager`, Phare's Orbitport
> Application Plugin. Supersedes `DESIGN_DOCUMENT.md §4.6` and `§7.1`, which
> described the integration as JSON-RPC + Client-ID/Secret with four async
> callback methods. The actual integration is gRPC-via-`plugin.Call` (see
> Notion: *Orbitport External Plugin*).

---

## 1. Why this exists

A satellite link is high-latency and lossy. A transfer cannot afford to
restart from byte zero on every reconnection, and neither end of the link
can hold a full multi-MB scene in RAM. The plugin contract is shaped
around that reality: every transfer is resumable, every step is
disk-backed, and the memory ceiling on both ends is bounded by **one
tile**, not one image.

For the hackathon, the satellite + TEE backing the plugin is mocked per
`DESIGN_DOCUMENT.md §7.2` — fixture-keyed imagery, rule-based inference.
The contract is the real contribution.

---

## 2. Plugin identity

| Field | Value |
|---|---|
| Name | `orbitalimager` (single word, matches `aptosorbital`/`masterseed`) |
| proto package | `orbitalimager` |
| Gateway env var | `ORBITPORT_PLUGIN_ORBITALIMAGER` |
| Sidecar `ORBITPORT_PLUGIN` | `orbitalimager` |
| Dev compose port | `50005` |
| JSON-RPC method (via `plugin.Call`) | `orbitalimager.OrbitalImagerPlugin.<Method>` |
| Auth (dev) | Bearer token, any value (`authnoop` accepts everything) |
| Repo branch | `pedro/ethprague` with `--features reflection` |

---

## 3. RPC contract

The contract has two **versions** that ship in the same proto file. v1 is
the bring-up path; v2 is the resumable transfer path. Both coexist —
v1 is kept for tiny test images and end-to-end smoke flows.

### 3.1 Proto

```protobuf
syntax = "proto3";
package orbitalimager;
option go_package = "github.com/spacecomputer-io/orbitport/plugins/proto";

service OrbitalImagerPlugin {
  // ── v1: single-shot base64 ──────────────────────────────────────────
  rpc RequestImagery   (ImageryRequest)   returns (ImageryResult);

  // ── inference (mocked rule-based stub) ──────────────────────────────
  rpc RequestInference (InferenceRequest) returns (InferenceResult);

  // ── v2: tiled, resumable, disk-only ─────────────────────────────────
  rpc StartImagery     (ImageryRequest)     returns (ImageryManifest);
  rpc GetTile          (TileRequest)        returns (TileResult);
  rpc EndImagery       (EndImageryRequest)  returns (EndImageryResult);
}

// ── v1 messages ─────────────────────────────────────────────────────────
message ImageryRequest {
  double lat            = 1;
  double lon            = 2;
  int64  timestamp_unix = 3;
  uint64 imo            = 4;
}

message ImageryResult {
  string image_b64   = 1;   // entire image, base64
  string mime_type   = 2;   // "image/jpeg" | "image/png"
  int64  captured_at = 3;
  string sensor      = 4;
  bytes  image_hash  = 5;   // keccak256(decoded bytes) — bound to attest()
  bool   mocked      = 6;
}

// ── inference messages ──────────────────────────────────────────────────
message InferenceRequest {
  string image_swarm_ref = 1;
  uint64 imo             = 2;
  double last_lat        = 3;
  double last_lon        = 4;
}

message InferenceResult {
  string destination          = 1;
  double confidence           = 2;
  string reasoning_swarm_ref  = 3;
  bool   mocked               = 4;
}

// ── v2 messages ─────────────────────────────────────────────────────────
message ImageryManifest {
  string session_id      = 1;   // sha256(lat|lon|timestamp|imo) — deterministic
  uint32 tile_count      = 2;
  uint32 tile_rows       = 3;
  uint32 tile_cols       = 4;
  uint32 tile_pixel_size = 5;   // 256
  uint32 image_width     = 6;
  uint32 image_height    = 7;
  string mime_type       = 8;
  bytes  full_image_hash = 9;   // keccak256 of recomposed bytes
  int64  captured_at     = 10;
  string sensor          = 11;
  bool   mocked          = 12;
  uint64 expires_at      = 13;
}

message TileRequest  { string session_id = 1; uint32 tile_index = 2; }
message TileResult   { uint32 tile_index = 1; string tile_b64 = 2; bytes tile_hash = 3; }
message EndImageryRequest  { string session_id = 1; }
message EndImageryResult   { bool   acknowledged = 1; }
```

### 3.2 Why three unary RPCs and not server streaming

A `stream TileResult` is one TCP connection. Break it at tile 47/100 and
the client cannot resume from 48 without server cooperation that gRPC
streaming does not natively provide. Three idempotent unary calls give
free resumption: each `GetTile(i)` is independent, retry-safe, and the
server holds no per-client state beyond a cached session directory.

### 3.3 Idempotency / determinism

`session_id = sha256(lat | lon | timestamp_unix | imo)`. Same request
always lands on the same session. A client that crashed mid-fetch
re-calls `StartImagery`, gets the same `session_id`, and resumes by
disk-scanning which tile files it already has.

### 3.4 Cap on v1

gRPC default max message = 4 MB; base64 inflates ~33%. v1 fixtures are
capped at ~3 MB pre-encode. Anything above that → use v2.

---

## 4. On-disk layout

### 4.1 Server (plugin container)

```
/var/cache/orbitalimager/sessions/<session_id>/
├── manifest.json              # mirror of ImageryManifest
├── source.jpg                 # original fixture (copy or symlink)
└── tiles/
    ├── 0000.b64
    ├── 0001.b64
    └── …                      # tile_count files
```

`StartImagery` flow:
1. Compute `session_id`. If dir exists with valid `manifest.json`, return it.
2. Look up fixture by `(lat, lon)`.
3. Open with libvips (streaming decoder), tile row-by-row, write each
   tile's base64 to `tiles/NNNN.b64` as it goes. Never holds full image
   in RAM.
4. Compute `full_image_hash` incrementally during the tile pass.
5. Write `manifest.json`, return it.

`GetTile(i)` is a single disk read. No memory pressure. No state machine.

### 4.2 Client (orchestrator side)

```
ethPrague/orbital/state/sessions/<session_id>/
├── manifest.json              # cached on first StartImagery response
├── tiles/
│   ├── 0000.b64
│   └── …                      # only the ones we've fetched
└── recomposed.jpg             # written incrementally during recomposition
```

Resume algorithm on every run:
1. Compute `session_id` from request inputs.
2. If `manifest.json` doesn't exist → `StartImagery`, save manifest.
3. List `tiles/`. For each `i in [0, tile_count)` not present, call
   `GetTile(i)`, verify `tile_hash`, atomic write to `tiles/NNNN.b64.tmp`
   then rename. Crash here → next run picks up correctly.
4. When all tiles present, recompose: stream-decode each tile, write into
   final image one row-strip at a time using libvips. Never decode more
   than one row of tiles into memory.
5. Verify final `keccak256` against `full_image_hash`. Mismatch → delete
   and re-fetch.
6. Optional: `EndImagery(session_id)` so server can reclaim disk.

Memory ceiling on the client = one tile + one row-strip of the output
image. Both bounded.

---

## 5. Defaults

| Parameter | Value | Rationale |
|---|---|---|
| `tile_pixel_size` | 256 | One tile ≤ ~30 KB JPEG-encoded; ≤ ~192 KB raw RGB |
| Image library | libvips | Streaming I/O without RAM blowup; `bimg` Go bindings |
| Fixture mount | `./fixtures:/fixtures:ro` (bind mount) | Edit fixtures without rebuilding image |
| Session TTL | 24 h | Server may GC after `expires_at` |
| Bearer token (dev) | any non-empty value | Dev gateway runs `authnoop` |

---

## 6. Roadmap

| Phase | Goal | Exit criterion | Budget |
|---|---|---|---|
| **0** | Fork-side scaffolding — plugin compiles, gateway routes to it, handler returns hardcoded "hello" | One successful `plugin.Call` with stub response | ~1h |
| **1** | v1 base64 with real fixture — end-to-end fetch via gateway, `image_hash` verified client-side | Orchestrator script fetches demo image, writes JPEG, hash matches | ~2h |
| **2** | Server-side tiling — `StartImagery` writes manifest + tile files, `GetTile`/`EndImagery` work via `grpcurl` | Session directory populates on disk, `GetTile(i)` returns correct base64 | ~2h |
| **3** | Client-side resumable fetcher — manifest cache, disk scan, atomic per-tile writes, hash verification | Kill-9 mid-fetch + restart completes correctly with bounded memory | ~2h |
| **4** | Recomposition — stream-recompose tiles into a single image, final hash check, pin to Swarm | Reconstructed image byte-identical to original; final hash matches manifest | ~1.5h |
| **5** | Polish + integration — fixture set committed, server-side TTL/GC, orchestrator wired into `Settled` listener, `DESIGN_DOCUMENT` updated | Settled event triggers full imagery + inference + attest pipeline end-to-end | ~1.5h |

**Total ≈ 10h.** Phases 0–1 are the runnable v1. Phases 2–5 are the v2
resume-from-disk path.

### 6.1 Phase touchpoints

**In the fork** (`ethPrague/orbitport/`):

- `proto/plugins/orbitalimager.proto` — Phase 0 (v1 only), extended in Phase 2
- `plugins/pkg/plugin/orbitalimager/{plugin.go, config.go, fixtures.go, inference.go, plugin_test.go}` — Phase 0–2
- `plugins/cmd/plugin/main.go` — Phase 0: import + switch case
- `dev.docker-compose.yaml` — Phase 0: sidecar + gateway env + depends_on
- Plugin Dockerfile — Phase 2: `apt-get install libvips`

**In the parent repo** (`ethPrague/`):

- `orbital/src/{client.ts, orchestrator.ts, kms.ts, resume.ts, recompose.ts}` — Phase 1, 3, 4
- `orbital/state/sessions/` — Phase 3 (gitignored)
- `fixtures/orbital/` — Phase 1, 5

---

## 7. End-to-end flow (Phase 5, post-integration)

```
ReportRegistry.Settled
        │
        ▼
orbital/orchestrator.ts
        │
        ├── StartImagery(lat, lon, ts, imo)         ─────► gateway plugin.Call
        │       (returns ImageryManifest)
        │
        ├── for each missing tile:
        │       GetTile(session_id, i)              ─────► gateway plugin.Call
        │       atomic write to disk
        │
        ├── recompose tiles → recomposed.jpg
        │       stream via libvips, verify keccak256
        │
        ├── pin recomposed.jpg to Swarm → swarm_ref
        │
        ├── RequestInference(swarm_ref, imo, …)     ─────► gateway plugin.Call
        │       (returns InferenceResult, mocked: true)
        │
        ├── pin reasoning JSON to Swarm
        │
        ├── KMS sign EIP-191 attestation digest
        │       (orbital_attestor address baked into ReportRegistry)
        │
        └── ReportRegistry.attest(reportId, image_hash, sig)
                ↓
         OrbitallyCorroborated event
                ↓
         Lighthouse.recordOrbital() writes vessel.orbital.* records
```

---

## 8. Out of scope

- Live satellite tasking — fixtures only. Mock backing per
  `DESIGN_DOCUMENT.md §7.2`.
- Real spaceTEE inference — rule-based stub, output JSON always carries
  `"mocked": true`.
- Multi-client coordination on the same session — the protocol supports
  it (deterministic session_id, idempotent tile reads), but no testing
  beyond single-client during the hackathon.
- Compression beyond JPEG — base64 of pre-compressed bytes only.
- Authenticated tile delivery — tile bytes are not signed individually;
  integrity is via `tile_hash` in the manifest's transitive trust chain.
  KMS signature only covers the final attestation digest.

---

## 9. Open questions

- Is libvips installation in the plugin container worth ~50 MB image
  bloat? Pure-Go alternative: `golang.org/x/image` + manual tiling, no
  C deps but slower and lacks JP2/TIFF.
- For very large scenes (Sentinel-2 ~100 MB), `tile_pixel_size = 512`
  reduces tile count 4× at the cost of bigger per-tile RAM. Decision
  deferred until we have a real fixture set.
- Should `EndImagery` be mandatory for the server to free disk, or
  TTL-only? Currently TTL + optional explicit call.
