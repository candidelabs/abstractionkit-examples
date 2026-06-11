# Error handling

When a UserOperation fails, a wallet needs to know why so it can react: top up the
account, bump the gas, re-sign, or just tell the user it didn't go through.

Two helpers do the work:

- `classifyUserOpFailure(errorOrReceipt)` (in this folder) turns a failure into an
  actionable verdict: `{ category, isRetriable, suggestedAction, aaCode?, reason }`.
- `decodeUserOperationRevertReason(receipt)` (exported by abstractionkit since
  0.4.0) reads the on-chain revert reason out of a mined-but-failed receipt.

Each of the five scripts triggers one real failure on a live testnet and runs it
through the classifier.

## Where a UserOp fails

A UserOp fails in one of two places, and they surface differently:

- **Before it is mined (validation).** The bundler simulates the op and rejects
  it, so there is no receipt. abstractionkit throws an `AbstractionKitError`, with
  the bundler's reason (for example `AA21 didn't pay prefund`) on its `.cause`.
- **After it is mined (execution).** The op was included but its inner call
  reverted. You read it from the receipt: `success === false`.

`classifyUserOpFailure` takes either shape and returns one verdict.

## The examples

```bash
npx ts-node error-handling/<script>.ts
```

| # | Script | How gas is paid | What fails |
|---|--------|-----------------|------------|
| 1 | `1-no-paymaster-underfunded.ts` | Self-funded | Account has no ETH for the prefund (`AA21`) |
| 2 | `2-token-insufficient.ts` | Token paymaster | Account's gas-token balance is below the required amount (`validator: token balance lower than the required … allowance`) — none or just not enough |
| 3 | `3-sponsor-denied.ts` | Sponsor paymaster | Sponsorship policy rejects the op |
| 4 | `4-included-reverted.ts` | Self-funded | Op is mined, then the inner call reverts |
| 5 | `5-gas-too-low-retry.ts` | Self-funded | Op is underpriced, then retried until it succeeds |

Examples 1 to 3 cost nothing: leave `PUBLIC_ADDRESS` and `PRIVATE_KEY` out of
`.env` and each run uses a throwaway zero-balance key, which is what triggers the
failure. Example 3 forces a denial with a fake policy id, so it works out of the box.

Examples 4 and 5 need the sender to hold a little testnet ETH, because reaching the
execution stage means paying for gas yourself. Fund the address the script prints,
then run it. Example 5 is the full loop: send underpriced, get a retriable
`fees-too-low`, rebuild with current gas, resend, and succeed.

## Calling it

```ts
try {
  const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
  const receipt = await response.included()

  if (receipt && !receipt.success) {
    // Mined, but the call reverted.
    const failure = classifyUserOpFailure(receipt)           // { category: 'execution-reverted', ... }
    const revert = decodeUserOperationRevertReason(receipt)  // { outOfGas, errorMessage, ... }
  }
} catch (err) {
  // Rejected before inclusion.
  const failure = classifyUserOpFailure(err)
  if (failure.isRetriable) {
    // bump or refetch gas and resend, following failure.suggestedAction
  }
}
```

## Categories

`category` is one of:

- `insufficient-account-funds`: the account can't cover the prefund (`AA21`/`AA51`)
- `insufficient-token-funds`: token paymaster, not enough of the gas token
- `sponsorship-denied`: the sponsor rejected the op
- `fees-too-low`: gas price moved above what the op offered
- `gas-limit-too-low`: a gas limit was set too low
- `replacement-underpriced`: a speed-up did not bump the fee enough
- `not-included`: the bundler accepted the op but never bundled it
- `execution-reverted`: mined, but the inner call reverted
- `nonce`, `signature`: stale nonce, bad signature
- `unknown`: nothing matched, so read `reason`

`isRetriable` says whether retrying can help; `suggestedAction` is a short line you
can show the user.

The classifier trusts codes before wording, because codes are stable and messages
are not: the error `code` (`BUNDLER_ERROR` vs `PAYMASTER_ERROR`) and `cause.code`
first, then the EntryPoint `AAxx` code, and only then keyword matching for the two
cases no code pins down (token vs sponsor, both `-32003`; fee and gas-limit errors,
`-32602`). Since abstractionkit 0.4.0 the `AAxx` code arrives pre-parsed on a thrown
`AbstractionKitError` as `err.aaCode`, with the exported `parseAaCode(message)` as a
fallback for errors from other sources. Those keyword strings are tuned for Candide,
so swap them for another provider.

## Out-of-gas vs revert

A `success: false` receipt does not say whether the call ran out of gas or reverted
on purpose. abstractionkit's `decodeUserOperationRevertReason` reads the EntryPoint's
`UserOperationRevertReason` log from the receipt you already have, with no extra RPC
call, matches the receipt's `userOpHash` (so multi-op bundles return the right
entry), and returns the reason: a string for `revert("...")`, a panic code for
`assert`, or empty data, which usually means out-of-gas (so it reports
`outOfGas: true`). For certainty about out-of-gas, trace the bundle transaction with
`debug_traceTransaction` or Tenderly, which is a one-off debugging step rather than
a per-transaction call.

One thing to remember: an execution revert already mined, so its nonce is spent.
Retrying means a new op at the next nonce, not a same-nonce replacement.
