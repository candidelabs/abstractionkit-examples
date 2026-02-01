Debug this AbstractionKit error or UserOperation failure: $ARGUMENTS

## Investigation Steps

1. **Identify the error type:**
   - AA error (AA21, AA25, etc.) → Account abstraction validation issue
   - Bundler error (-32500, -32501, etc.) → Bundler rejected the operation
   - "execution reverted" → Transaction would fail on-chain

2. **Check common causes by error:**

   **AA21 didn't pay prefund:**
   - Account has no ETH and no paymaster
   - Fix: Add paymaster using `CandidePaymaster.createSponsorPaymasterUserOperation()`

   **AA25 invalid account nonce:**
   - Previous transaction still pending
   - Fix: Wait for confirmation or fetch fresh nonce with `fetchAccountNonce()`

   **AA10 sender already constructed:**
   - Sending initCode for already-deployed account
   - Fix: Use `new SafeAccount(address)` instead of `initializeNewAccount()`

   **Invalid signature:**
   - AbstractionKit handles signer ordering automatically, so this is usually NOT an ordering issue
   - For passkeys: Check WebAuthn API parameters - this is the most common cause
     - Verify `rpId` matches what was used during credential creation
     - Check `challenge` is the correct UserOperation hash
     - Ensure `userVerification` requirement matches
   - For EOA: Verify the signer is actually an owner of the account
   - Rare: Could be a bug in abstractionkit's signature handling

   **Execution reverted:**
   - Most common cause: **Calldata encoding is wrong**
   - Check the function selector matches the target function
   - Verify parameter types and order match the ABI
   - **Check blockchain state:** Does the account have sufficient balance for the operation?
     - For ERC-20 transfers: account needs enough tokens
     - For ETH transfers: account needs enough ETH
   - Verify the target contract address is correct

3. **Gas estimation failures:**
   - Bundlers sometimes return incorrect gas estimates
   - Fix: Use overrides to multiply gas limits:
     ```typescript
     await smartAccount.createUserOperation([tx], nodeUrl, bundlerUrl, {
       verificationGasLimitPercentageMultiplier: 130, // +30%
       callGasLimitPercentageMultiplier: 130,
     })
     ```
   - If a specific gas field is mentioned in the error, increase that one
   - For undeployed accounts, ensure `initializeNewAccount()` was used

4. **Paymaster rejects sponsorship:**
   - **Most common:** Gas policy not configured correctly on dashboard.candide.dev
   - Testnet has open policies by default (no ID required)
   - If using `SPONSORSHIP_POLICY_ID`:
     - Verify the policy exists on the dashboard
     - Check the policy is funded
     - Confirm the policy allows this type of operation
   - Fix: Check gas policy settings at https://dashboard.candide.dev

5. **Token paymaster issues:**
   - Account needs enough tokens to cover BOTH:
     - Gas cost (paid in tokens)
     - The actual transfer amount (if transferring that token)
   - The simulated balance requirement is often higher than actual
   - Fix: Add a buffer to token balance, or reduce transfer amount
   - Verify TOKEN_ADDRESS is correct for the chain

## Debugging without Tenderly

Since Tenderly requires configuration and API keys, guide developers to debug manually:

1. Log the full `userOperation` object before sending
2. Check account state on block explorer (https://sepolia.arbiscan.io)
3. Verify contract exists at target address
4. Use `eth_call` to simulate the inner transaction
5. Check token balances and allowances for ERC-20 operations
