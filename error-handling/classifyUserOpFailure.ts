import { UserOperationReceiptResult, decodeUserOperationRevertReason, parseAaCode } from 'abstractionkit'

export type UserOpFailure = {
    category:
        | 'insufficient-account-funds' // account can't pay the prefund (AA21/AA51)
        | 'insufficient-token-funds'   // token paymaster: not enough gas token
        | 'sponsorship-denied'         // sponsor rejected / paymaster validation failed
        | 'fees-too-low'               // maxFeePerGas/maxPriorityFeePerGas below the bundler minimum
        | 'gas-limit-too-low'          // a gas limit (pre-verification/call/verification) is too low
        | 'replacement-underpriced'    // speed-up of a same-nonce op without enough fee bump
        | 'not-included'               // accepted but not bundled in time (TIMEOUT); bump & resubmit
        | 'execution-reverted'         // mined but the inner call reverted
        | 'nonce'                      // stale/invalid nonce (AA25)
        | 'signature'                  // invalid/expired signature (AA24)
        | 'unknown'
    isRetriable: boolean
    /** Short line you can show the user. */
    suggestedAction: string
    /** The EntryPoint AAxx revert code, when present (e.g. 'AA21'). */
    aaCode?: string
    /** Raw bundler/receipt detail, for logs. */
    reason: string
}

type Verdict = [UserOpFailure['category'], boolean, string]

// EntryPoint FailedOp revert codes mapped to a verdict. These AAxx codes are
// defined by the EntryPoint contract, not the bundler, so they stay the same
// across compliant bundlers even when the wording after the code changes.
const AA_CODES: Record<string, Verdict> = {
    AA21: ['insufficient-account-funds', true, 'Top up the account with ETH and retry.'],
    AA51: ['insufficient-account-funds', true, 'Prefund was below the actual gas cost. Top up the account and retry.'],
    AA25: ['nonce', true, 'Stale nonce. Rebuild the UserOperation and retry.'],
    AA24: ['signature', false, 'Invalid signature. Re-sign with the correct key.'],
    AA31: ['sponsorship-denied', false, 'Paymaster deposit too low. Use a different paymaster or pay gas yourself.'],
    AA33: ['sponsorship-denied', false, 'Paymaster validation failed. Check the paymaster or pay gas another way.'],
    AA50: ['sponsorship-denied', false, "The paymaster's postOp reverted. For a token paymaster, check the token balance and allowance; otherwise pay gas another way."],
    AA40: ['gas-limit-too-low', true, 'Verification used more gas than its limit. Re-estimate gas and retry.'],
    AA41: ['gas-limit-too-low', true, 'verificationGasLimit was too low. Re-estimate gas and retry.'],
    AA13: ['gas-limit-too-low', true, 'Account deployment failed (factory reverted or ran out of gas). Re-estimate gas and retry; if it persists, the factory rejected the inputs.'],
    AA23: ['gas-limit-too-low', true, 'Validation ran out of gas or was rejected. Re-estimate gas and retry; if it persists, re-sign the op.'],
}

// Gas fee and gas-limit failures carry no AAxx code. They arrive as -32602
// "invalid fields" (or the paymaster's -32003) with the detail only in the
// message, so match keywords. First rule wins, which is why "replacement ...
// underpriced" is matched before the generic "underpriced".
const KEYWORD_RULES: { keywords: string[]; verdict: Verdict }[] = [
    { keywords: ['replacement'], verdict: ['replacement-underpriced', true, 'Replacement fee too low. Increase maxFeePerGas/maxPriorityFeePerGas (about 12%) and retry.'] },
    { keywords: ['maxfeepergas', 'max fee per gas', 'maxpriorityfeepergas', 'max priority fee', 'fee too low', 'underpriced'], verdict: ['fees-too-low', true, 'Gas price rose above the offered fee. Refetch the gas price and retry.'] },
    { keywords: ['preverificationgas', 'callgaslimit', 'verificationgaslimit', 'gas limit too low'], verdict: ['gas-limit-too-low', true, 'A gas limit was too low. Re-estimate gas and retry.'] },
]

