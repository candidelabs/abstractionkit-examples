# External Signer

The capability-oriented signer API (abstractionkit v0.3.2+) lets you plug
any signing source into AbstractionKit without handing raw private keys
to the SDK.

## Pick an adapter

| Adapter | For | Example |
|---|---|---|
| `fromViem(localAccount)` | Any `viem` `LocalAccount` | [fromViem.ts](./fromViem.ts) |
| `fromEthersWallet(wallet)` | Any `ethers.Wallet` / `HDNodeWallet` (>= 6) | [fromEthersWallet.ts](./fromEthersWallet.ts) |
| `fromViemWalletClient(client)` | `viem` `WalletClient`, typed-data only | [fromViemWalletClient.ts](./fromViemWalletClient.ts) |
| Custom `ExternalSigner` | HSM, MPC, hardware wallet, Uint8Array-only | [customSigner.ts](./customSigner.ts) |

Each file is self-contained. If you use viem, read `fromViem.ts`; if you
use ethers, read `fromEthersWallet.ts`. You do not need to install both.

### What about a raw private key?

If you already have a plain 0x-hex private key, the shortest path is the
legacy sync API:

```ts
userOp.signature = safe.signUserOperation(userOp, [privateKey], chainId)
```

abstractionkit also exports a `fromPrivateKey(pk)` adapter that wraps a
pk into an `ExternalSigner`. It is intended for multi-owner setups where
you want every owner (pk, HSM, hardware wallet) to flow through the same
async interface. For a single-owner pk use case, the sync API is simpler
and requires no extra wrapping.

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

## Account-specific flows

- `../eip-7702/simple-account/05-external-signer.ts` - Simple7702 (EP v0.8)
- `../eip-7702/simple-account/06-external-signer-v09.ts` - Simple7702 (EP v0.9, two-phase paymaster)
- `../eip-7702/calibur-account/04-external-signer.ts` - Calibur
- `../chain-abstraction/add-owner-with-external-signer.ts` - multi-chain, multi-op with one signature
