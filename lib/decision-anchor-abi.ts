export const DECISION_ANCHOR_ABI = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_hash", type: "bytes32" },
      { name: "_metadataURI", type: "string" },
    ],
    outputs: [{ name: "index", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalReports",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getReport",
    stateMutability: "view",
    inputs: [{ name: "_index", type: "uint256" }],
    outputs: [
      { name: "hash", type: "bytes32" },
      { name: "submitter", type: "address" },
      { name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "ReportAnchored",
    inputs: [
      { indexed: true, name: "index", type: "uint256" },
      { indexed: true, name: "hash", type: "bytes32" },
      { indexed: true, name: "submitter", type: "address" },
      { indexed: false, name: "metadataURI", type: "string" },
    ],
    anonymous: false,
  },
] as const