const hasAny = (text: string, keywords: string[]): boolean => keywords.some((k) => text.includes(k))

const REVERT_ACTION =
    'The call reverts when executed, so the op would fail on-chain. Fix the transaction; retrying as-is will not help. See the reason field for the revert message.'

/**
 * Classify why a UserOperation failed.
 *
 * Pass either the thrown error (validation stage, never mined) or a
 * UserOperationReceiptResult with success:false (execution stage).
 *
 * The classifier prefers codes over message text:
 *  - abstractionkit's error `code` (BUNDLER_ERROR vs PAYMASTER_ERROR) and inner
 *    `cause.code` (e.g. EXECUTION_REVERTED) give a robust coarse bucket.
 *  - the EntryPoint `AAxx` revert code gives the precise reason, and stays the
 *    same even if the bundler rewords the message.
 * Keyword matching is only a fallback for cases no code pins down: token vs
 * sponsor (both are the generic -32003) and the fee/gas-limit errors (generic
 * -32602). Those keywords are best-effort and tuned for Candide.
 */
export function classifyUserOpFailure(input: unknown): UserOpFailure {
    // Execution stage: a mined receipt that reverted. Decode the revert reason
    // (no extra RPC, the logs are in the receipt) so the verdict can tell a
    // retriable out-of-gas from a hard revert. Out-of-gas is a heuristic here
    // (empty revert data is usually OOG, sometimes a bare revert()), and the op
    // already mined, so the retry is a NEW op at the next nonce, not a resend.
    if (typeof input === 'object' && input !== null && 'success' in input) {
        const receipt = input as NonNullable<UserOperationReceiptResult>
        if (!receipt.success) {
            const reason = `success=false tx=${receipt.receipt.transactionHash}`
            const revert = decodeUserOperationRevertReason(receipt)
            // The decoder reports these two on EntryPoint v0.7+. The prefund is what
            // the gas limits reserved up front, so a shortfall means the limits were
            // too low, not that the account is short.
            if (revert.prefundTooLow) {
                return toFailure(['gas-limit-too-low', true,
                    'The prefund reserved by the gas limits did not cover the actual gas cost. Re-estimate gas and send a new op (this one mined, so its nonce is used).'], reason)
            }
            // A postOp that left no revert data also sets outOfGas: the paymaster's
            // postOp ran out of gas, which a higher postOp gas limit can fix.
            if (revert.postOpReverted && revert.outOfGas) {
                return toFailure(['execution-reverted', true,
                    "The paymaster's postOp ran out of gas. Check or increase paymasterPostOpGasLimit (request fresh paymaster data) and send a new op."], reason)
            }
            if (revert.postOpReverted) {
                const detail = revert.errorMessage ? `: ${revert.errorMessage}` : ''
                return toFailure(['execution-reverted', false,
                    `The paymaster's postOp reverted${detail}, so the call was undone. For a token paymaster, check the token balance and allowance.`], reason)
            }
            if (revert.outOfGas) {
                return toFailure(['execution-reverted', true,
                    'Ran out of gas during execution. Raise callGasLimit and send a new op (this one mined, so its nonce is used).'], reason)
            }
            const detail = revert.errorMessage ? `: ${revert.errorMessage}` : ''
            return toFailure(['execution-reverted', false,
                `Included on-chain but the call reverted${detail}. Fix the call; retrying as-is will not help.`], reason)
        }
    }

    // A thrown AbstractionKitError (or anything else).
    const err = input as { code?: string; aaCode?: string; cause?: { code?: unknown; message?: string }; message?: string } | undefined
    // A TIMEOUT's cause is the last failed receipt poll, not the reason, so keep
    // its own message.
    const reason = (err?.code === 'TIMEOUT' ? err.message : err?.cause?.message ?? err?.message) ?? String(input)
    const lower = reason.toLowerCase()

    // Not a failure but a TIMEOUT: the bundler accepted the op (it has a hash) but
    // did not bundle it in time, so included() throws TIMEOUT "can't find
    // useroperation". The op is stuck (often on low fees) or was dropped. Replace
    // it the way you speed up a stuck Ethereum tx: same nonce, higher fees, re-sign.
    if (err?.code === 'TIMEOUT' || lower.includes("can't find useroperation") || lower.includes('cannot find useroperation')) {
        return toFailure(['not-included', true,
            'The bundler accepted the op but did not include it in time. Keep the same nonce, bump maxFeePerGas and maxPriorityFeePerGas (about 12%), re-sign, and resubmit.'], reason)
    }

    // SDK cause.code first. It is the most reliable signal, and it disambiguates a
    // code the AAxx string alone cannot: EXECUTION_REVERTED is the pre-flight twin
    // of the success:false receipt above (for example a transfer of more than the
    // balance). Checking it before the AAxx table is what lets AA23 ("reverted or
    // OOG") resolve to execution-reverted here, or to gas-limit-too-low if it falls
    // through to the table as a validation out-of-gas.
    if (err?.cause?.code === 'EXECUTION_REVERTED') {
        return toFailure(['execution-reverted', false, REVERT_ACTION], reason)
    }
    if (err?.cause?.code === 'INVALID_SIGNATURE') {
        return toFailure(['signature', false, 'Invalid signature. Re-sign with the correct key.'], reason)
    }
    // Some providers report an execution revert in the message rather than a code,
    // e.g. a token paymaster's "validator: callData reverts" (-32003). Same meaning
    // as EXECUTION_REVERTED. Check it before the paymaster bucket so it is not
    // mistaken for a sponsorship denial.
    if (hasAny(lower, ['calldata revert', 'call data revert', 'execution revert'])) {
        return toFailure(['execution-reverted', false, REVERT_ACTION], reason)
    }

    // A token paymaster that rejects the op for the account's token balance or
    // allowance. A paymaster rejection during gas estimation is a PAYMASTER_ERROR
    // that also carries the bundler's AA3x code, so check the token wording before
    // the AAxx table maps AA33 to a denial. That error repeats the bundler's reason
    // in its own message (its cause only says the estimation call failed), so test
    // the outer message too.
    if (err?.code === 'PAYMASTER_ERROR'
        && hasAny(`${err.message ?? ''} ${lower}`.toLowerCase(), ['token', 'allowance', 'balance'])) {
        return toFailure(['insufficient-token-funds', true, 'Fund the account with more of the gas token and retry.'], reason, err.aaCode)
    }

    // EntryPoint AAxx revert code. Thrown AbstractionKitErrors carry it parsed
    // on `aaCode`; parseAaCode() covers errors from other sources.
    const aaCode = err?.aaCode ?? parseAaCode(reason)
    if (aaCode && AA_CODES[aaCode]) return toFailure(AA_CODES[aaCode], reason, aaCode)

    // Gas fee and gas-limit failures, by keyword. Can come from the bundler or the paymaster.
    for (const rule of KEYWORD_RULES) {
        if (hasAny(lower, rule.keywords)) return toFailure(rule.verdict, reason)
    }

    // Any other paymaster failure (denied policy, unsupported EntryPoint, ...).
    // Token-balance rejections were caught above.
    if (err?.code === 'PAYMASTER_ERROR') {
        return toFailure(['sponsorship-denied', false, 'Sponsorship was denied. Check the policy or pay gas another way.'], reason)
    }

    return toFailure(['unknown', false, 'Unrecognized failure. Inspect the reason field.'], reason)
}

function toFailure([category, isRetriable, suggestedAction]: Verdict, reason: string, aaCode?: string): UserOpFailure {
    return { category, isRetriable, suggestedAction, aaCode, reason }
}
