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

If using chain-abstraction examples
```env
BUNDLER_URL1=https://api.candide.dev/public/v3/11155111
BUNDLER_URL2=https://api.candide.dev/public/v3/11155420
NODE_URL1=https://ethereum-sepolia-rpc.publicnode.com
NODE_URL2=https://sepolia.optimism.io
CHAIN_ID1=11155111
CHAIN_ID2=11155420
SPONSORSHIP_POLICY_ID1=
SPONSORSHIP_POLICY_ID2=
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
| Gasless — any ERC-7677 provider | `erc7677/` | `sponsor-gas.ts` |
| Passkey/biometric login | `passkeys/` | `index.ts` |
| Multi-owner wallet | `multisig/` | `multisig.ts` |
| Pay gas with ERC-20 | `pay-gas-in-erc20/` | `pay-gas-in-erc20.ts` |
| Pay gas with ERC-20 — any ERC-7677 provider | `erc7677/` | `pay-gas-in-erc20.ts` |
| Batch multiple txs | `batch-transactions/` | `batch-transactions.ts` |
| Account recovery | `recovery/` | `recovery.ts` |
| EIP-7702 delegation | `eip-7702/simple-account/` | `01-upgrade-eoa.ts` |
| EIP-7702 external signer | `eip-7702/simple-account/` | `02-upgrade-eoa-external-signer.ts` |
| EIP-7702 pay gas in ERC-20 | `eip-7702/simple-account/` | `03-upgrade-eoa-erc20-gas.ts` |
| EIP-7702 EP v0.9 | `eip-7702/simple-account/` | `04-upgrade-eoa-ep-v09.ts` |
| EIP-7702 revoke delegation | `eip-7702/simple-account/` | `05-revoke-delegation.ts` |
| Debug with Tenderly | `simulate-with-tenderly/` | `simulate-with-tenderly.ts` |
| Multichain-chain add owner | `chain-abstraction/` | `add-owner.ts` |
| Multichain add guardian | `chain-abstraction/` | `add-guardian.ts` |
| Multichain add owner (Eip-712 Wallet Signed) | `chain-abstraction/` | `add-owner-eip712-signed.ts` |
| Multichain add owner (Passkey) | `chain-abstraction/` | `add-owner-passkey.ts` |
| EIP-712 signed UserOp | `eip-712-signing/` | `eip-712-signing.ts` |
| Nested Safe accounts | `nested-safe-accounts/` | `nested-safe-accounts.ts` |
| Spending limits | `spend-permission/` | `spend-permission.ts` |
| Calibur 7702 upgrade EOA + gas sponsorship | `eip-7702/calibur-account/` | `01-upgrade-eoa.ts` |
| Calibur 7702 passkeys | `eip-7702/calibur-account/` | `02-passkeys.ts` |
| Calibur 7702 key management | `eip-7702/calibur-account/` | `03-manage-keys.ts` |

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
| `SPONSORSHIP_POLICY_ID1` | For chain-abstraction | Sponsorship policy for chain 1 |
| `SPONSORSHIP_POLICY_ID2` | For chain-abstraction | Sponsorship policy for chain 2 |
| `BUNDLER_URL1` | For chain-abstraction | ERC-4337 bundler endpoint |
| `BUNDLER_URL2` | For chain-abstraction | ERC-4337 bundler endpoint |
| `NODE_URL1` | For chain-abstraction | Chain 1 RPC endpoint |
| `NODE_URL2` | For chain-abstraction | Chain 2 RPC endpoint |
| `CHAIN_ID1` | For chain-abstraction | Target chain 1 (11155111 for Sepolia) |
| `CHAIN_ID2` | For chain-abstraction | Target chain 2 (11155420 for OP Sepolia) |


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
import { SafeAccountV0_3_0 as SafeAccount, MetaTransaction, CandidePaymaster } from "abstractionkit";

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
[userOp] = await paymaster.createSponsorPaymasterUserOperation(smartAccount, userOp, bundlerUrl);

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
| `SafeMultiChainSigAccountV1` | Chain abstraction (Safe Unified Account) | v0.9 |
| `Calibur7702Account` | EIP-7702 Calibur (passkeys, key mgmt) | v0.8 (default) |

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
