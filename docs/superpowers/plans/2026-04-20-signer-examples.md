# Signer Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a clean set of reference examples for the v0.3.2 `ExternalSigner` API: a hub with one file per adapter and per-account starters that each demonstrate the API in its natural flow.

**Architecture:** Hub at `signer/` with one self-contained file per adapter (no mixed lib imports). Per-account starters in `sponsor-gas/`, `eip-7702/simple-account/`, `eip-7702/calibur-account/`, `chain-abstraction/`. All new files use `Erc7677Paymaster`. Existing non-signer examples stay on `CandidePaymaster`. PR test-artifact files from the signer PR are deleted.

**Tech Stack:** TypeScript (strict), `abstractionkit@^0.3.2`, `viem@^2`, `ethers@^6` (devDep, only `fromEthersWallet.ts` imports it), `dotenv`. Runs against Arbitrum Sepolia via the public bundler/paymaster. No CI tests; verification is `tsc --noEmit` + optional smoke run.

---

## File Plan

**Delete (13 files):**
- `sponsor-gas/sponsor-gas-v2-signer.ts`
- `sponsor-gas/sponsor-gas-with-signer.ts`
- `sponsor-gas/sponsor-gas-with-signer.js`
- `sponsor-gas/compiled-ts-example.js`
- `sponsor-gas/v2-compiled.js`
- `sponsor-gas/sponsor-gas-with-signer.ts.compiled.js`
- `eip-7702/simple-account/06-signer-api.ts`
- `eip-7702/simple-account/06-compiled.js`
- `eip-7702/simple-account/07-signer-api-v09.ts`
- `eip-7702/calibur-account/04-signer-api.ts`
- `erc7677/erc7677-with-signer.ts`
- `pay-gas-in-erc20/pay-gas-in-erc20-with-signer.ts`
- `chain-abstraction/add-owner-with-signers.ts`

**Create (hub, 6 files):**
- `signer/README.md`
- `signer/fromPrivateKey.ts`
- `signer/fromViem.ts`
- `signer/fromEthersWallet.ts`
- `signer/fromViemWalletClient.ts`
- `signer/customSigner.ts`

**Create (account-specific starters, 5 files, viem-only):**
- `sponsor-gas/sponsor-gas-external-signer.ts`
- `eip-7702/simple-account/06-external-signer.ts`
- `eip-7702/simple-account/07-external-signer-v09.ts`
- `eip-7702/calibur-account/04-external-signer.ts`
- `chain-abstraction/add-owner-with-external-signer.ts`

**Update:**
- `README.md` - new "Bring your own signer" row group + updated existing rows
- `CLAUDE.md` - new "External Signer (v0.3.2+)" section, Account Types column

---

## Shared Conventions

Every new TS file:
- Opens with a header docstring: what it does, which developer profile arrives here, one per-adapter/per-account gotcha if any.
- Uses `loadEnv()` / `loadMultiChainEnv()` / `getOrCreateOwner()` from `utils/env.ts`.
- Uses `Erc7677Paymaster.createPaymasterUserOperation(smartAccount, userOp, bundlerUrl, { sponsorshipPolicyId })` (returns a single op, not a tuple) **EXCEPT** for the two EntryPoint v0.9 files (`07-external-signer-v09.ts` and `chain-abstraction/add-owner-with-external-signer.ts`) which use `CandidePaymaster.createSponsorPaymasterUserOperation(...)` with two-phase `signingPhase: "commit"` / `"finalize"`. `Erc7677Paymaster` doesn't support EP v0.9. Each v0.9 file carries a comment block explaining the exception.
- Uses the NFT mint contract `0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336` on Arbitrum Sepolia (matches existing repo convention).
- Ends with `main().catch(...)` for CLI execution.

**API signatures** (from `abstractionkit@0.3.2`, verified against `origin/dev`):

```ts
// Safe accounts (V0_2_0, V0_3_0, MultiChainSig):
signUserOperationWithSigners(op, signers[], chainId): Promise<string>

// SafeMultiChainSigAccountV1 multi-op:
signUserOperationsWithSigners(
  items: Array<{ userOperation, chainId: bigint }>,
  signers: ExternalSigner[],
): Promise<string[]>  // returns one signature per op, BUT from ONE signing operation

// Simple7702Account, Simple7702AccountV09, Calibur7702Account:
signUserOperationWithSigner(op, signer, chainId): Promise<string>

// ExternalSigner shape (discriminated union):
interface ExternalSigner {
  address: `0x${string}`
  signHash?(hash: `0x${string}`, ctx): Promise<`0x${string}`>
  signTypedData?(data: TypedData, ctx): Promise<`0x${string}`>
}
// At least one of signHash/signTypedData is required (compile-time check).

// Adapters (all exported from 'abstractionkit'):
fromPrivateKey(pk: string): ExternalSigner           // zero external deps
fromViem(localAccount: viem.LocalAccount): ExternalSigner
fromEthersWallet(wallet: ethers.Wallet): ExternalSigner
fromViemWalletClient(client: viem.WalletClient): ExternalSigner  // typed-data only
```

**Typecheck command** (run after each file to verify):
```bash
npx tsc --noEmit
```

