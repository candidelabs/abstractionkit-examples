# Chain Abstraction Examples

These examples demonstrate chain abstraction using **Safe Unified Account**: **sign once, execute on many chains**.

> **Note**: Safe Unified Account is exported as `SafeMultiChainSigAccountV1` in abstractionkit.
> Learn more: https://docs.candide.dev/account-abstraction/research/safe-unified-account

## The Problem

When managing Smart Accounts across multiple chains, users traditionally need to:
- Sign separate transactions for each chain
- Pay gas on each chain
- Risk inconsistent states if some transactions fail

**Traditional Approach: N chains = N signatures**

```
Chain 1: Sign → Submit → Wait
Chain 2: Sign → Submit → Wait
Chain 3: Sign → Submit → Wait
...
```

## The Solution

Safe Unified Account enables signing a single message that authorizes the same operation across multiple chains.

**Safe Unified Account: N chains = 1 signature**

```
All Chains: Sign Once → Submit to All → Wait
```

## Examples

### 1. Add Owner (`add-owner.ts`)

Add a new owner to your Safe across all chains with ONE signature.

**Use Case**: Adding a team member or backup key. You want the same owner added everywhere with guaranteed consistency.

```bash
npx ts-node chain-abstraction/add-owner.ts
```

### 2. Add Guardian (`add-guardian.ts`)

Add a recovery guardian to your Safe accounts on multiple chains with ONE signature.

**Use Case**: Recovery setup must be consistent across chains. A guardian should be able to recover your account on ALL chains, not just some.

```bash
npx ts-node chain-abstraction/add-guardian.ts
```

### 3. Add Owner - Wallet Signed (`add-owner-eip712-signed.ts`)

Same as add-owner but uses EIP-712 typed data signing instead of passing private keys directly.

**Use Case**: Browser wallet integrations (MetaMask, WalletConnect), hardware wallets (Ledger, Trezor), or any scenario where you don't have direct access to the private key.

```bash
npx ts-node chain-abstraction/add-owner-eip712-signed.ts
```

**Key difference**: Uses `getMultiChainSingleSignatureUserOperationsEip712Data()` to get typed data, then signs with viem's `walletClient.signTypedData()`.

### 4. Add Owner - Passkey Signed (`add-owner-passkey.ts`)

Same as add-owner but uses a passkey (WebAuthn) for signing.

**Use Case**: Secure, phishing-resistant authentication using device biometrics (Face ID, Touch ID, Windows Hello) for cross-chain account management.

```bash
npx ts-node chain-abstraction/add-owner-passkey.ts
```

**Key difference**: Uses `getMultiChainSingleSignatureUserOperationsEip712Hash()` to get the hash, signs with WebAuthn, then formats with `formatSignaturesToUseroperationsSignatures()`.

## Configuration

Copy `.env.example` to `.env` and configure the required variables. See the root `.env.example` for all available options.

Required environment variables:
- `CHAIN_ID1`, `CHAIN_ID2` - Target chain IDs
- `BUNDLER_URL1`, `BUNDLER_URL2` - Bundler RPC endpoints
- `NODE_URL1`, `NODE_URL2` - Node RPC endpoints

Optional (auto-generated if not provided):
- `PRIVATE_KEY`, `PUBLIC_ADDRESS` - Owner keys
- `NEW_OWNER_ADDRESS` - For add-owner.ts
- `GUARDIAN_ADDRESS` - For add-guardian.ts

## How It Works

1. **Deterministic Address**: Safe Unified Account uses `c2Nonce` to generate the same account address across all chains.

2. **Concurrent UserOperation Creation**: UserOperations are created for each chain in parallel.

3. **Single Signature**: The `signUserOperations()` method takes an array of UserOperations with their chain IDs and returns signatures for all of them from a single signing operation.

4. **Concurrent Submission**: All signed UserOperations are submitted to their respective bundlers in parallel.

## Gas Sponsorship

All examples use `CandidePaymaster` with the commit/finalize parallel signing protocol for gas sponsorship. Set `PAYMASTER_URL1` and `PAYMASTER_URL2` in your `.env` (defaults to `https://api.candide.dev/public/v3/{chainId}`).

## Key Code Pattern

```typescript
// Safe Unified Account (exported as SafeMultiChainSigAccountV1)
import { SafeMultiChainSigAccountV1 as SafeAccount } from "abstractionkit";

// Create UserOperations concurrently
const [userOp1, userOp2] = await Promise.all([
    smartAccount.createUserOperation(txs, nodeUrl1, bundlerUrl1, opts1),
    smartAccount.createUserOperation(txs, nodeUrl2, bundlerUrl2, opts2),
]);

// ONE signature for ALL chains
const signatures = smartAccount.signUserOperations(
    [
        { userOperation: userOp1, chainId: chainId1 },
        { userOperation: userOp2, chainId: chainId2 }
    ],
    [ownerPrivateKey],
);

// Apply signatures and submit concurrently
userOp1.signature = signatures[0];
userOp2.signature = signatures[1];
await Promise.all([
    smartAccount.sendUserOperation(userOp1, bundlerUrl1),
    smartAccount.sendUserOperation(userOp2, bundlerUrl2),
]);
```

## Wallet-Signed Pattern (EIP-712)

For browser wallets or hardware wallets, use the EIP-712 typed data approach:

```typescript
import { createWalletClient, http } from 'viem'

// Get EIP-712 typed data (instead of signing with private key)
const eip712Data = SafeAccount.getMultiChainSingleSignatureUserOperationsEip712Data([
    { userOperation: userOp1, chainId: chainId1 },
    { userOperation: userOp2, chainId: chainId2 }
]);

// Sign with wallet (triggers popup in browser)
const signature = await walletClient.signTypedData({
    domain: eip712Data.domain,
    types: eip712Data.types,
    primaryType: 'MerkleTreeRoot',
    message: eip712Data.messageValue
});

// Format single signature into per-UserOperation signatures.
// Per-op overrides (e.g. isInit, safe4337ModuleAddress) live on each entry.
const signatures = SafeAccount.formatSignaturesToUseroperationsSignatures(
    [
        { userOperation: userOp1, chainId: chainId1 },
        { userOperation: userOp2, chainId: chainId2 },
    ],
    [{ signer: ownerAddress, signature }]
);
```
