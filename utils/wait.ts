import { fetchAccountNonce } from 'abstractionkit'

/**
 * Re-read on-chain state until it shows what a just-included operation wrote.
 *
 * Public RPCs are load-balanced: right after a UserOperation is included, the
 * next request can land on a node that is still a block behind, so a read can
 * return the old state (or throw, e.g. "account not deployed yet"). Retrying a
 * few times rides that out. For back-to-back UserOperations, use
 * waitForNonceAfter below so the next one isn't built on a stale nonce (AA25).
 *
 * Returns the last value read, so the caller can still report it if the state
 * never matches. Rethrows the last error if every read threw.
 */
export async function waitForState<T>(
    read: () => Promise<T>,
    isDone: (value: T) => boolean,
    { attempts = 10, delayMs = 2000 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
    let lastError: unknown
    let hasValue = false
    let value!: T
    for (let i = 0; i < attempts; i++) {
        try {
            value = await read()
            hasValue = true
            if (isDone(value)) return value
        } catch (err) {
            lastError = err
        }
        if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    if (!hasValue) throw lastError
    return value
}

/**
 * Wait until the node reports an account nonce past `usedNonce`, i.e. it has seen
 * the block that included the UserOperation sent with that nonce. Call this
 * between back-to-back UserOperations from the same account: otherwise the next
 * one can be built on a stale nonce from a lagging node and fail with AA25.
 */
export async function waitForNonceAfter(
    nodeUrl: string,
    entryPoint: string,
    sender: string,
    usedNonce: bigint,
): Promise<bigint> {
    // A 4337 nonce is (key << 64) | sequence; read the sequence for the same key.
    const key = usedNonce >> 64n
    const nonce = await waitForState(
        () => fetchAccountNonce(nodeUrl, entryPoint, sender, key), (current) => current > usedNonce,
    )
    // Building the next UserOperation on a stale nonce would only fail later with
    // AA25, so stop here with a clear error instead.
    if (nonce <= usedNonce) {
        throw new Error(`Account nonce did not advance past ${usedNonce} (node still reports ${nonce}).`)
    }
    return nonce
}
