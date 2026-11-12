import { fetchAccountNonce } from 'abstractionkit'

/**
 * Wait until the node has seen an included UserOperation, by polling the
 * account's nonce until it moves past `usedNonce`.
 *
 * Public RPCs are load-balanced, so right after inclusion the next request can
 * hit a node that is a block behind. Call this between back-to-back
 * UserOperations from the same account, or the next one can be built on a
 * stale nonce and fail with AA25.
 */
export async function waitForNonceAfter(
    nodeUrl: string,
    account: { entrypointAddress: string; accountAddress: string },
    usedNonce: bigint,
): Promise<void> {
    const key = usedNonce >> 64n // a 4337 nonce is (key << 64) | sequence
    for (let attempt = 0; attempt < 10; attempt++) {
        const nonce = await fetchAccountNonce(nodeUrl, account.entrypointAddress, account.accountAddress, key)
        if (nonce > usedNonce) return
        await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    throw new Error(`Account nonce did not advance past ${usedNonce}.`)
}