---

## Task 0: Preflight - verify branch, abstractionkit version, clean typecheck

**Files:** (no code changes)

- [ ] **Step 1: Verify branch**

Run: `git branch --show-current`
Expected: `docs/signer-examples`

- [ ] **Step 2: Verify abstractionkit version supports the new signer API**

Run: `node -e "console.log(require('abstractionkit/package.json').version)"`
Expected: `0.3.2` or higher. If `0.3.1` or lower, run `npm install abstractionkit@^0.3.2` and commit the lockfile bump as a separate commit before continuing.

- [ ] **Step 3: Baseline typecheck**

Run: `npx tsc --noEmit`
Expected: either clean exit OR known pre-existing errors in PR test-artifact files (which will be deleted in Task 1). If other errors appear, stop and investigate.

- [ ] **Step 4: (No commit - read-only preflight.)**

---

## Task 1: Delete PR test artifacts

**Files:**
- Delete: `sponsor-gas/sponsor-gas-v2-signer.ts`
- Delete: `sponsor-gas/sponsor-gas-with-signer.ts`
- Delete: `sponsor-gas/sponsor-gas-with-signer.js`
- Delete: `sponsor-gas/compiled-ts-example.js`
- Delete: `sponsor-gas/v2-compiled.js`
- Delete: `sponsor-gas/sponsor-gas-with-signer.ts.compiled.js`
- Delete: `eip-7702/simple-account/06-signer-api.ts`
- Delete: `eip-7702/simple-account/06-compiled.js`
- Delete: `eip-7702/simple-account/07-signer-api-v09.ts`
- Delete: `eip-7702/calibur-account/04-signer-api.ts`
- Delete: `erc7677/erc7677-with-signer.ts`
- Delete: `pay-gas-in-erc20/pay-gas-in-erc20-with-signer.ts`
- Delete: `chain-abstraction/add-owner-with-signers.ts`

- [ ] **Step 1: Delete the 13 files**

Run:
```bash
rm sponsor-gas/sponsor-gas-v2-signer.ts \
   sponsor-gas/sponsor-gas-with-signer.ts \
   sponsor-gas/sponsor-gas-with-signer.js \
   sponsor-gas/compiled-ts-example.js \
   sponsor-gas/v2-compiled.js \
   sponsor-gas/sponsor-gas-with-signer.ts.compiled.js \
   eip-7702/simple-account/06-signer-api.ts \
   eip-7702/simple-account/06-compiled.js \
   eip-7702/simple-account/07-signer-api-v09.ts \
   eip-7702/calibur-account/04-signer-api.ts \
   erc7677/erc7677-with-signer.ts \
   pay-gas-in-erc20/pay-gas-in-erc20-with-signer.ts \
   chain-abstraction/add-owner-with-signers.ts
```

- [ ] **Step 2: Verify no stale `.js` / `.d.ts` artifacts remain**

Run: `ls sponsor-gas/ eip-7702/simple-account/ eip-7702/calibur-account/ erc7677/ pay-gas-in-erc20/ chain-abstraction/ | grep -E "(signer|compiled)"`
Expected: empty output (no stale artifacts). If anything shows, delete it (likely `.d.ts` files from prior `tsc` runs that were never cleaned).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore(signer): remove PR test-artifact signer files

