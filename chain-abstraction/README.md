# Chain Abstraction Examples

These examples demonstrate chain abstraction using **Safe Unified Account**: **sign once, execute on many chains**.

> **Note**: Safe Unified Account is exported as `SafeMultiChainSigAccount` in abstractionkit.
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

All examples use `AllowAllPaymaster` for gas sponsorship, so you don't need to fund accounts with native tokens to run them. Note that the paymaster implementation will be upgraded in the future to allow the use of gas policies, similar to what is already in production at candide's instagas.

## Key Code Pattern

```typescript
// Safe Unified Account (exported as SafeMultiChainSigAccount)
import { SafeMultiChainSigAccount as SafeAccount } from "abstractionkit";

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
