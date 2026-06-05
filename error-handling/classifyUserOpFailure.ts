import { UserOperationReceiptResult } from 'abstractionkit'

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
    AA40: ['gas-limit-too-low', true, 'Verification used more gas than its limit. Re-estimate gas and retry.'],
    AA41: ['gas-limit-too-low', true, 'verificationGasLimit was too low. Re-estimate gas and retry.'],
    AA13: ['gas-limit-too-low', true, 'Account deployment ran out of gas, or the factory reverted. Re-estimate gas and retry.'],
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
    // Execution stage: a mined receipt that reverted.
    if (typeof input === 'object' && input !== null && 'success' in input) {
        const receipt = input as NonNullable<UserOperationReceiptResult>
        if (!receipt.success) {
            return toFailure(['execution-reverted', false,
                'Included on-chain but the call reverted. Use decodeUserOpRevertReason(receipt) to read why.'],
                `success=false tx=${receipt.receipt.transactionHash}`)
        }
    }

    // A thrown AbstractionKitError (or anything else).
    const err = input as { code?: string; cause?: { code?: unknown; message?: string }; message?: string } | undefined
    const reason = err?.cause?.message ?? err?.message ?? String(input)
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

    // EntryPoint AAxx revert code.
    for (const code of Object.keys(AA_CODES)) {
        if (lower.includes(code.toLowerCase())) return toFailure(AA_CODES[code], reason, code)
    }

    // Gas fee and gas-limit failures, by keyword. Can come from the bundler or the paymaster.
    for (const rule of KEYWORD_RULES) {
        if (hasAny(lower, rule.keywords)) return toFailure(rule.verdict, reason)
    }

    // Paymaster failures: token vs sponsor (both share the generic -32003).
    if (err?.code === 'PAYMASTER_ERROR') {
        if (hasAny(lower, ['token', 'allowance', 'balance'])) {
            return toFailure(['insufficient-token-funds', true, 'Fund the account with more of the gas token and retry.'], reason)
        }
        return toFailure(['sponsorship-denied', false, 'Sponsorship was denied. Check the policy or pay gas another way.'], reason)
    }

    return toFailure(['unknown', false, 'Unrecognized failure. Inspect the reason field.'], reason)
}

function toFailure([category, isRetriable, suggestedAction]: Verdict, reason: string, aaCode?: string): UserOpFailure {
    return { category, isRetriable, suggestedAction, aaCode, reason }
}
