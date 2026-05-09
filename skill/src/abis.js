// Minimal ABIs — only the functions/events the agent actually needs.
// Source of truth: contracts/src/{Lighthouse,ReportRegistry,SlashPool}.sol
//                  + Sepolia ENS (NameWrapper, PublicResolver) and UMA OOv3.

export const lighthouseAbi = [
  // Vessel side (registry-only)
  {
    type: 'function', name: 'nameVessel', stateMutability: 'nonpayable',
    inputs: [
      { name: 'imo',      type: 'uint256' },
      { name: 'swarmRef', type: 'string' },
    ],
    outputs: [{ name: 'node', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'recordSighting', stateMutability: 'nonpayable',
    inputs: [
      { name: 'imo',       type: 'uint256' },
      { name: 'swarmRef',  type: 'string'  },
      { name: 'sightings', type: 'uint32'  },
      { name: 'disputed',  type: 'uint32'  },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'recordOrbital', stateMutability: 'nonpayable',
    inputs: [
      { name: 'imo',           type: 'uint256' },
      { name: 'image',         type: 'string'  },
      { name: 'imageHash',     type: 'bytes32' },
      { name: 'teePrediction', type: 'string'  },
    ],
    outputs: [],
  },
  // Verifier side (permissionless)
  {
    type: 'function', name: 'enrollVerifier', stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle',    type: 'string' },
      { name: 'policyURI', type: 'string' },
      { name: 'soulURI',   type: 'string' },
    ],
    outputs: [{ name: 'node', type: 'bytes32' }],
  },
  // Reads
  { type: 'function', name: 'nameWrapper',    stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'resolver',       stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'vesselParent',   stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'verifierParent', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'reportRegistry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  // Events
  { type: 'event', name: 'VesselNamed',       inputs: [
    { name: 'imo',  type: 'uint256', indexed: true },
    { name: 'node', type: 'bytes32', indexed: true },
    { name: 'ens',  type: 'string',  indexed: false },
  ]},
  { type: 'event', name: 'VesselSighted',     inputs: [
    { name: 'imo',       type: 'uint256', indexed: true },
    { name: 'node',      type: 'bytes32', indexed: true },
    { name: 'sightings', type: 'uint32',  indexed: false },
    { name: 'disputed',  type: 'uint32',  indexed: false },
  ]},
  { type: 'event', name: 'VesselOrbital',     inputs: [
    { name: 'imo',       type: 'uint256', indexed: true },
    { name: 'node',      type: 'bytes32', indexed: true },
    { name: 'imageHash', type: 'bytes32', indexed: false },
  ]},
  { type: 'event', name: 'VerifierEnrolled',  inputs: [
    { name: 'principal', type: 'address', indexed: true },
    { name: 'handle',    type: 'string',  indexed: false },
    { name: 'node',      type: 'bytes32', indexed: true },
  ]},
];

export const reportRegistryAbi = [
  {
    type: 'function', name: 'submit', stateMutability: 'nonpayable',
    inputs: [
      { name: 'imo',           type: 'uint256' },
      { name: 'aisDark',       type: 'bool'    },
      { name: 'photoHash',     type: 'bytes32' },
      { name: 'metadataSwarm', type: 'string'  },
    ],
    outputs: [{ name: 'reportId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'attest', stateMutability: 'nonpayable',
    inputs: [
      { name: 'reportId',      type: 'bytes32' },
      { name: 'imageSwarm',    type: 'string'  },
      { name: 'imageHash',     type: 'bytes32' },
      { name: 'teePrediction', type: 'string'  },
      { name: 'signature',     type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'getReport', stateMutability: 'view',
    inputs: [{ name: 'reportId', type: 'bytes32' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'reporter',         type: 'address' },
      { name: 'bond',             type: 'uint96'  },
      { name: 'umaBond',          type: 'uint96'  },
      { name: 'submittedAt',      type: 'uint64'  },
      { name: 'settledAt',        type: 'uint64'  },
      { name: 'status',           type: 'uint8'   },
      { name: 'imo',              type: 'uint256' },
      { name: 'aisDark',          type: 'bool'    },
      { name: 'photoHash',        type: 'bytes32' },
      { name: 'metadataSwarm',    type: 'string'  },
      { name: 'assertionId',      type: 'bytes32' },
      { name: 'orbitalAttested',  type: 'bool'    },
      { name: 'orbitalImageHash', type: 'bytes32' },
    ]}],
  },
  { type: 'function', name: 'protocolBond',      stateMutability: 'view', inputs: [], outputs: [{ type: 'uint96'  }] },
  { type: 'function', name: 'liveness',          stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64'  }] },
  { type: 'function', name: 'bondCurrency',      stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'oo',                stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'lighthouse',        stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'vesselNamed',       stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'sightingsByImo',    stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'disputedByImo',     stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint32' }] },
  { type: 'event', name: 'Submitted', inputs: [
    { name: 'reportId',     type: 'bytes32', indexed: true },
    { name: 'reporter',     type: 'address', indexed: true },
    { name: 'imo',          type: 'uint256', indexed: true },
    { name: 'aisDark',      type: 'bool',    indexed: false },
    { name: 'photoHash',    type: 'bytes32', indexed: false },
    { name: 'metadataSwarm',type: 'string',  indexed: false },
    { name: 'assertionId',  type: 'bytes32', indexed: false },
    { name: 'bond',         type: 'uint96',  indexed: false },
    { name: 'umaBond',      type: 'uint96',  indexed: false },
  ]},
  { type: 'event', name: 'Settled', inputs: [
    { name: 'reportId', type: 'bytes32', indexed: true },
    { name: 'truthful', type: 'bool',    indexed: false },
  ]},
];

export const publicResolverAbi = [
  {
    type: 'function', name: 'setText', stateMutability: 'nonpayable',
    inputs: [
      { name: 'node',  type: 'bytes32' },
      { name: 'key',   type: 'string'  },
      { name: 'value', type: 'string'  },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'setContenthash', stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'text', stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key',  type: 'string'  },
    ],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function', name: 'contenthash', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
  },
];

export const nameWrapperAbi = [
  {
    type: 'function', name: 'ownerOf', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function', name: 'getData', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'owner',  type: 'address' },
      { name: 'fuses',  type: 'uint32'  },
      { name: 'expiry', type: 'uint64'  },
    ],
  },
  {
    type: 'function', name: 'isApprovedForAll', stateMutability: 'view',
    inputs: [
      { name: 'owner',    type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

export const oov3Abi = [
  {
    type: 'function', name: 'settleAssertion', stateMutability: 'nonpayable',
    inputs: [{ name: 'assertionId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'disputeAssertion', stateMutability: 'nonpayable',
    inputs: [
      { name: 'assertionId', type: 'bytes32' },
      { name: 'disputer',    type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'getMinimumBond', stateMutability: 'view',
    inputs: [{ name: 'currency', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
];

export const wethAbi = [
  { type: 'function', name: 'deposit',   stateMutability: 'payable',    inputs: [], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',       inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve',   stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];