Drops the matrix-style test harnesses that shipped alongside the v0.3.2
signer PR. They are replaced by focused reference examples added in the
following commits."
```

---

## Task 2: Hub - `signer/fromPrivateKey.ts`

**Files:**
- Create: `signer/fromPrivateKey.ts`

- [ ] **Step 1: Write the file**

```ts
// ExternalSigner adapter: fromPrivateKey -> signHash + signTypedData
//
// Use this adapter when all you have is a raw 0x-prefixed private key
// string. Zero external deps: the library uses its internal ethers
// dependency under the hood, so callers don't have to install anything.
//
// Why it exists: most scripts, integration tests, and server-side
// workers already hold a pk in an env var. fromPrivateKey wraps it
// without forcing the developer to instantiate a viem or ethers object
// just to sign a UserOperation.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    fromPrivateKey,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner. This is the only line that changes
    //    between hub examples.
    const signer: ExternalSigner = fromPrivateKey(privateKey)
    console.log('Adapter       : fromPrivateKey')
    console.log('Capabilities  : signHash=%s signTypedData=%s',
        typeof signer.signHash === 'function',
        typeof signer.signTypedData === 'function')
    console.log('Signer address:', signer.address)

    // 2. Standard Safe flow.
    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe (sender) :', smartAccount.accountAddress)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintTx: MetaTransaction = {
        to: nft,
        value: 0n,
        data: createCallData(
            getFunctionSelector('mint(address)'),
            ['address'],
            [smartAccount.accountAddress],
        ),
    }

    let userOp = await smartAccount.createUserOperation(
        [mintTx], nodeUrl, bundlerUrl,
    )

    // 3. Sponsor gas via ERC-7677. Works against any ERC-7677 provider
    //    (Candide, Pimlico, Alchemy, self-hosted).
    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    // 4. Sign with the ExternalSigner. Safe accepts an array of signers
    //    (multi-owner ready); we pass a single-element array here.
    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

    // 5. Send + wait.
    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp hash   :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx            :', receipt.receipt.transactionHash)
    console.log('Success       :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add signer/fromPrivateKey.ts
git commit -m "docs(signer): add fromPrivateKey hub example

Zero-dep adapter for scripts, integration tests, and server workers that
already hold a raw pk string. Canonical one-liner:
  const signer = fromPrivateKey(process.env.PRIVATE_KEY!)"
```

---

## Task 3: Hub - `signer/fromViem.ts`

**Files:**
- Create: `signer/fromViem.ts`

- [ ] **Step 1: Write the file**

```ts
// ExternalSigner adapter: fromViem -> signHash + signTypedData
//
// Use this adapter when you already hold a viem `LocalAccount`
// (the most common shape in viem-first projects). Exposes both
// capabilities; when Safe negotiates, it picks signTypedData so the
// user sees structured EIP-712 fields instead of an opaque hex blob.
//
// Why it exists: avoids round-tripping your viem Account through a raw
// pk string just to get a signature.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    fromViem,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner from a viem LocalAccount. In a real
    //    app, this LocalAccount comes from wherever you already create
    //    one (privateKeyToAccount, toAccount, a wagmi connector, ...).
    const localAccount = privateKeyToAccount(privateKey as `0x${string}`)
    const signer: ExternalSigner = fromViem(localAccount)
    console.log('Adapter       : fromViem')
    console.log('Capabilities  : signHash=%s signTypedData=%s',
        typeof signer.signHash === 'function',
        typeof signer.signTypedData === 'function')
    console.log('Signer address:', signer.address)

    // 2. Standard Safe flow.
    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe (sender) :', smartAccount.accountAddress)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintTx: MetaTransaction = {
        to: nft,
        value: 0n,
        data: createCallData(
            getFunctionSelector('mint(address)'),
            ['address'],
            [smartAccount.accountAddress],
        ),
    }

    let userOp = await smartAccount.createUserOperation(
        [mintTx], nodeUrl, bundlerUrl,
    )

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp hash   :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx            :', receipt.receipt.transactionHash)
    console.log('Success       :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add signer/fromViem.ts
git commit -m "docs(signer): add fromViem hub example

Adapter for viem LocalAccount instances. Both signHash and signTypedData
are exposed; Safe prefers signTypedData for structured EIP-712 UX."
```

---

## Task 4: Hub - `signer/fromEthersWallet.ts`

**Files:**
- Create: `signer/fromEthersWallet.ts`

- [ ] **Step 1: Write the file**

```ts
// ExternalSigner adapter: fromEthersWallet -> signHash + signTypedData
//
// Use this adapter when your project already depends on ethers (>=6).
// This is the ONLY hub file that imports ethers; every other adapter
// works without it. If you don't use ethers, skip this file.
//
// Why it exists: ethers users don't need to swap to viem to get signer
// support in abstractionkit.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { Wallet } from 'ethers'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    fromEthersWallet,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner from an ethers Wallet. In a real app,
    //    the Wallet comes from wherever you already create one (new
    //    Wallet(pk), HDNodeWallet.fromPhrase, ethers.getSigner(), ...).
    const wallet = new Wallet(privateKey)
    const signer: ExternalSigner = fromEthersWallet(wallet)
    console.log('Adapter       : fromEthersWallet')
    console.log('Capabilities  : signHash=%s signTypedData=%s',
        typeof signer.signHash === 'function',
        typeof signer.signTypedData === 'function')
    console.log('Signer address:', signer.address)

    // 2. Standard Safe flow.
    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe (sender) :', smartAccount.accountAddress)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintTx: MetaTransaction = {
        to: nft,
        value: 0n,
        data: createCallData(
            getFunctionSelector('mint(address)'),
            ['address'],
            [smartAccount.accountAddress],
        ),
    }

    let userOp = await smartAccount.createUserOperation(
        [mintTx], nodeUrl, bundlerUrl,
    )

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp hash   :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx            :', receipt.receipt.transactionHash)
    console.log('Success       :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add signer/fromEthersWallet.ts
git commit -m "docs(signer): add fromEthersWallet hub example

Adapter for ethers v6 Wallet / HDNodeWallet instances. Only hub file
that imports ethers; all other adapters work without it."
```

---

## Task 5: Hub - `signer/fromViemWalletClient.ts`

**Files:**
- Create: `signer/fromViemWalletClient.ts`

- [ ] **Step 1: Write the file**

```ts
// ExternalSigner adapter: fromViemWalletClient -> signTypedData only
//
// Use this adapter when you hold a viem `WalletClient` (the client-style
// API dApps use to drive browser / WalletConnect / JSON-RPC wallets).
// WalletClient cannot sign raw hashes (JSON-RPC wallets refuse), so
// this adapter exposes only signTypedData.
//
// Capability caveat: this signer will NOT work on the multi-op Merkle
// path (SafeMultiChainSigAccountV1.signUserOperationsWithSigners) -
// that path requires signHash, and pickScheme will throw offline with
// an actionable error naming this adapter. Use fromViem instead when
// you need multi-op.
//
// For local accounts (privateKeyToAccount), pass the LocalAccount to
// fromViem instead of wrapping it in a WalletClient - you'll get raw-
// hash support for free.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrumSepolia } from 'viem/chains'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    fromViemWalletClient,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner from a viem WalletClient.
    //    A LocalAccount is attached here so the example is runnable
    //    without a browser; in a dApp the account would come from a
    //    browser wallet / WalletConnect / injected provider.
    const localAccount = privateKeyToAccount(privateKey as `0x${string}`)
    const walletClient = createWalletClient({
        account: localAccount,
        chain: arbitrumSepolia,
        transport: http(nodeUrl),
    })
    const signer: ExternalSigner = fromViemWalletClient(walletClient)
    console.log('Adapter       : fromViemWalletClient')
    console.log('Capabilities  : signHash=%s signTypedData=%s',
        typeof signer.signHash === 'function',
        typeof signer.signTypedData === 'function')
    console.log('Signer address:', signer.address)

    // 2. Standard Safe flow.
    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe (sender) :', smartAccount.accountAddress)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintTx: MetaTransaction = {
        to: nft,
        value: 0n,
        data: createCallData(
            getFunctionSelector('mint(address)'),
            ['address'],
            [smartAccount.accountAddress],
        ),
    }

    let userOp = await smartAccount.createUserOperation(
        [mintTx], nodeUrl, bundlerUrl,
    )

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp hash   :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx            :', receipt.receipt.transactionHash)
    console.log('Success       :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add signer/fromViemWalletClient.ts
git commit -m "docs(signer): add fromViemWalletClient hub example

Adapter for viem WalletClient (dApps driving browser / WalletConnect /
JSON-RPC wallets). Typed-data only; multi-op Merkle path is not
supported and errors offline via pickScheme."
```

---

## Task 6: Hub - `signer/customSigner.ts`

**Files:**
- Create: `signer/customSigner.ts`

- [ ] **Step 1: Write the file**

```ts
// ExternalSigner: custom inline shape (HSM / MPC / hardware-wallet pattern)
//
// Use this pattern when your signing key lives somewhere abstractionkit
// doesn't know about: a cloud HSM, an MPC threshold service, a hardware
// wallet, a Uint8Array-only key that you want to zero after use, etc.
//
// The runnable stand-in uses viem's `privateKeyToAccount().sign` for the
// cryptography so the file only imports viem. In your own code, replace
// the body of `signHash` (and optionally `signTypedData`) with a call to
// your HSM / MPC SDK. The OUTER shape (address + one-or-more capability
// methods) is what matters.
//
// The SDK enforces the "at least one capability" rule at compile time
// via a discriminated union: `{ address }` with neither method is a
// TypeScript error.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

// Pretend this is your HSM client. Replace the body of each method with
// a real HSM / MPC / hardware-wallet SDK call.
function buildHsmSigner(privateKey: `0x${string}`): ExternalSigner {
    const account = privateKeyToAccount(privateKey)  // stand-in cryptography
    return {
        address: account.address,
        // ─── Replace below with your HSM call ──────────────────────────
        // In production the pk never exists in JS memory; the HSM signs
        // the hash remotely and returns the signature.
        signHash: async (hash) => account.sign({ hash }),
        // ─── Optional: only declare if your HSM supports EIP-712 ──────
        // Omitting signTypedData is fine; Safe will fall back to signHash.
    }
}

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the custom ExternalSigner.
    const signer = buildHsmSigner(privateKey as `0x${string}`)
    console.log('Adapter       : custom (HSM / MPC / hardware pattern)')
    console.log('Capabilities  : signHash=%s signTypedData=%s',
        typeof signer.signHash === 'function',
        typeof signer.signTypedData === 'function')
    console.log('Signer address:', signer.address)

    // 2. Standard Safe flow.
    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe (sender) :', smartAccount.accountAddress)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintTx: MetaTransaction = {
        to: nft,
        value: 0n,
        data: createCallData(
            getFunctionSelector('mint(address)'),
            ['address'],
            [smartAccount.accountAddress],
        ),
    }

    let userOp = await smartAccount.createUserOperation(
        [mintTx], nodeUrl, bundlerUrl,
    )

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp hash   :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx            :', receipt.receipt.transactionHash)
    console.log('Success       :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add signer/customSigner.ts
git commit -m "docs(signer): add customSigner hub example

Pattern for HSM / MPC / hardware-wallet signers. Viem is the runnable
stand-in for the cryptography; replace with your device SDK in prod."
```

---

## Task 7: Hub - `signer/README.md`

**Files:**
- Create: `signer/README.md`

- [ ] **Step 1: Write the README**

```markdown
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
interface ExternalSigner {
  address: `0x${string}`
  signHash?(hash: `0x${string}`): Promise<`0x${string}`>
  signTypedData?(data: TypedData): Promise<`0x${string}`>
}
```

At least one of `signHash` / `signTypedData` is required. The discriminated
union rejects `{ address }` with neither method at compile time.

## Calling it

```ts
// Safe accounts (multi-signer array)
userOp.signature = await safe.signUserOperationWithSigners(userOp, [signer], chainId)

// Simple7702 / Calibur (single signer)
userOp.signature = await account.signUserOperationWithSigner(userOp, signer, chainId)

// SafeMultiChainSigAccountV1 (multi-op - one signature covers all chains)
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
```

- [ ] **Step 2: Commit**

```bash
git add signer/README.md
git commit -m "docs(signer): add signer/ hub README

Landing page for the 5 adapter examples. Names the 'pick one' rule for
viem/ethers so readers don't think they need both."
```

---

## Task 8: Account starter - `sponsor-gas/sponsor-gas-external-signer.ts`

**Files:**
- Create: `sponsor-gas/sponsor-gas-external-signer.ts`

- [ ] **Step 1: Write the file**

```ts
/**
 * Sponsor gas on SafeAccountV0_3_0 (EntryPoint v0.7) with an
 * ExternalSigner.
 *
 * - Account class : SafeAccountV0_3_0
 * - Signing method: signUserOperationWithSigners(op, [signer], chainId)
 * - Signer adapter: fromViem  (swap to fromEthersWallet if your project
 *                              uses ethers; see signer/ hub for all
 *                              adapters)
 * - Paymaster     : Erc7677Paymaster (provider-agnostic)
 */

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    getFunctionSelector,
    createCallData,
    fromViem,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // External signer. No private key is passed into abstractionkit.
    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    console.log('Signer  :', signer.address)

    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe    :', smartAccount.accountAddress)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintTx: MetaTransaction = {
        to: nft,
        value: 0n,
        data: createCallData(
            getFunctionSelector('mint(address)'),
            ['address'],
            [smartAccount.accountAddress],
        ),
    }

    let userOp = await smartAccount.createUserOperation(
        [mintTx], nodeUrl, bundlerUrl,
    )

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp  :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx      :', receipt.receipt.transactionHash)
    console.log('Success :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add sponsor-gas/sponsor-gas-external-signer.ts
git commit -m "docs(signer): add sponsor-gas external signer starter

SafeAccountV0_3_0 + fromViem + Erc7677Paymaster in the natural sponsor-gas
folder. One viem LocalAccount in, one call to signUserOperationWithSigners."
```

---

## Task 9: Account starter - `eip-7702/simple-account/06-external-signer.ts`

**Files:**
- Create: `eip-7702/simple-account/06-external-signer.ts`

- [ ] **Step 1: Write the file**

```ts
/**
 * Sponsor gas on Simple7702Account (EntryPoint v0.8) with an
 * ExternalSigner.
 *
 * - Account class : Simple7702Account
 * - Signing method: signUserOperationWithSigner(op, signer, chainId)
 * - Signer adapter: fromViem
 * - Paymaster     : Erc7677Paymaster
 *
 * Note on the two signatures in this file:
 *   - EIP-7702 delegation authorization  : signed with the raw pk via
 *     createAndSignEip7702DelegationAuthorization. This is a separate
 *     concern from UserOperation signing and is required by the 7702
 *     transaction type itself. The ExternalSigner API does NOT cover
 *     this; it signs the UserOperation hash.
 *   - UserOperation hash                 : signed via the ExternalSigner.
 */

import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    Simple7702Account,
    Erc7677Paymaster,
    createAndSignEip7702DelegationAuthorization,
    getFunctionSelector,
    createCallData,
    fromViem,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    console.log('EOA :', publicAddress)

    const smartAccount = new Simple7702Account(publicAddress)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintData = createCallData(
        getFunctionSelector('mint(address)'),
        ['address'],
        [publicAddress],
    )

    let userOp = await smartAccount.createUserOperation(
        [{ to: nft, value: 0n, data: mintData }],
        nodeUrl, bundlerUrl,
        { eip7702Auth: { chainId } },
    )

    // 1. Sign the EIP-7702 delegation authorization (separate from the
    //    UserOperation signature). This must use the raw pk.
    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            privateKey,
        )
    }

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    // 2. Sign the UserOperation hash via the ExternalSigner.
    userOp.signature = await smartAccount.signUserOperationWithSigner(
        userOp, signer, chainId,
    )

    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx     :', receipt.receipt.transactionHash)
    console.log('Success:', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add eip-7702/simple-account/06-external-signer.ts
git commit -m "docs(signer): add Simple7702 external signer starter

Simple7702Account + fromViem + Erc7677Paymaster. Calls out that the
EIP-7702 delegation authorization is a separate signature from the
UserOperation signature."
```

---

## Task 10: Account starter - `eip-7702/simple-account/07-external-signer-v09.ts`

**Files:**
- Create: `eip-7702/simple-account/07-external-signer-v09.ts`

- [ ] **Step 1: Write the file**

EntryPoint v0.9 two-phase paymaster flow is Candide-specific; `Erc7677Paymaster` doesn't support it. This file is the one exception to the "hub uses Erc7677Paymaster" rule: it uses `CandidePaymaster`.

```ts
/**
 * Sponsor gas on Simple7702AccountV09 (EntryPoint v0.9) with an
 * ExternalSigner.
 *
 * - Account class : Simple7702AccountV09
 * - Signing method: signUserOperationWithSigner(op, signer, chainId)
 * - Signer adapter: fromViem
 * - Paymaster     : CandidePaymaster (two-phase: commit -> sign -> finalize)
 *
 * Paymaster choice: EntryPoint v0.9 uses a two-phase paymaster signing
 * flow where the paymaster signature covers the owner signature. That
 * requires `signingPhase: "commit"` then `"finalize"` around the owner
 * sign step - a Candide-specific extension, not part of the generic
 * ERC-7677 standard. So we use `CandidePaymaster` here; every other
 * new example in this PR uses `Erc7677Paymaster`.
 *
 * Delegation authorization: same note as 06-external-signer.ts - signed
 * with the raw pk via createAndSignEip7702DelegationAuthorization, not
 * via the ExternalSigner.
 */

import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    Simple7702AccountV09,
    CandidePaymaster,
    createAndSignEip7702DelegationAuthorization,
    getFunctionSelector,
    createCallData,
    fromViem,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    console.log('EOA :', publicAddress)

    const smartAccount = new Simple7702AccountV09(publicAddress)
    const paymaster = new CandidePaymaster(paymasterUrl)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintData = createCallData(
        getFunctionSelector('mint(address)'),
        ['address'],
        [publicAddress],
    )

    let userOp = await smartAccount.createUserOperation(
        [{ to: nft, value: 0n, data: mintData }],
        nodeUrl, bundlerUrl,
        { eip7702Auth: { chainId } },
    )

    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            privateKey,
        )
    }

    // 1. Paymaster commit: stub data + gas estimation.
    let [commitOp] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl, sponsorshipPolicyId,
        { context: { signingPhase: 'commit' as const } },
    )
    userOp = commitOp

    // 2. Sign the UserOperation. The paymaster finalize in step 3 will
    //    see this signature in the op.
    userOp.signature = await smartAccount.signUserOperationWithSigner(
        userOp, signer, chainId,
    )

    // 3. Paymaster finalize: paymaster signature covers the signed op.
    let [finalizedOp] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl, sponsorshipPolicyId,
        { context: { signingPhase: 'finalize' as const } },
    )
    userOp = finalizedOp

    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx     :', receipt.receipt.transactionHash)
    console.log('Success:', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add eip-7702/simple-account/07-external-signer-v09.ts
git commit -m "docs(signer): add Simple7702 v0.9 external signer starter

Two-phase paymaster flow (commit + finalize) with ExternalSigner signing
between phases."
```

---

## Task 11: Account starter - `eip-7702/calibur-account/04-external-signer.ts`

**Files:**
- Create: `eip-7702/calibur-account/04-external-signer.ts`

- [ ] **Step 1: Write the file**

```ts
/**
 * Upgrade EOA to Calibur (EIP-7702) and mint an NFT with an
 * ExternalSigner.
 *
 * - Account class : Calibur7702Account
 * - Signing method: signUserOperationWithSigner(op, signer, chainId)
 * - Signer adapter: fromViem
 * - Paymaster     : Erc7677Paymaster
 *
 * Behavioral note: isDelegatedToThisAccount() checks on-chain and skips
 * the 7702 authorization if the EOA is already delegated to Calibur.
 * Re-running this example after a successful first run will not try to
 * re-delegate.
 */

import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    Calibur7702Account,
    Erc7677Paymaster,
    createAndSignEip7702DelegationAuthorization,
    getFunctionSelector,
    createCallData,
    fromViem,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    console.log('EOA :', publicAddress)

    const smartAccount = new Calibur7702Account(publicAddress)
    const alreadyDelegated = await smartAccount.isDelegatedToThisAccount(nodeUrl)
    if (alreadyDelegated) console.log('Already delegated to Calibur; skipping auth.')

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintData = createCallData(
        getFunctionSelector('mint(address)'),
        ['address'],
        [publicAddress],
    )

    let userOp = await smartAccount.createUserOperation(
        [{ to: nft, value: 0n, data: mintData }],
        nodeUrl, bundlerUrl,
        { eip7702Auth: alreadyDelegated ? undefined : { chainId } },
    )

    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            privateKey,
        )
    }

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    userOp.signature = await smartAccount.signUserOperationWithSigner(
        userOp, signer, chainId,
    )

    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx     :', receipt.receipt.transactionHash)
    console.log('Success:', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add eip-7702/calibur-account/04-external-signer.ts
git commit -m "docs(signer): add Calibur external signer starter

Calibur7702Account + fromViem + Erc7677Paymaster. Detects existing
delegation via isDelegatedToThisAccount() and skips re-auth on rerun."
```

---

## Task 12: Account starter - `chain-abstraction/add-owner-with-external-signer.ts`

**Files:**
- Create: `chain-abstraction/add-owner-with-external-signer.ts`

- [ ] **Step 1: Write the file**

```ts
/**
 * Add an owner across two chains (Sepolia + OP Sepolia) in ONE signature
 * using the multi-op ExternalSigner API on SafeMultiChainSigAccountV1.
 *
 * - Account class : SafeMultiChainSigAccountV1 (EntryPoint v0.9)
 * - Signing method: signUserOperationsWithSigners(items, [signer])
 * - Signer adapter: fromViem
 * - Paymaster     : CandidePaymaster (two-phase per chain: commit -> sign -> finalize)
 *
 * Paymaster choice: EntryPoint v0.9 uses a two-phase paymaster signing
 * flow where the paymaster signature must cover the owner signature.
 * This is a Candide-specific extension; `Erc7677Paymaster` does not
 * support EP v0.9. See 07-external-signer-v09.ts for the same note on
 * Simple7702V09.
 *
 * Key property of the multi-op signer: one call to
 * signUserOperationsWithSigners produces one signature PER op from a
 * SINGLE ECDSA operation (Merkle root). The user (or HSM) is prompted
 * once, not N times.
 */

import { loadMultiChainEnv, getOrCreateOwner } from '../utils/env'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    CandidePaymaster,
    fromViem,
} from 'abstractionkit'

