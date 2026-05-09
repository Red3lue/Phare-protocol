// Phare demo fleet.
//
// Names + IMOs for PABLO and YOUNG YONG are pinned in DESIGN_DOCUMENT §14.4 as
// the canonical OSINT-verified hackathon fixtures (OpenSanctions `maritime`).
// The remaining four (TURBA, NS BURGAS, KAVKAZ, NIGHT IBIS) are illustrative —
// inherited from web/hackathon-UI-helpers/app/shadow/page.tsx, which itself
// flags them as "illustrative, not real OFAC entries". Replace with verified
// OpenSanctions hits before any non-demo use.
//
// All lat/lon, AIS gap, cargo, owner cycle and flag-swap counts are demo
// fabrications, sized to look believable for a 3-minute demo.

export type Vessel = {
    imo:           number;
    name:          string;
    flag:          string;
    age:           number;
    riskScore:     number;
    aisGap:        string;
    lastSeen:      string;
    lastLL:        readonly [number, number];
    suspectedLL:   readonly [number, number];
    suspected:     string;
    cargo:         string;
    lastAisAt:     string;
    flagsSwapped:  number;
    owners:        number;
    sanctions:     readonly string[];
    sightings:     number;
    disputed:      number;
    color:         string;
    verified:      'pinned' | 'illustrative';
};

export const FLEET: readonly Vessel[] = [
    {
        imo: 9133701, name: 'PABLO', flag: 'GABON', age: 28, riskScore: 94,
        aisGap: '14d 06h', lastSeen: 'Strait of Hormuz', lastLL: [26.55, 56.25],
        suspectedLL: [38.7, 47.9], suspected: 'Caspian transfer point',
        cargo: 'Crude · est. 730k bbl', lastAisAt: '2026-04-21 02:14Z',
        flagsSwapped: 5, owners: 8, sanctions: ['OFAC SDN', 'EU 14'],
        sightings: 3, disputed: 0, color: '#1ed1c5', verified: 'pinned',
    },
    {
        imo: 9259325, name: 'YOUNG YONG', flag: 'CAMEROON', age: 24, riskScore: 91,
        aisGap: '08d 19h', lastSeen: 'South China Sea', lastLL: [13.6, 110.4],
        suspectedLL: [22.3, 113.9], suspected: 'Pearl River anchorage',
        cargo: 'Diesel · est. 320k bbl', lastAisAt: '2026-04-26 18:02Z',
        flagsSwapped: 4, owners: 7, sanctions: ['OFAC SDN'],
        sightings: 2, disputed: 1, color: '#1ed1c5', verified: 'pinned',
    },
    {
        imo: 9311017, name: 'NS BURGAS', flag: 'GABON', age: 19, riskScore: 88,
        aisGap: '03d 11h', lastSeen: 'Aegean Sea', lastLL: [37.4, 25.8],
        suspectedLL: [43.4, 39.7], suspected: 'Novorossiysk STS',
        cargo: 'Fuel oil · est. 480k bbl', lastAisAt: '2026-05-02 09:47Z',
        flagsSwapped: 4, owners: 6, sanctions: ['EU 14', 'OFAC SDN'],
        sightings: 4, disputed: 1, color: '#5cdfd0', verified: 'illustrative',
    },
    {
        imo: 9489912, name: 'TURBA', flag: 'PALAU', age: 17, riskScore: 81,
        aisGap: '01d 22h', lastSeen: 'Gulf of Oman', lastLL: [24.2, 58.1],
        suspectedLL: [29.4, 50.7], suspected: 'Kharg Island loading',
        cargo: 'Crude · est. 1.1M bbl', lastAisAt: '2026-05-04 06:21Z',
        flagsSwapped: 3, owners: 5, sanctions: ['OFAC SDN'],
        sightings: 1, disputed: 0, color: '#5cdfd0', verified: 'illustrative',
    },
    {
        imo: 9266880, name: 'KAVKAZ', flag: 'COOK ISLANDS', age: 25, riskScore: 95,
        aisGap: '22d 03h', lastSeen: 'Black Sea', lastLL: [44.1, 36.2],
        suspectedLL: [42.0, 28.0], suspected: 'Bosphorus shadow STS',
        cargo: 'Crude · est. 600k bbl', lastAisAt: '2026-04-13 23:55Z',
        flagsSwapped: 6, owners: 11, sanctions: ['EU', 'UK', 'OFAC'],
        sightings: 5, disputed: 2, color: '#0e8d84', verified: 'illustrative',
    },
    {
        imo: 9412591, name: 'NIGHT IBIS', flag: 'EQ. GUINEA', age: 24, riskScore: 86,
        aisGap: '11d 04h', lastSeen: 'Bab el-Mandeb', lastLL: [12.6, 43.4],
        suspectedLL: [22.5, 38.0], suspected: 'Red Sea drift',
        cargo: 'Fuel oil · est. 410k bbl', lastAisAt: '2026-04-24 14:10Z',
        flagsSwapped: 4, owners: 6, sanctions: ['OFAC SDN'],
        sightings: 2, disputed: 0, color: '#5cdfd0', verified: 'illustrative',
    },
];

export function ensName(v: Vessel): string {
    return `imo-${v.imo}.vessel.phare.eth`;
}

export function ensUrl(v: Vessel): string {
    return `https://app.ens.domains/${ensName(v)}`;
}

export function swarmUrl(ref: string): string {
    const clean = ref.replace(/^bzz:\/\//, '');
    return `https://bzz.limo/bzz/${clean}/`;
}
