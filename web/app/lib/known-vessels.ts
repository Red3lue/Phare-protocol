// Known-IMO → display name + flag + sanction labels. Used to enrich the
// on-chain VesselNamed feed for the demo. Vessel-side text records on
// Lighthouse only carry IMO + Swarm log refs (LIGHTHOUSE_SPEC §6); the
// dossier JSON behind vessel.swarm.log carries the canonical name +
// aliases + flag history. Fetching that JSON for every row is heavier
// than this static lookup, so we hardcode the demo IMOs and fall through
// to placeholders for unknowns.
//
// Sources:
//   PABLO 9133701      — DESIGN_DOCUMENT §14.4 (OFAC SDN, OpenSanctions maritime)
//   YOUNG YONG 9259325 — DESIGN_DOCUMENT §14.4 (UK OFSI Russia oil price-cap)
//   EAGLE S 9329760    — UK OFSI / EU 14, Estlink 2 cable (press)
//   YI PENG 3 9224984  — Hong Kong, BCS East-West cable (press)

export type KnownVessel = {
    name:       string;
    flag:       string;
    sanctions:  readonly string[];
};

export const KNOWN_VESSELS: Record<number, KnownVessel> = {
    9133701: { name: 'PABLO',      flag: 'GABON',         sanctions: ['OFAC SDN', 'EU 14'] },
    9259325: { name: 'YOUNG YONG', flag: 'CAMEROON',      sanctions: ['UK OFSI'] },
    9329760: { name: 'EAGLE S',    flag: 'COOK ISLANDS',  sanctions: ['UK OFSI', 'EU 14'] },
    9224984: { name: 'YI PENG 3',  flag: 'HONG KONG · CN', sanctions: ['UNDER INVESTIGATION'] },
};

export function vesselDisplay(imo: number): KnownVessel {
    return KNOWN_VESSELS[imo] ?? {
        name:      `IMO ${imo}`,
        flag:      '—',
        sanctions: [],
    };
}