async function main(): Promise<void> {
    const {
        chainId1, chainId2,
        bundlerUrl1, bundlerUrl2,
        nodeUrl1, nodeUrl2,
        paymasterUrl1, paymasterUrl2,
        sponsorshipPolicyId1, sponsorshipPolicyId2,
    } = loadMultiChainEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    const newOwner = process.env.NEW_OWNER_ADDRESS
        ?? privateKeyToAccount(generatePrivateKey()).address

    console.log('Owner     :', publicAddress)
    console.log('New owner :', newOwner)
    console.log('Chains    :', chainId1.toString(), '+', chainId2.toString())

    const smartAccount = SafeAccount.initializeNewAccount([publicAddress])
    console.log('Safe      :', smartAccount.accountAddress)

    const addOwnerTx = smartAccount.createStandardAddOwnerWithThresholdMetaTransaction(
        newOwner, 1,
    )

    const paymaster1 = new CandidePaymaster(paymasterUrl1)
    const paymaster2 = new CandidePaymaster(paymasterUrl2)
    const commitOverrides = { context: { signingPhase: 'commit' as const } }
    const finalizeOverrides = { context: { signingPhase: 'finalize' as const } }

    // 1. Create UserOperations for both chains.
    let [op1, op2] = await Promise.all([
        smartAccount.createUserOperation([addOwnerTx], nodeUrl1, bundlerUrl1),
        smartAccount.createUserOperation([addOwnerTx], nodeUrl2, bundlerUrl2),
    ])

    // 2. Paymaster commit on both chains.
    const committed = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, op1, bundlerUrl1, sponsorshipPolicyId1, commitOverrides,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, op2, bundlerUrl2, sponsorshipPolicyId2, commitOverrides,
        ),
    ])
    ;[op1, op2] = [committed[0][0], committed[1][0]]

    // 3. ★ One signing call, N signatures out. Merkle root means one
    //     ECDSA operation authorizes both ops.
    const signatures = await smartAccount.signUserOperationsWithSigners(
        [
            { userOperation: op1, chainId: chainId1 },
            { userOperation: op2, chainId: chainId2 },
        ],
        [signer],
    )
    op1.signature = signatures[0]
    op2.signature = signatures[1]
    console.log('One signing op produced', signatures.length, 'signatures.')

    // 4. Paymaster finalize on both chains.
    const finalized = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, op1, bundlerUrl1, sponsorshipPolicyId1, finalizeOverrides,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, op2, bundlerUrl2, sponsorshipPolicyId2, finalizeOverrides,
        ),
    ])
    ;[op1, op2] = [finalized[0][0], finalized[1][0]]

    // 5. Send to both chains concurrently.
    const [resp1, resp2] = await Promise.all([
        smartAccount.sendUserOperation(op1, bundlerUrl1),
        smartAccount.sendUserOperation(op2, bundlerUrl2),
    ])
    console.log('Chain 1 UserOp:', resp1.userOperationHash)
    console.log('Chain 2 UserOp:', resp2.userOperationHash)

    const [r1, r2] = await Promise.all([resp1.included(), resp2.included()])
    if (!r1 || !r2) throw new Error('timeout waiting for inclusion')
    console.log('Chain 1 Tx    :', r1.receipt.transactionHash, '| success:', r1.success)
    console.log('Chain 2 Tx    :', r2.receipt.transactionHash, '| success:', r2.success)
    if (!r1.success || !r2.success) throw new Error('at least one chain reverted')

    const [owners1, owners2] = await Promise.all([
        smartAccount.getOwners(nodeUrl1),
        smartAccount.getOwners(nodeUrl2),
    ])
    console.log('Chain 1 owners:', owners1)
    console.log('Chain 2 owners:', owners2)
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add chain-abstraction/add-owner-with-external-signer.ts
git commit -m "docs(signer): add chain-abstraction external signer starter

