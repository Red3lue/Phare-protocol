#!/usr/bin/env python3
"""End-to-end smoke check for the orbitalimager v0.1.0 RPC surface.

Hits the Orbitport gateway's JSON-RPC `plugin.Call` endpoint exactly the
way real clients (orbitalImager-sdk) do, exercising:

    1. ListImages       — gateway → plugin → on-disk fragmentDir scan
    2. GetImageMetadata — typed metadata for one image_id
    3. GetImagePacket   — base64-encoded packet, decoded + validated as PNG

Stdlib only. Run against a live `dev.docker-compose.yaml` stack:

    python3 scripts/check_orbitalimager.py
    python3 scripts/check_orbitalimager.py --image-id tanker-real --all-packets
    python3 scripts/check_orbitalimager.py --gateway http://localhost:8080 \\
        --bearer dev --save-packets /tmp/recv

Exit code: 0 on full pass, 1 on any failure.
"""

from __future__ import annotations

import argparse
import base64
import itertools
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

PLUGIN = "orbitalimager"
SVC    = "orbitalimager.OrbitalImagerPlugin"

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


# ── transport ──────────────────────────────────────────────────────────────

class GatewayError(RuntimeError):
    pass


_id_counter = itertools.count(1)


def plugin_call(gateway: str, bearer: str, method: str, request: dict[str, Any]) -> Any:
    """Invoke a plugin method through the gateway's JSON-RPC endpoint."""
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
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise GatewayError(f"HTTP {e.code} {e.reason}: {e.read().decode(errors='replace')}") from None
    except urllib.error.URLError as e:
        raise GatewayError(f"cannot reach {gateway}: {e.reason}") from None

    if "error" in payload and payload["error"] is not None:
        raise GatewayError(f"JSON-RPC error: {json.dumps(payload['error'])}")
    return payload.get("result", {})


# ── pretty output ──────────────────────────────────────────────────────────

def step(label: str) -> None:
    print(f"\n── {label} " + "─" * max(0, 70 - len(label)))


def ok(msg: str) -> None:
    print(f"  [OK]  {msg}")


def fail(msg: str) -> None:
    print(f"  [FAIL] {msg}", file=sys.stderr)


def info(msg: str) -> None:
    print(f"        {msg}")


# ── checks ─────────────────────────────────────────────────────────────────

def b64_to_bytes(field: str | None) -> bytes:
    """Proto3 JSON encodes `bytes` as base64 strings; empty/None → b''."""
    if not field:
        return b""
    return base64.b64decode(field)


def check_list_images(gateway: str, bearer: str) -> list[str]:
    step("ListImages")
    res = plugin_call(gateway, bearer, f"{SVC}.ListImages", {})
    ids = res.get("imageIds") or []
    if not isinstance(ids, list):
        raise GatewayError(f"unexpected response shape: {res!r}")
    if not ids:
        info("(no images on disk yet — fragment one with cmd/orbitalimager-fragment first)")
    else:
        ok(f"{len(ids)} image(s) available")
        for i, id_ in enumerate(ids):
            info(f"  [{i}] {id_}")
    return ids


def check_get_metadata(gateway: str, bearer: str, image_id: str) -> dict[str, Any]:
    step(f"GetImageMetadata({image_id!r})")
    res = plugin_call(gateway, bearer, f"{SVC}.GetImageMetadata", {"imageId": image_id})

    # Required fields per the proto (proto3 JSON: snake_case → camelCase).
    required = ["version", "imageId", "shipName", "imageWidth", "imageHeight",
                "tilePixelSize", "packetCount", "packets"]
    missing = [k for k in required if k not in res]
    if missing:
        raise GatewayError(f"metadata missing fields: {missing}")

    full_hash = b64_to_bytes(res.get("fullImageHash"))
    if len(full_hash) != 32:
        raise GatewayError(f"fullImageHash len = {len(full_hash)}, want 32")

    ok("typed metadata returned")
    info(f"  ship       {res['shipName']!r}  imo={res.get('imo', 0)}")
    info(f"  source     {res.get('sourceFilename')!r}  {res.get('sourceMimeType')}")
    info(f"  dims       {res['imageWidth']}x{res['imageHeight']}")
    info(f"  grid       {res.get('tileRows', '?')} rows x {res.get('tileCols', '?')} cols  "
         f"=  {res['packetCount']} packets  (tile={res['tilePixelSize']})")
    info(f"  full hash  {full_hash.hex()}")
    info(f"  sensor     {res.get('sensor')!r}  ts={res.get('createdAtUnix')}")

    pkt_count = int(res["packetCount"])
    pkts = res.get("packets") or []
    if len(pkts) != pkt_count:
        raise GatewayError(f"packets array len = {len(pkts)}, packet_count = {pkt_count}")
    for p in pkts:
        h = b64_to_bytes(p.get("packetHash"))
        if len(h) != 32:
            raise GatewayError(f"packet[{p.get('index')}] hash len = {len(h)}, want 32")
    ok(f"all {pkt_count} packet entries have 32-byte hashes")

    return res


