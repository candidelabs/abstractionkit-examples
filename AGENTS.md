# AbstractionKit Examples

This file helps AI assistants (Claude Code, Cursor, Copilot, etc.) understand this repository.

## What This Repo Is

Working examples for building ERC-4337 smart wallets with AbstractionKit.
Each folder demonstrates a specific feature. All examples target **Arbitrum Sepolia**.

## Quick Start (No Signup Required)

Public endpoints for immediate development:

| Service | URL |
|---------|-----|
| Bundler | `https://api.candide.dev/public/v3/421614` |
| Paymaster | `https://api.candide.dev/public/v3/421614` |
| RPC | `https://sepolia-rollup.arbitrum.io/rpc` |
| Chain ID | `421614` |

Create `.env`:
```env
CHAIN_ID=421614
NODE_URL=https://sepolia-rollup.arbitrum.io/rpc
BUNDLER_URL=https://api.candide.dev/public/v3/421614
PAYMASTER_URL=https://api.candide.dev/public/v3/421614
PUBLIC_ADDRESS=<your-eoa-address>
PRIVATE_KEY=<your-eoa-private-key>
```

Run any example:
```bash
npm install
npx ts-node <folder>/<script>.ts
```

## What Do You Want to Build?

| Goal | Folder | Key File |
|------|--------|----------|
| Gasless transactions | `sponsor-gas/` | `sponsor-gas.ts` |
| Passkey/biometric login | `passkeys/` | `index.ts` |
| Multi-owner wallet | `multisig/` | `multisig.ts` |
| Pay gas with ERC-20 | `pay-gas-in-erc20/` | `pay-gas-in-erc20.ts` |
| Batch multiple txs | `batch-transactions/` | `batch-transactions.ts` |
| Account recovery | `recovery/` | `recovery.ts` |
| EIP-7702 delegation | `eip-7702/` | `upgrade-eoa-to-7702-smart-account.ts` |
| Debug with Tenderly | `simulate-with-tenderly/` | `simulate-with-tenderly.ts` |
| Cross-chain operations | `chain-abstraction/` | See README in folder |
| Nested Safe accounts | `nested-safe-accounts/` | `nested-safe-accounts.ts` |
| Spending limits | `spend-permission/` | `spend-permission.ts` |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CHAIN_ID` | Yes | Target chain (421614 for Arbitrum Sepolia) |
| `NODE_URL` | Yes | Chain RPC endpoint |
| `BUNDLER_URL` | Yes | ERC-4337 bundler endpoint |
| `PAYMASTER_URL` | For sponsored | Candide paymaster endpoint |
| `PUBLIC_ADDRESS` | Yes | Your EOA public address |
| `PRIVATE_KEY` | Yes | Your EOA private key (becomes account owner) |
| `SPONSORSHIP_POLICY_ID` | Optional | For custom sponsorship policies |
| `TOKEN_ADDRESS` | For ERC-20 gas | Token to pay gas with |

For production endpoints: https://dashboard.candide.dev

## Common Errors & Solutions

### "AA21 didn't pay prefund"
Account has insufficient ETH and no paymaster is sponsoring.
**Fix:** Use the `sponsor-gas/` example with the public paymaster, or fund the smart account address.

### "AA25 invalid account nonce"
Nonce mismatch - previous transaction not yet confirmed.
**Fix:** Wait for previous transaction to be included, or fetch fresh nonce.

### Gas estimation fails / "execution reverted"
The transaction would fail on-chain.
**Fix:**
- Verify the `to` address exists and is correct
- Check calldata encoding matches the target function
- Use `simulate-with-tenderly/` to debug

### "invalid signature"
Signature doesn't match expected signer(s).
**Fix:**
- For multisig: signatures must be sorted by signer address (ascending)
- Verify you're signing the correct UserOperation hash
- Check the signer is an owner of the account

### Paymaster rejects operation
**Fix:**
- Verify `PAYMASTER_URL` is correct
- Check the paymaster supports the target chain
- For token paymaster: ensure account has enough tokens

## Code Pattern

All examples follow this structure:

```typescript
import { SafeAccountV0_3_0 as SafeAccount, MetaTransaction } from "abstractionkit";

// 1. Initialize account
let smartAccount = SafeAccount.initializeNewAccount([ownerPublicAddress]);
// Or for existing: new SafeAccount(accountAddress)

// 2. Create transaction(s)
const tx: MetaTransaction = {
  to: targetAddress,
  value: 0n,
  data: callData,
};

// 3. Create UserOperation
let userOp = await smartAccount.createUserOperation(
  [tx],
  nodeUrl,
  bundlerUrl,
);

// 4. (Optional) Add paymaster for sponsorship
const paymaster = new CandidePaymaster(paymasterUrl);
[userOp] = await paymaster.createSponsorPaymasterUserOperation(userOp, bundlerUrl);

// 5. Sign
userOp.signature = smartAccount.signUserOperation(userOp, [privateKey], chainId);

// 6. Send and wait
const response = await smartAccount.sendUserOperation(userOp, bundlerUrl);
const receipt = await response.included();
```

## Account Types

| Class | Use Case | EntryPoint |
|-------|----------|------------|
| `SafeAccountV0_3_0` | Most examples (recommended) | v0.7 |
| `SafeAccountV0_2_0` | Legacy/v0.6 compatibility | v0.6 |
| `Simple7702Account` | EIP-7702 delegation | v0.8 |

## Common Commands

```bash
# Install dependencies
npm install

# Run an example
npx ts-node sponsor-gas/sponsor-gas.ts

# Build TypeScript
npm run build

# Clean build artifacts
npm run clean
```

## Source of Truth

This examples repo is the source of truth for working code.
Documentation at docs.candide.dev may occasionally lag behind.
If docs and examples differ, trust the examples.

## Links

- Library: https://github.com/candidelabs/abstractionkit
- Docs: https://docs.candide.dev
- Dashboard: https://dashboard.candide.dev
- Discord: https://discord.gg/KJSzy2Rqtg