SafeMultiChainSigAccountV1.signUserOperationsWithSigners: one ECDSA
operation produces signatures for N chains via a shared Merkle root."
```

---

## Task 13: Update root `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the current README**

Run: `grep -n "^| " README.md | head -40`
Expected: print the current "What Do You Want to Build?" table rows so we can see the exact row IDs to update / insert between.

- [ ] **Step 2: Add a new "Bring your own signer" section below the main table**

Insert a new section after the existing `| Calibur 7702 7702 passkeys | ... |` style rows. The insertion is a new `### Bring your own signer` header followed by this table:

```markdown
### Bring your own signer

| Goal | Folder | Key File |
|------|--------|----------|
| Overview + adapter matrix | `signer/` | `README.md` |
| viem LocalAccount | `signer/` | `fromViem.ts` |
| ethers Wallet | `signer/` | `fromEthersWallet.ts` |
| Raw private key | `signer/` | `fromPrivateKey.ts` |
| viem WalletClient (typed-data path) | `signer/` | `fromViemWalletClient.ts` |
| Custom (HSM / MPC / hardware) | `signer/` | `customSigner.ts` |
| Gasless transactions (external signer) | `sponsor-gas/` | `sponsor-gas-external-signer.ts` |
| EIP-7702 external signer | `eip-7702/simple-account/` | `06-external-signer.ts` |
| EIP-7702 EP v0.9 external signer | `eip-7702/simple-account/` | `07-external-signer-v09.ts` |
| Calibur 7702 external signer | `eip-7702/calibur-account/` | `04-external-signer.ts` |
| Multichain add owner (external signer) | `chain-abstraction/` | `add-owner-with-external-signer.ts` |
```

