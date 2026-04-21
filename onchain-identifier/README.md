# On-chain tracking

Attribute active users and userOperations to your project by tagging each
userOp's `callData` with a 32-byte marker. Your indexer filters on the marker —
no extra infrastructure, no off-chain correlation.

## How it works

Pass `onChainIdentifierParams` when you initialize the Safe account. The SDK
appends the marker to every userOp's `callData`:

```ts
const smartAccount = SafeAccount.initializeNewAccount([owner], {
  onChainIdentifierParams: {
    project:     'YourProject',      // required — the thing you key analytics off
    platform:    'Web',              // optional — 'Web' | 'Mobile' | 'Safe App' | 'Widget'
    tool:        'abstractionkit',   // optional — which SDK
    toolVersion: '0.3.2',            // optional — SDK version
  },
})

console.log(smartAccount.onChainIdentifier) // 0x5afe00...
```

Already-deployed account? Pass the same params to the constructor:

```ts
const smartAccount = new SafeAccount(accountAddress, { onChainIdentifierParams: { project: 'YourProject' } })
```

Works the same — future userOps are tagged; historical userOps are not
retroactively tagged.

## Marker layout (32 bytes)

```text
5afe │ 00 │ project(20) │ platform(3) │ tool(3) │ toolVersion(3)
└─prefix  │
   version
```

Each content field is `keccak256(value)` truncated to its byte width.

## Indexer pattern

### Exact: decode `UserOperationEvent`

The EntryPoint emits a `UserOperationEvent` log for every included userOp.
Decode it, pull the userOp's `callData`, and check the suffix. **This is the
one to use — it's per-userOp and the marker sits exactly at the tail.**

```ts
const endsWithId = userOp.callData.toLowerCase().endsWith(identifier.toLowerCase())
```

Aggregate:

- Unique `sender` values → active users
- Total matching events → userOp volume
- Group by the identifier's trailing hashes → split by platform/tool/version

### Fuzzy: substring match on the bundler tx input

The bundler wraps the userOp in `EntryPoint.handleOps(ops[], beneficiary)`.
The marker ends up *inside* the tx `input`, not at the tail — a trailing
beneficiary address sits after it. Use substring (not suffix) match:

```ts
const tagged = tx.input.toLowerCase().includes(identifier.toLowerCase())
```

Good enough for quick dashboards, but batches of multiple userOps in one
`handleOps` call appear as one match. Prefer the event-based approach.

## Run the example

```bash
npx ts-node onchain-identifier/onchain-identifier.ts
```

Uses the public Arbitrum Sepolia endpoints from
[`CLAUDE.md`](../CLAUDE.md) — no signup needed.

## Register your project

Submit your identifier so Safe can attribute on-chain activity to you:
https://forms.gle/NYkorYebc6Fz1fMW6