def check_get_packet(gateway: str, bearer: str, image_id: str, idx: int,
                     expected: dict[str, Any] | None,
                     save_dir: Path | None) -> int:
    step(f"GetImagePacket({image_id!r}, idx={idx})")
    res = plugin_call(gateway, bearer, f"{SVC}.GetImagePacket",
                      {"imageId": image_id, "packetIndex": idx})

    b64 = res.get("packetB64", "")
    if not b64:
        raise GatewayError("packetB64 is empty")
    raw = base64.b64decode(b64)

    if not raw.startswith(PNG_MAGIC):
        raise GatewayError(f"decoded packet is not a PNG (magic={raw[:8]!r})")
    ok(f"{len(raw)} B PNG decoded ({len(b64)} B base64)")

    info(f"  width      {res.get('width')}")
    info(f"  height     {res.get('height')}")
    info(f"  mime       {res.get('mimeType')!r}")
    info(f"  pkt hash   {b64_to_bytes(res.get('packetHash')).hex()}")

    if expected is not None:
        want_w = expected.get("width")
        want_h = expected.get("height")
        if res.get("width") != want_w or res.get("height") != want_h:
            raise GatewayError(
                f"dims mismatch: server={res.get('width')}x{res.get('height')}, "
                f"metadata={want_w}x{want_h}")
        srv_hash = b64_to_bytes(res.get("packetHash")).hex()
        meta_hash = b64_to_bytes(expected.get("packetHash")).hex()
        if srv_hash != meta_hash:
            raise GatewayError(
                f"hash mismatch: server={srv_hash}, metadata={meta_hash}")
        ok("dims + hash match metadata")

    if save_dir is not None:
        save_dir.mkdir(parents=True, exist_ok=True)
        out = save_dir / f"{image_id}_{idx:04d}.png"
        out.write_bytes(raw)
        info(f"  saved to   {out}")

    return len(raw)


# ── error-path checks (cheap, prove status codes round-trip) ───────────────

def check_error_paths(gateway: str, bearer: str) -> None:
    step("error-path sanity")

    # The gateway wraps gRPC status codes in JSON-RPC and serialises the
    # code as its standard human phrase, not the camelCase enum name.
    # Match either form so the check survives gateway formatting changes.
    PHRASES = {
        "InvalidArgument": ("invalidargument", "client specified an invalid argument"),
        "NotFound":        ("notfound",        "some requested entity was not found",
                            "the requested resource was not found",
                            "the requested entity was not found"),
        "OutOfRange":      ("outofrange",      "operation was attempted past the valid range"),
    }

    cases = [
        ("missing image_id",  {"imageId": ""},                   "InvalidArgument"),
        ("path traversal",    {"imageId": "../etc"},             "InvalidArgument"),
        ("unknown image_id",  {"imageId": "zzz-does-not-exist"}, "NotFound"),
    ]
    for label, req, want in cases:
        try:
            plugin_call(gateway, bearer, f"{SVC}.GetImageMetadata", req)
        except GatewayError as e:
            err_lc = str(e).lower()
            if any(p in err_lc for p in PHRASES[want]):
                ok(f"{label}: gateway returned {want}")
            else:
                fail(f"{label}: expected {want}, got: {e}")
                raise
        else:
            fail(f"{label}: expected {want}, got success")
            raise GatewayError(f"{label}: no error returned")


# ── main ───────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--gateway", default=os.environ.get("ORBITPORT_GATEWAY_URL", "http://localhost:8080"))
    ap.add_argument("--bearer",  default=os.environ.get("ORBITPORT_BEARER", "dev"))
    ap.add_argument("--image-id", help="target a specific image_id (default: first from ListImages)")
    ap.add_argument("--all-packets", action="store_true",
                    help="fetch every packet, not just index 0")
    ap.add_argument("--save-packets", type=Path, default=None,
                    help="directory to write fetched packet files into")
    ap.add_argument("--skip-error-checks", action="store_true",
                    help="skip the error-path sanity probes")
    args = ap.parse_args()

    print(f"gateway: {args.gateway}")
    print(f"bearer:  {args.bearer!r}")

    try:
        ids = check_list_images(args.gateway, args.bearer)
        if not ids:
            return 1

        target = args.image_id or ids[0]
        if target not in ids:
            fail(f"image_id {target!r} not in ListImages result {ids}")
            return 1

        meta = check_get_metadata(args.gateway, args.bearer, target)
        pkts = meta.get("packets") or []

        indexes = list(range(len(pkts))) if args.all_packets else [0]
        total = 0
        for idx in indexes:
            total += check_get_packet(
                args.gateway, args.bearer, target, idx,
                expected=pkts[idx] if idx < len(pkts) else None,
                save_dir=args.save_packets,
            )

        if not args.skip_error_checks:
            check_error_paths(args.gateway, args.bearer)

        print(f"\nALL CHECKS PASSED — fetched {len(indexes)} packet(s), {total} B total decoded")
        return 0

    except GatewayError as e:
        print(f"\nFAILED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
