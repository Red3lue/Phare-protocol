"use client";

import {useState, useRef} from "react";
import {
    createWalletClient,
    createPublicClient,
    custom,
    http,
    parseAbi,
    keccak256,
    formatEther,
    type Hex
} from "viem";
import {sepolia} from "viem/chains";
import {Bee, NULL_STAMP} from "@ethersphere/bee-js";

// ── Addresses sourced from web/.env (mirrors root /.env) ───────────────────
const WETH_ADDRESS     = (process.env.NEXT_PUBLIC_BOND_CURRENCY    ?? "") as `0x${string}`;
const OOV3_ADDRESS     = (process.env.NEXT_PUBLIC_UMA_OOV3         ?? "") as `0x${string}`;
const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REPORT_REGISTRY  ?? "") as `0x${string}`;
const SWARM_BEE_URL    = process.env.NEXT_PUBLIC_SWARM_BEE_URL ?? "https://bzz.limo";

// Demo coordinates — Laconian Gulf, off Cyprus per DESIGN_DOCUMENT §13.
// Real GPS capture is out of scope for the hackathon demo path; the metadata
// JSON ships these fixed coords so the on-chain record is self-consistent
// with the OSINT photos in fixtures/. TODO: swap for navigator.geolocation
// once camera capture lands.
const DEMO_GPS: [number, number] = [34.7, 33.4];

const REGISTRY_ABI = parseAbi([
    "function submit(uint256 imo, bool aisDark, bytes32 photoHash, string metadataSwarm) returns (bytes32)",
    "function protocolBond() view returns (uint96)"
]);

const ERC20_ABI = parseAbi([
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
]);

const OOV3_ABI = parseAbi([
    "function getMinimumBond(address currency) view returns (uint256)"
]);

declare global {
    interface Window {
        ethereum?: {
            request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
        };
    }
}

