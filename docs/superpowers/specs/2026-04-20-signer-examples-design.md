# Signer Examples Design

**Date:** 2026-04-20
**Repo:** `abstractionkit-examples`
**Driver:** Showcase the v0.3.2 `ExternalSigner` API (PR #109) in a form that is clear to developers and to AI coding agents (Cursor, Copilot, Claude Code).

## Context

AbstractionKit v0.3.2 shipped a new capability-oriented signer API:

- `ExternalSigner` interface with `signHash` and/or `signTypedData` capabilities.
- Built-in adapters: `fromPrivateKey`, `fromViem`, `fromEthersWallet`, `fromViemWalletClient`.
- New methods on every account class:
  - Safe accounts (multi-signer): `signUserOperationWithSigners(op, signers[], chainId)`
  - Simple7702 / Calibur (single signer): `signUserOperationWithSigner(op, signer, chainId)`
  - `SafeMultiChainSigAccountV1` multi-op: `signUserOperationsWithSigners(ops[], signers[], chainId)`

The existing signer examples in `abstractionkit-examples` were matrix-style test harnesses written during PR development. They cover the new API but are dense, loop over 3-8 variants per file, and mix ethers + viem imports in the same file. They read as verification scaffolding, not as reference material for developers or AI agents arriving to learn the API.

## Goals

1. One clear narrative per file. No matrices, no loops, no multi-adapter files.
2. Viem-first in all account-specific examples, matching the rest of the repo (which uses viem as a regular dep and ethers only as a devDep).
3. A dedicated `signer/` hub with one file per adapter, so developers (and AI agents) pick up only the file for the lib they already use.
4. No implication that developers need both viem and ethers installed.
5. Reference examples use the new `Erc7677Paymaster` class. Existing non-signer examples stay on `CandidePaymaster` (no unrelated churn).

## Non-goals

- Rewriting non-signer examples to use `Erc7677Paymaster`.
- Adding CI tests (the repo has none).
- Covering every possible signer kind. HSM / MPC / hardware wallet are covered by one representative `customSigner.ts` file.

## File plan

### Delete (PR test artifacts)

```
sponsor-gas/sponsor-gas-v2-signer.ts
sponsor-gas/sponsor-gas-with-signer.ts
sponsor-gas/sponsor-gas-with-signer.js
sponsor-gas/compiled-ts-example.js
sponsor-gas/v2-compiled.js
sponsor-gas/sponsor-gas-with-signer.ts.compiled.js
eip-7702/simple-account/06-signer-api.ts
eip-7702/simple-account/06-compiled.js
eip-7702/simple-account/07-signer-api-v09.ts
eip-7702/calibur-account/04-signer-api.ts
erc7677/erc7677-with-signer.ts
pay-gas-in-erc20/pay-gas-in-erc20-with-signer.ts
chain-abstraction/add-owner-with-signers.ts
```

### Add (hub, `signer/`)

```
signer/README.md                  # adapter matrix + API summary
signer/fromPrivateKey.ts          # raw pk, no extra deps
signer/fromViem.ts                # viem LocalAccount
signer/fromEthersWallet.ts        # ethers Wallet / HDNodeWallet
signer/fromViemWalletClient.ts    # viem WalletClient (typed-data only)
signer/customSigner.ts            # HSM / MPC / hardware-wallet shape
```

Each hub file is self-contained and imports **only** its own lib. A developer reading `fromViem.ts` sees no ethers. A developer reading `fromEthersWallet.ts` sees no viem. Custom and private-key files have no external signing lib at all.

### Add (account-specific starters, viem-only)

```
sponsor-gas/sponsor-gas-external-signer.ts             # SafeAccountV0_3_0 (EP v0.7), sponsored
eip-7702/simple-account/06-external-signer.ts          # Simple7702Account (EP v0.8)
eip-7702/simple-account/07-external-signer-v09.ts      # Simple7702AccountV09 (EP v0.9), two-phase paymaster
eip-7702/calibur-account/04-external-signer.ts         # Calibur7702Account (EP v0.8)
chain-abstraction/add-owner-with-external-signer.ts    # SafeMultiChainSigAccountV1 multi-op
```

### Update

```
README.md      # new "Bring your own signer" row group + updated existing rows
CLAUDE.md      # new "External Signer (v0.3.2+)" section, Account Types column added
```

## Hub file contract

Every hub file has the same structure:

```
header comment
  - what adapter and what it solves
  - which developer profile arrives here
  - machine-parseable one-line tag for AI agents

imports
  - utils/env (standard)
  - abstractionkit (ExternalSigner + one adapter + account class + paymaster)
  - adapter-specific lib (viem OR ethers OR none)

1. build the ExternalSigner              # the one line this file exists to show
2. initializeNewAccount([signer.address])
3. build a MetaTransaction (NFT mint, matches existing repo convention)
4. createUserOperation
5. Erc7677Paymaster.createPaymasterUserOperation(...)
6. userOp.signature = await account.signUserOperationWithSigners(userOp, [signer], chainId)
7. sendUserOperation + included()
```

Only the `signer = ...` line and its imports differ between files. Everything else is identical boilerplate so readers can diff-read the adapter choice in isolation.

### Per-file highlights

- **`fromPrivateKey.ts`**: raw 0x hex string. Zero external deps. Narrative: "already had a pk string? wrap it and you're done".
- **`fromViem.ts`**: `privateKeyToAccount(pk)` -> `fromViem(...)`. Notes both `signHash` and `signTypedData` are available and the Safe account will prefer `signTypedData`.
- **`fromEthersWallet.ts`**: `new Wallet(pk)` -> `fromEthersWallet(...)`. Same capability note.
- **`fromViemWalletClient.ts`**: `createWalletClient({ account, chain, transport })` -> `fromViemWalletClient(...)`. Comment block explaining this is typed-data-only and therefore does NOT work with the multi-op Merkle path (pickScheme rejects it offline with a clear error; example calls this out).
- **`customSigner.ts`**: inline `{ address, signHash }` object. Uses `viem/accounts` (`privateKeyToAccount(pk).sign`) as the runnable stand-in for the cryptography so the file only pulls in viem, matching the repo's viem-first convention. The body is wrapped in comments framing it as "pretend this is an HSM, replace the viem call with your HSM / MPC / hardware-wallet SDK". The shape of the outer `ExternalSigner` object is the thing the reader is meant to copy.

## Account-folder starter contract

Each file is:

- Single-path (one `signer = fromViem(privateKeyToAccount(pk))` line, no branching).
- Owner address is `signer.address` (single source of truth; makes ownership chain explicit).
- Opens with a 4-6 line docstring: what account class, what flow, what the `ExternalSigner` line is doing, one per-account gotcha.
- Uses `Erc7677Paymaster` for all sponsored flows.
- EIP-7702 files call out in a comment that the **delegation authorization** (`createAndSignEip7702DelegationAuthorization(..., pk)`) still takes the raw pk. It is a separate concern from op signing, and this is not redundant with the `ExternalSigner` path.
- Chain-abstraction file uses two chains (Sepolia + OP Sepolia) to match the rest of `chain-abstraction/`, and shows the one-signature-covers-all-ops property of `signUserOperationsWithSigners`.

## README.md updates

Add a new row group after the existing "What Do You Want to Build?" table:

```
### Bring your own signer

| Goal | Folder | Key File |
|------|--------|----------|
| Overview + adapter matrix | `signer/` | `README.md` |
| viem LocalAccount | `signer/` | `fromViem.ts` |
| ethers Wallet | `signer/` | `fromEthersWallet.ts` |
| Raw private key | `signer/` | `fromPrivateKey.ts` |
| viem WalletClient (typed-data path) | `signer/` | `fromViemWalletClient.ts` |
| Custom (HSM / MPC / hardware) | `signer/` | `customSigner.ts` |
```

Update existing rows to point at the new starters:

```
| Gasless transactions (external signer) | `sponsor-gas/` | `sponsor-gas-external-signer.ts` |
| EIP-7702 external signer               | `eip-7702/simple-account/` | `06-external-signer.ts` |
| EIP-7702 EP v0.9 external signer       | `eip-7702/simple-account/` | `07-external-signer-v09.ts` |
| Calibur 7702 external signer           | `eip-7702/calibur-account/` | `04-external-signer.ts` |
| Multichain add owner (external signer) | `chain-abstraction/` | `add-owner-with-external-signer.ts` |
```

## CLAUDE.md updates

New section placed above "Code Pattern" so AI agents encounter it before copying the sync API boilerplate.

```markdown
## External Signer (v0.3.2+)

Use `signUserOperationWithSigners` (Safe, multi-signer array) or
`signUserOperationWithSigner` (Simple7702 / Calibur, single signer) with an
`ExternalSigner` to avoid passing raw private keys into the SDK.

Four built-in adapters cover the common cases:

| Adapter | For |
|---|---|
| `fromPrivateKey(pk)` | Raw 0x hex string; zero dependencies |
| `fromViem(localAccount)` | Any `viem` `LocalAccount` (most projects) |
| `fromEthersWallet(wallet)` | Any `ethers.Wallet` / `HDNodeWallet` |
| `fromViemWalletClient(client)` | `viem` `WalletClient` (typed-data only; no multi-op) |

For HSM / MPC / hardware wallets, pass an inline object matching
`ExternalSigner`:
`{ address, signHash?(hash): Promise<hex>, signTypedData?(data): Promise<hex> }`.
At least one of `signHash` or `signTypedData` is required (compile-time check).

Signing is async (each method returns `Promise<string>`). Capability mismatches
(e.g. a typed-data-only signer against a hash-only account) throw offline with
an actionable message - the signer is never invoked in that case, so no
HSM / hardware prompt fires on a trip that would fail anyway.

Canonical per-adapter examples: `signer/`. Account-specific starters:
`sponsor-gas/sponsor-gas-external-signer.ts`, `eip-7702/*/0X-external-signer*.ts`,
`chain-abstraction/add-owner-with-external-signer.ts`.
```

Append a column to the Account Types table:

```
| Class | Use Case | EntryPoint | External Signer method |
|-------|----------|------------|------------------------|
| `SafeAccountV0_3_0` | Most examples (recommended) | v0.7 | `signUserOperationWithSigners(op, signers[], chainId)` |
| `SafeAccountV0_2_0` | Legacy/v0.6 compatibility | v0.6 | `signUserOperationWithSigners(op, signers[], chainId)` |
| `Simple7702Account` | EIP-7702 delegation | v0.8 | `signUserOperationWithSigner(op, signer, chainId)` |
| `Simple7702AccountV09` | EIP-7702 delegation (EP v0.9) | v0.9 | `signUserOperationWithSigner(op, signer, chainId)` |
| `SafeMultiChainSigAccountV1` | Chain abstraction | v0.9 | `signUserOperationsWithSigners(ops[], signers[], chainId)` |
| `Calibur7702Account` | EIP-7702 Calibur | v0.8 (default) | `signUserOperationWithSigner(op, signer, chainId)` |
```

## Paymaster convention

- New signer examples (hub + 5 account starters): use `Erc7677Paymaster`.
- Existing non-signer examples: untouched, still on `CandidePaymaster`.

Rationale: keeps the PR diff scoped to the signer story. A later PR can migrate the rest of the repo to `Erc7677Paymaster` if that is desired.

## Dependencies

- `viem` remains a regular dep (no change).
- `ethers` remains a devDep. Only `signer/fromEthersWallet.ts` imports it, and the `signer/README.md` states the adapter is optional.
- No new deps.

## Verification

Each new file is runnable end-to-end against Arbitrum Sepolia with the public bundler/paymaster + a funded EOA, matching the existing repo convention. Smoke-test locally before committing. Typecheck via `npm run build` (tsc) must pass. No CI tests added (the repo has none).

## Out of scope

- Additional paymaster providers (Pimlico, Alchemy) - `Erc7677Paymaster` is provider-agnostic; Candide URL is the canonical demonstration.
- Recovery / spend-permission / passkeys signer flows - no `ExternalSigner` surface area there yet; out of scope for this round.
- Migrating non-signer examples to `Erc7677Paymaster`.
