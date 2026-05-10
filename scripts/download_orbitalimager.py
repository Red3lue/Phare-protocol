#!/usr/bin/env python3
"""Download all packets for an image and recompose them into a single PNG.

Walks the same JSON-RPC + plugin.Call path as scripts/check_orbitalimager.py:

    1. ListImages       — discover image_ids (or accept one via --image-id)
    2. GetImageMetadata — learn grid geometry (rows, cols, tile size, dims)
    3. GetImagePacket   — pull every packet, base64-decode, optionally save
    4. Recompose        — paste each packet into a Pillow canvas at
                          (col * tile, row * tile), save the result

Each packet's keccak256 is checked against the metadata before paste, so a
corrupt download surfaces immediately rather than appearing as a smear in
the output. The recomposed PNG's keccak will NOT match metadata's
full_image_hash because that hash is over the original encoded bytes; we
re-encode here. Pixel content is what's verified.

Requires: Pillow (`pip install Pillow`).

Examples:
    python3 scripts/download_orbitalimager.py
    python3 scripts/download_orbitalimager.py --image-id tanker-0 \\
        --out /tmp/tanker-0-recomposed.png \\
        --packets-dir /tmp/tanker-0-packets
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import itertools
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError:
    print("Pillow is required: pip install Pillow", file=sys.stderr)
    sys.exit(2)

PLUGIN = "orbitalimager"
SVC    = "orbitalimager.OrbitalImagerPlugin"


# ── transport (mirror of check_orbitalimager.py) ───────────────────────────

class GatewayError(RuntimeError):
    pass


_id_counter = itertools.count(1)


def plugin_call(gateway: str, bearer: str, method: str, request: dict[str, Any]) -> Any:
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": next(_id_counter),
        "method": "plugin.Call",
        "params": {"plugin": PLUGIN, "method": method, "request": request},
    }).encode()

    req = urllib.request.Request(
        f"{gateway.rstrip('/')}/api/v1/rpc",
        data=body,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {bearer}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise GatewayError(f"HTTP {e.code} {e.reason}: {e.read().decode(errors='replace')}") from None
    except urllib.error.URLError as e:
        raise GatewayError(f"cannot reach {gateway}: {e.reason}") from None

    if "error" in payload and payload["error"] is not None:
        raise GatewayError(f"JSON-RPC error: {json.dumps(payload['error'])}")
    return payload.get("result", {})


def b64_to_bytes(field: str | None) -> bytes:
    if not field:
        return b""
    return base64.b64decode(field)


# ── keccak256 ─────────────────────────────────────────────────────────────
#
# Ethereum-flavoured keccak256, NOT FIPS SHA3-256 (different padding byte:
# 0x01 vs 0x06). hashlib's 'sha3_256' is the wrong one. We try, in order:
#   1. hashlib 'keccak_256' — present when Python is linked against
#      OpenSSL 3.x with the legacy provider enabled.
#   2. pycryptodome's Crypto.Hash.keccak — common third-party install.
#   3. A minimal pure-Python keccak-f[1600] permutation (below). ~120 LoC,
#      slow on huge inputs but adequate for ≤ a few MB packets.

def _keccak256_native(data: bytes) -> bytes | None:
    if "keccak_256" in hashlib.algorithms_available:
        h = hashlib.new("keccak_256"); h.update(data); return h.digest()
    try:
        from Crypto.Hash import keccak as _k  # type: ignore
        h = _k.new(digest_bits=256); h.update(data); return h.digest()
    except ImportError:
        return None


# --- pure-Python keccak-f[1600], rate=1088 bits (256-bit output) -----------
# Adapted from the public-domain reference. Operates on a 5×5 lane state of
# 64-bit words; one permutation per absorbed block.

_RC = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
    0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
    0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)
# Rotation offsets, indexed as _R[y][x] — the table is laid out so each
# row corresponds to a y-plane (x sweeps left-to-right within the row).
_R = (
    ( 0,  1, 62, 28, 27),  # y = 0
    (36, 44,  6, 55, 20),  # y = 1
    ( 3, 10, 43, 25, 39),  # y = 2
    (41, 45, 15, 21,  8),  # y = 3
    (18,  2, 61, 56, 14),  # y = 4
)


def _rotl64(x: int, n: int) -> int:
    return ((x << n) | (x >> (64 - n))) & 0xFFFFFFFFFFFFFFFF


def _keccak_f1600(state: list[list[int]]) -> None:
    for rc in _RC:
        # θ
        C = [state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4] for x in range(5)]
        D = [C[(x - 1) % 5] ^ _rotl64(C[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                state[x][y] ^= D[x]
        # ρ + π
        B = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                B[y][(2 * x + 3 * y) % 5] = _rotl64(state[x][y], _R[y][x])
        # χ
        for x in range(5):
            for y in range(5):
                state[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y]) & B[(x + 2) % 5][y]) & 0xFFFFFFFFFFFFFFFF
        # ι
        state[0][0] ^= rc


def _keccak256_pure(data: bytes) -> bytes:
    rate_bytes = 1088 // 8  # 136
    # Pad: append 0x01, zero-fill to one short of a full block, OR final byte with 0x80.
    pad_len = rate_bytes - (len(data) % rate_bytes)
    if pad_len == 1:
        padded = data + bytes([0x81])
    else:
        padded = data + bytes([0x01]) + bytes(pad_len - 2) + bytes([0x80])

    state = [[0] * 5 for _ in range(5)]
    for off in range(0, len(padded), rate_bytes):
        block = padded[off:off + rate_bytes]
        for i in range(rate_bytes // 8):
            lane = int.from_bytes(block[i * 8:(i + 1) * 8], "little")
            state[i % 5][i // 5] ^= lane
        _keccak_f1600(state)

    # Squeeze 256 bits = 4 lanes from the rate area in row-major order.
    out = bytearray()
    for i in range(4):
        out += state[i % 5][i // 5].to_bytes(8, "little")
    return bytes(out)


def keccak256(data: bytes) -> bytes:
    """Always returns a 32-byte digest. Uses the fastest available backend."""
    native = _keccak256_native(data)
    return native if native is not None else _keccak256_pure(data)


# ── pretty output (same style as the checker) ─────────────────────────────

def step(label: str) -> None:
    print(f"\n── {label} " + "─" * max(0, 70 - len(label)))


def ok(msg: str) -> None:
    print(f"  [OK]  {msg}")


def warn(msg: str) -> None:
    print(f"  [WARN] {msg}")


def fail(msg: str) -> None:
    print(f"  [FAIL] {msg}", file=sys.stderr)


def info(msg: str) -> None:
    print(f"        {msg}")


# ── workflow ───────────────────────────────────────────────────────────────

def pick_image_id(gateway: str, bearer: str, requested: str | None) -> str:
    step("ListImages")
    res = plugin_call(gateway, bearer, f"{SVC}.ListImages", {})
    ids = res.get("imageIds") or []
    if not ids:
        raise GatewayError("no images on disk — fragment one first")
    ok(f"{len(ids)} image(s) available: {ids}")

    if requested is None:
        return ids[0]
    if requested not in ids:
        raise GatewayError(f"image_id {requested!r} not in {ids}")
    return requested


def fetch_metadata(gateway: str, bearer: str, image_id: str) -> dict[str, Any]:
    step(f"GetImageMetadata({image_id!r})")
    meta = plugin_call(gateway, bearer, f"{SVC}.GetImageMetadata", {"imageId": image_id})
    ok(f"{meta['imageWidth']}x{meta['imageHeight']}, "
       f"{meta['tileRows']}x{meta['tileCols']} grid, "
       f"{meta['packetCount']} packets, tile={meta['tilePixelSize']}")
    info(f"ship={meta.get('shipName')!r}  imo={meta.get('imo', 0)}  sensor={meta.get('sensor')!r}")
    return meta


def fetch_packets(gateway: str, bearer: str, image_id: str,
                  meta: dict[str, Any],
                  packets_dir: Path | None,
                  verify_hashes: bool) -> list[bytes]:
    step(f"GetImagePacket × {meta['packetCount']}")
    pkts_meta = meta.get("packets") or []
    out: list[bytes] = []

    for i in range(int(meta["packetCount"])):
        res = plugin_call(gateway, bearer, f"{SVC}.GetImagePacket",
                          {"imageId": image_id, "packetIndex": i})
        raw = b64_to_bytes(res.get("packetB64"))
        if not raw:
            raise GatewayError(f"packet {i}: empty packetB64")

        if verify_hashes:
            actual   = keccak256(raw)
            srv_hash = b64_to_bytes(res.get("packetHash"))
            if srv_hash != actual:
                raise GatewayError(
                    f"packet {i}: keccak mismatch  server={srv_hash.hex()}  actual={actual.hex()}")
            meta_hash = b64_to_bytes(pkts_meta[i].get("packetHash"))
            if meta_hash != actual:
                raise GatewayError(
                    f"packet {i}: metadata vs packet hash mismatch  "
                    f"metadata={meta_hash.hex()}  actual={actual.hex()}")

        if packets_dir is not None:
            packets_dir.mkdir(parents=True, exist_ok=True)
            (packets_dir / f"{i:04d}.png").write_bytes(raw)

        out.append(raw)
        sys.stdout.write(f"\r        downloaded {i+1}/{meta['packetCount']}  ({len(raw)} B)   ")
        sys.stdout.flush()

    sys.stdout.write("\n")
    label = "downloaded + keccak-verified" if verify_hashes else "downloaded"
    ok(f"{len(out)} packets {label}")
    if packets_dir is not None:
        info(f"per-packet PNGs written to {packets_dir}")
    return out


def recompose(meta: dict[str, Any], packets: list[bytes], out_path: Path) -> None:
    step(f"recompose → {out_path}")
    canvas = Image.new("RGBA", (int(meta["imageWidth"]), int(meta["imageHeight"])))
    pkts_meta = meta.get("packets") or []
    tile = int(meta["tilePixelSize"])

    for i, info_dict in enumerate(pkts_meta):
        # proto3 JSON elides zero-valued primitive fields, so row/col/index
        # default to 0 when absent. Read defensively.
        row = int(info_dict.get("row", 0))
        col = int(info_dict.get("col", 0))
        w   = int(info_dict.get("width", 0))
        h   = int(info_dict.get("height", 0))

        tile_img = Image.open(io.BytesIO(packets[i]))
        if tile_img.size != (w, h):
            raise GatewayError(
                f"packet {i}: PNG is {tile_img.size}, metadata says {(w, h)}")
        canvas.paste(tile_img, (col * tile, row * tile))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, format="PNG")
    ok(f"recomposed image written ({out_path.stat().st_size} B, {canvas.size[0]}x{canvas.size[1]})")
    info("note: recomposed file's keccak will differ from full_image_hash — "
         "PNG re-encode is not byte-stable. Pixel content is what's verified.")


# ── main ───────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--gateway", default=os.environ.get("ORBITPORT_GATEWAY_URL", "http://localhost:8080"))
    ap.add_argument("--bearer",  default=os.environ.get("ORBITPORT_BEARER", "dev"))
    ap.add_argument("--image-id", default=None,
                    help="image to download (default: first from ListImages)")
    ap.add_argument("--out", type=Path, default=None,
                    help="output recomposed PNG (default: ./<image_id>.png)")
    ap.add_argument("--packets-dir", type=Path, default=None,
                    help="if set, also save each individual packet PNG into this dir")
    ap.add_argument("--no-verify", action="store_true",
                    help="skip keccak256 verification of each packet")
    args = ap.parse_args()

    print(f"gateway: {args.gateway}")
    print(f"bearer:  {args.bearer!r}")

    try:
        image_id = pick_image_id(args.gateway, args.bearer, args.image_id)
        meta     = fetch_metadata(args.gateway, args.bearer, image_id)
        packets  = fetch_packets(args.gateway, args.bearer, image_id, meta,
                                 packets_dir=args.packets_dir,
                                 verify_hashes=not args.no_verify)

        out_path = args.out or Path(f"./{image_id}.png")
        recompose(meta, packets, out_path)

        print(f"\nDONE — {out_path}")
        return 0

    except GatewayError as e:
        print(f"\nFAILED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
