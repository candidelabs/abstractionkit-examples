# External Signer

The capability-oriented signer API (abstractionkit v0.3.2+) lets you plug
any signing source into AbstractionKit without handing raw private keys
to the SDK.

## Pick an adapter

| Adapter | For | Example |
|---|---|---|
| `fromPrivateKey(pk)` | Raw 0x hex string, zero extra dependencies | [fromPrivateKey.ts](./fromPrivateKey.ts) |
| `fromViem(localAccount)` | Any `viem` `LocalAccount` | [fromViem.ts](./fromViem.ts) |
| `fromEthersWallet(wallet)` | Any `ethers.Wallet` / `HDNodeWallet` (>= 6) | [fromEthersWallet.ts](./fromEthersWallet.ts) |
| `fromViemWalletClient(client)` | `viem` `WalletClient`, typed-data only | [fromViemWalletClient.ts](./fromViemWalletClient.ts) |
| Custom `ExternalSigner` | HSM, MPC, hardware wallet, Uint8Array-only | [customSigner.ts](./customSigner.ts) |

Each file is self-contained. If you use viem, read `fromViem.ts`; if you
use ethers, read `fromEthersWallet.ts`. You do not need to install both.

## Shape

```ts
type ExternalSigner = { address: `0x${string}` } & (
  | { signHash:       (hash: `0x${string}`) => Promise<`0x${string}`>
      signTypedData?: (data: TypedData)     => Promise<`0x${string}`> }
  | { signHash?:      (hash: `0x${string}`) => Promise<`0x${string}`>
      signTypedData:  (data: TypedData)     => Promise<`0x${string}`> }
)
```

The discriminated union enforces that at least one of `signHash` or
`signTypedData` is provided; `{ address }` with neither method is rejected
at compile time.

Canonical definition: [`Signer` in abstractionkit's `src/signer/types.ts`](https://github.com/candidelabs/abstractionkit/blob/main/src/signer/types.ts),
re-exported from the package root as `ExternalSigner`.

## Calling it

```ts
// Safe accounts (multi-signer array)
userOp.signature = await safe.signUserOperationWithSigners(userOp, [signer], chainId)

// Simple7702 / Calibur (single signer)
userOp.signature = await account.signUserOperationWithSigner(userOp, signer, chainId)

// SafeMultiChainSigAccountV1 (multi-op, one signature covers all chains)
const signatures = await account.signUserOperationsWithSigners(
  [{ userOperation: op1, chainId: id1 }, { userOperation: op2, chainId: id2 }],
  [signer],
)
```

## Negotiation

When the signer exposes both capabilities, the account picks the preferred
scheme. Safe prefers `signTypedData` for the structured EIP-712 display;
Simple7702 / Calibur require `signHash`.

Capability mismatches throw **offline** with an actionable message. No
external device is prompted for a signature that would be rejected.

Example: a `fromViemWalletClient` signer (typed-data only) passed to the
multi-op Merkle path (which needs `signHash`) fails before the wallet is
ever invoked.

## Not covered here

- Account-specific flows: see `../sponsor-gas/sponsor-gas-external-signer.ts`,
  `../eip-7702/*/0X-external-signer*.ts`,
  `../chain-abstraction/add-owner-with-external-signer.ts`.
- The legacy sync API (`signUserOperation(op, [pk], chainId)`) is still
  supported. Use it when you already have a raw pk string and don't need
  async signing.