export default function Page() {
    const [imo, setImo]               = useState("9133701");
    const [aisDark, setAisDark]       = useState(true);
    const [photoHash, setPhotoHash]   = useState<Hex | "">("");
    const [photoName, setPhotoName]   = useState<string>("");
    const [photoFile, setPhotoFile]   = useState<File | null>(null);
    const [photoSwarm, setPhotoSwarm] = useState<string>("");
    const [metadataSwarm, setMetadataSwarm] = useState<string>("");

    const fileInputRef = useRef<HTMLInputElement>(null);

    const [status, setStatus]     = useState<string>("idle");
    const [txHash, setTxHash]     = useState<string>("");
    const [reportId, setReportId] = useState<string>("");
    const [error, setError]       = useState<string>("");

    async function ingestFile(file: File) {
        setError("");
        try {
            const buf = new Uint8Array(await file.arrayBuffer());
            const hash = keccak256(buf);
            setPhotoHash(hash);
            setPhotoName(`${file.name} (${file.size} bytes)`);
            setPhotoFile(file);
            // Reset previous Swarm refs — fresh file means fresh upload.
            setPhotoSwarm("");
            setMetadataSwarm("");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setTxHash("");
        setReportId("");

        if (!REGISTRY_ADDRESS) {
            setError("NEXT_PUBLIC_REPORT_REGISTRY env var not set in web/.env");
            return;
        }
        if (!WETH_ADDRESS || !OOV3_ADDRESS) {
            setError("NEXT_PUBLIC_BOND_CURRENCY or NEXT_PUBLIC_UMA_OOV3 missing in web/.env");
            return;
        }
        if (!photoHash || !photoFile) {
            setError("drop a photo first — photoHash is empty");
            return;
        }
        if (!window.ethereum) {
            setError("No injected wallet found (install MetaMask)");
            return;
        }

        try {
            // ── Swarm uploads (lazy, on-submit per Q6) ─────────────────────
            // Photo → /bzz immutable. Metadata JSON (with photo ref + GPS +
            // timestamp + nonce) → /bzz immutable. Both refs land on-chain
            // through the assertion's claim string.
            setStatus("uploading photo to Swarm…");
            const bee = new Bee(SWARM_BEE_URL);
            const photoBytes = new Uint8Array(await photoFile.arrayBuffer());
            const photoUpload = await bee.uploadFile(
                NULL_STAMP,
                photoBytes,
                photoFile.name,
                {contentType: photoFile.type || "application/octet-stream"}
            );
            const photoRef = photoUpload.reference.toString();
            const photoBzz = `bzz://${photoRef}`;
            setPhotoSwarm(photoBzz);

            setStatus("uploading metadata JSON to Swarm…");
            const nonceBytes = new Uint8Array(32);
            crypto.getRandomValues(nonceBytes);
            const nonceHex = "0x" + Array.from(nonceBytes)
                .map((b) => b.toString(16).padStart(2, "0")).join("");
            const metadata = {
                photo:        photoBzz,
                photoHash:    photoHash,
                gps:          DEMO_GPS,
                timestamp:    Date.now(),
                imo:          Number(imo),
                ais_dark:     aisDark,
                nonce:        nonceHex
                // TODO: swap nonce source for SpaceComputer cTRNG per DESIGN §7.1.
            };
            const metaUpload = await bee.uploadData(
                NULL_STAMP,
                new TextEncoder().encode(JSON.stringify(metadata))
            );
            const metaBzz = `bzz://${metaUpload.reference.toString()}`;
            setMetadataSwarm(metaBzz);

            setStatus("connecting wallet…");
            const walletClient = createWalletClient({
                chain: sepolia,
                transport: custom(window.ethereum)
            });
            const publicClient = createPublicClient({
                chain: sepolia,
                transport: http()
            });

            const [account] = await walletClient.requestAddresses();

            // Make sure wallet is on Sepolia.
            const chainId = (await window.ethereum.request({method: "eth_chainId"})) as string;
            if (parseInt(chainId, 16) !== sepolia.id) {
                setStatus("switching to Sepolia…");
                await window.ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{chainId: `0x${sepolia.id.toString(16)}`}]
                });
            }

            // Pull bond sizing from chain.
            setStatus("fetching bond amounts…");
            const [protocolBond, umaMinBond, balance] = await Promise.all([
                publicClient.readContract({
                    address: REGISTRY_ADDRESS,
                    abi: REGISTRY_ABI,
                    functionName: "protocolBond"
                }),
                publicClient.readContract({
                    address: OOV3_ADDRESS,
                    abi: OOV3_ABI,
                    functionName: "getMinimumBond",
                    args: [WETH_ADDRESS]
                }),
                publicClient.readContract({
                    address: WETH_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: "balanceOf",
                    args: [account]
                })
            ]);
            const total = (protocolBond as bigint) + (umaMinBond as bigint);

            // Pre-flight: ensure reporter actually has the WETH.
            if ((balance as bigint) < total) {
                throw new Error(
                    `insufficient WETH: have ${formatEther(balance as bigint)}, need ${formatEther(total)}. ` +
                    `Click "Wrap 0.01 ETH" first.`
                );
            }

            // Approve WETH if needed.
            const allowance = (await publicClient.readContract({
                address: WETH_ADDRESS,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [account, REGISTRY_ADDRESS]
            })) as bigint;

            if (allowance < total) {
                setStatus(`approving ${total} WETH…`);
                const approveHash = await walletClient.writeContract({
                    account,
                    address: WETH_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: "approve",
                    args: [REGISTRY_ADDRESS, total]
                });
                await publicClient.waitForTransactionReceipt({hash: approveHash});
            }

            // Submit.
            setStatus("submitting report…");
            const hash = await walletClient.writeContract({
                account,
                address: REGISTRY_ADDRESS,
                abi: REGISTRY_ABI,
                functionName: "submit",
                args: [BigInt(imo), aisDark, photoHash, metaBzz]
            });
            setTxHash(hash);

            const receipt = await publicClient.waitForTransactionReceipt({hash});
            // First indexed topic of Submitted == reportId.
            const submittedLog = receipt.logs.find(
                (l) => l.address.toLowerCase() === REGISTRY_ADDRESS.toLowerCase()
            );
            if (submittedLog && submittedLog.topics[1]) {
                setReportId(submittedLog.topics[1]);
            }
            setStatus("settled (tx mined)");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setStatus("error");
        }
    }

    return (
        <main>
            <h1>Phare reporter</h1>
            <p>Registry: {REGISTRY_ADDRESS || "(not configured)"}</p>
            <form onSubmit={onSubmit}>
                <div>
                    <label>
                        IMO
                        <input
                            type="number"
                            value={imo}
                            onChange={(e) => setImo(e.target.value)}
                            required
                        />
                    </label>
                </div>
                <div>
                    <label>
                        AIS-dark
                        <input
                            type="checkbox"
                            checked={aisDark}
                            onChange={(e) => setAisDark(e.target.checked)}
                        />
                    </label>
                </div>
                <div>
                    <p>Photo</p>
                    <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={async (e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files[0];
                            if (file) await ingestFile(file);
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                            border: "1px dashed #888",
                            padding: 12,
                            cursor: "pointer"
                        }}
                    >
                        {photoName
                            ? `loaded: ${photoName}`
                            : "drop a photo here, or click to pick"}
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        style={{display: "none"}}
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) await ingestFile(file);
                        }}
                    />
                    <p>photoHash: {photoHash || "(none)"}</p>
                </div>
                <button type="submit">Submit report</button>
            </form>
            <p>Status: {status}</p>
            {photoSwarm    && <p>Photo:    {photoSwarm}</p>}
            {metadataSwarm && <p>Metadata: {metadataSwarm}</p>}
            {txHash        && <p>Tx hash:  {txHash}</p>}
            {reportId      && <p>Report id: {reportId}</p>}
            {error         && <pre>Error: {error}</pre>}
        </main>
    );
}