- [ ] **Step 3: Remove any existing rows that reference the deleted files**

Grep for references to the deleted files and remove the corresponding rows:

Run: `grep -n "02-upgrade-eoa-external-signer\|with-signer\|06-signer-api\|07-signer-api-v09\|04-signer-api\|erc7677-with-signer" README.md`

For each match, delete that row (the old example is gone; the new "Bring your own signer" table covers the replacement).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(signer): update README with new external signer examples

New 'Bring your own signer' row group + removes refs to deleted files."
```

---

## Task 14: Update root `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Insert a new "External Signer (v0.3.2+)" section above the "Code Pattern" section**

Find the line that starts with `## Code Pattern` and insert the following section immediately above it:

```markdown
## External Signer (v0.3.2+)

Use `signUserOperationWithSigners` (Safe, multi-signer array) or
`signUserOperationWithSigner` (Simple7702 / Calibur, single signer) with
an `ExternalSigner` to avoid passing raw private keys into the SDK.

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
At least one of `signHash` or `signTypedData` is required (compile-time
check).

Signing is async. Capability mismatches (e.g. a typed-data-only signer
against a hash-only account) throw offline with an actionable message, so
no HSM / hardware prompt fires on a trip that would fail anyway.

Canonical per-adapter examples: `signer/`. Account-specific starters:
`sponsor-gas/sponsor-gas-external-signer.ts`,
`eip-7702/*/0X-external-signer*.ts`,
`chain-abstraction/add-owner-with-external-signer.ts`.
```

- [ ] **Step 2: Update the Account Types table with an "External Signer method" column**

Find the existing Account Types table and replace it with:

```markdown
## Account Types

| Class | Use Case | EntryPoint | External Signer method |
|-------|----------|------------|------------------------|
| `SafeAccountV0_3_0` | Most examples (recommended) | v0.7 | `signUserOperationWithSigners(op, signers[], chainId)` |
| `SafeAccountV0_2_0` | Legacy/v0.6 compatibility | v0.6 | `signUserOperationWithSigners(op, signers[], chainId)` |
| `Simple7702Account` | EIP-7702 delegation | v0.8 | `signUserOperationWithSigner(op, signer, chainId)` |
| `Simple7702AccountV09` | EIP-7702 delegation (EP v0.9) | v0.9 | `signUserOperationWithSigner(op, signer, chainId)` |
| `SafeMultiChainSigAccountV1` | Chain abstraction | v0.9 | `signUserOperationsWithSigners(ops[], signers[], chainId)` |
| `Calibur7702Account` | EIP-7702 Calibur | v0.8 (default) | `signUserOperationWithSigner(op, signer, chainId)` |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(signer): add External Signer section + Account Types column to CLAUDE.md

So AI agents encounter the ExternalSigner API before the sync-pk
boilerplate in the Code Pattern section below."
```

---

## Task 15: Final typecheck + push

**Files:** (no code changes)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 2: Verify file inventory**

Run:
```bash
ls signer/
ls sponsor-gas/*external-signer*
ls eip-7702/simple-account/*external-signer*
ls eip-7702/calibur-account/*external-signer*
ls chain-abstraction/*external-signer*
```

Expected output:
```
signer/:
README.md  fromPrivateKey.ts  fromViem.ts  fromEthersWallet.ts  fromViemWalletClient.ts  customSigner.ts

sponsor-gas/sponsor-gas-external-signer.ts
eip-7702/simple-account/06-external-signer.ts
eip-7702/simple-account/07-external-signer-v09.ts
eip-7702/calibur-account/04-external-signer.ts
chain-abstraction/add-owner-with-external-signer.ts
```

- [ ] **Step 3: Push branch**

Run: `git push -u origin docs/signer-examples`
Expected: branch pushed to origin.

- [ ] **Step 4: (Do NOT open PR yet.)** Leave PR creation to the user so they can review the diff locally first.
