Add this feature to the smart wallet: $ARGUMENTS

## Step 1: Find the Closest Example

| Feature | Start From |
|---------|------------|
| Gasless/sponsored tx | `sponsor-gas/sponsor-gas.ts` |
| Passkey authentication | `passkeys/index.ts` |
| Multi-owner wallet | `multisig/multisig.ts` |
| Pay gas with tokens | `pay-gas-in-erc20/pay-gas-in-erc20.ts` |
| Multiple actions in one tx | `batch-transactions/batch-transactions.ts` |
| Account recovery | `recovery/recovery.ts` |
| EIP-7702 EOA upgrade | `eip-7702/upgrade-eoa-to-7702-smart-account.ts` |
| Cross-chain operations | `chain-abstraction/` |

## Step 2: Follow the Standard Pattern

```typescript
import * as dotenv from 'dotenv';
import { SafeAccountV0_3_0 as SafeAccount, MetaTransaction, CandidePaymaster } from "abstractionkit";

async function main(): Promise<void> {
  dotenv.config();

  const chainId = BigInt(process.env.CHAIN_ID as string);
  const bundlerUrl = process.env.BUNDLER_URL as string;
  const nodeUrl = process.env.NODE_URL as string;
  const paymasterUrl = process.env.PAYMASTER_URL as string;
  const ownerAddress = process.env.PUBLIC_ADDRESS as string;
  const ownerPrivateKey = process.env.PRIVATE_KEY as string;

  // 1. Initialize account
  const smartAccount = SafeAccount.initializeNewAccount([ownerAddress]);
  console.log("Account address: " + smartAccount.accountAddress);

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

  // 4. Add paymaster for gas sponsorship
  const paymaster = new CandidePaymaster(paymasterUrl);
  [userOp] = await paymaster.createSponsorPaymasterUserOperation(userOp, bundlerUrl);

  // 5. Sign
  userOp.signature = smartAccount.signUserOperation(userOp, [ownerPrivateKey], chainId);

  // 6. Send and wait
  const response = await smartAccount.sendUserOperation(userOp, bundlerUrl);
  console.log("UserOperation sent. Waiting...");

  const receipt = await response.included();
  if (receipt.success) {
    console.log("Success! Tx hash: " + receipt.receipt.transactionHash);
    console.log("View on explorer: https://sepolia.arbiscan.io/tx/" + receipt.receipt.transactionHash);
  } else {
    console.log("UserOperation failed");
  }
}

main();
```

## Step 3: Building Calldata

For contract interactions, use `createCallData`:

```typescript
import { getFunctionSelector, createCallData } from "abstractionkit";

// Example: ERC-20 transfer
const selector = getFunctionSelector('transfer(address,uint256)');
const callData = createCallData(selector, ["address", "uint256"], [recipient, amount]);

const tx: MetaTransaction = {
  to: tokenContractAddress,
  value: 0n,
  data: callData,
};
```

## Step 4: Common Pitfalls to Avoid

1. **Calldata encoding:** Double-check function selector and parameter types match the ABI exactly

2. **Token operations:** Verify the account has sufficient balance BEFORE creating the UserOperation

3. **Gas estimation issues:** If gas estimation fails, add multipliers:
   ```typescript
   await smartAccount.createUserOperation([tx], nodeUrl, bundlerUrl, {
     verificationGasLimitPercentageMultiplier: 130,
     callGasLimitPercentageMultiplier: 130,
   });
   ```

4. **Passkeys:** WebAuthn `rpId` must match between credential creation and signing

5. **Existing accounts:** Use `new SafeAccount(address)` instead of `initializeNewAccount()`

## Public Endpoints (No Signup)

```env
CHAIN_ID=421614
NODE_URL=https://sepolia-rollup.arbitrum.io/rpc
BUNDLER_URL=https://api.candide.dev/public/v3/421614
PAYMASTER_URL=https://api.candide.dev/public/v3/421614
```
