import { UserOperationReceiptResult } from 'abstractionkit'
import { decodeAbiParameters } from 'viem'

export type UserOpRevert = {
    /** success === false on the receipt. */
    reverted: boolean
    /** The inner call left no revert data. Usually out-of-gas, though a bare
     *  revert()/assert or a call to a non-contract also produce empty data. */
    outOfGas: boolean
    /** Decoded Error("...") string, when the call reverted with a reason. */
    errorMessage?: string
    /** Decoded Panic(uint256) code (0x11 overflow, 0x12 div-by-zero, ...). */
    panicCode?: number
    /** The raw revertReason bytes (for custom errors / further decoding). */
    rawRevertReason: string
}

// EntryPoint event: UserOperationRevertReason(bytes32 userOpHash, address sender, uint256 nonce, bytes revertReason)
// topic0 verified live against the v0.9 EntryPoint (0x4337...D009) on Arbitrum, and is the same for v0.6/0.7/0.8.
const REVERT_REASON_TOPIC = '0x1c4fada7374c0a9ee8841fc38afe82932dc0f8e69012e927f061a8bae611a201'
const ERROR_SELECTOR = '0x08c379a0' // Error(string)
const PANIC_SELECTOR = '0x4e487b71' // Panic(uint256)

/** abstractionkit stores receipt logs as JSON strings; gather them as objects. */
function gatherLogs(receipt: NonNullable<UserOperationReceiptResult>): any[] {
    const out: any[] = []
    const sources: unknown[] = [receipt.logs, receipt.receipt?.logs]
    for (const src of sources) {
        if (typeof src === 'string') { try { out.push(...JSON.parse(src)) } catch { /* ignore */ } }
        else if (Array.isArray(src)) out.push(...src)
    }
    return out
}

/**
 * Work out why a UserOperation reverted on-chain, using only the receipt the
 * wallet already has. No extra RPC call, no debug_traceTransaction.
 *
 * It reads the EntryPoint's `UserOperationRevertReason` event from the logs and
 * decodes the revert data: a reason string (Error), a panic code (Panic), empty
 * data (usually out-of-gas), or raw bytes (a custom error).
 *
 * To be certain about out-of-gas rather than a bare revert(), trace the bundle
 * transaction with debug_traceTransaction or Tenderly. That is a one-off
 * debugging step, not something a wallet runs on every transaction.
 */
export function decodeUserOpRevertReason(receipt: NonNullable<UserOperationReceiptResult>): UserOpRevert {
    if (receipt.success) return { reverted: false, outOfGas: false, rawRevertReason: '0x' }

    const log = gatherLogs(receipt).find((l) => l?.topics?.[0]?.toLowerCase() === REVERT_REASON_TOPIC)
    if (!log) return { reverted: true, outOfGas: false, rawRevertReason: '0x' }

    // data = abi.encode(uint256 nonce, bytes revertReason)
    const decode = (params: { type: string }[], data: string): unknown[] =>
        decodeAbiParameters(params as any, data as `0x${string}`) as unknown as unknown[]

    const revertReasonRaw = decode([{ type: 'uint256' }, { type: 'bytes' }], log.data)[1] as string
    const revertReason = revertReasonRaw.toLowerCase()

    if (revertReason === '0x' || revertReason === '') {
        return { reverted: true, outOfGas: true, rawRevertReason: '0x' }
    }
    if (revertReason.startsWith(ERROR_SELECTOR)) {
        const msg = decode([{ type: 'string' }], '0x' + revertReason.slice(10))[0] as string
        return { reverted: true, outOfGas: false, errorMessage: msg, rawRevertReason: revertReasonRaw }
    }
    if (revertReason.startsWith(PANIC_SELECTOR)) {
        const code = decode([{ type: 'uint256' }], '0x' + revertReason.slice(10))[0] as bigint
        return { reverted: true, outOfGas: false, panicCode: Number(code), rawRevertReason: revertReasonRaw }
    }
    return { reverted: true, outOfGas: false, rawRevertReason: revertReasonRaw as string }
}
