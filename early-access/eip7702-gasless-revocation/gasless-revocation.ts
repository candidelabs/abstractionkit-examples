import { requireEnv, getOrCreateOwner } from '../../utils/env'
import {
    createAndSignEip7702DelegationAuthorization,
    sendJsonRpcRequest,
    ZeroAddress,
} from "abstractionkit"

// EARLY ACCESS: the gasless revocation API isn't publicly released yet and may change before it is.
//
// Revokes an EOA's EIP-7702 delegation without the EOA paying gas. The EOA signs
// an authorization to the zero address, and the relayer wraps it in a type-4
// transaction that it sends and pays for.
//
// Delegate the EOA first, e.g. with eip-7702/simple-account/01-upgrade-eoa.ts or
// eip-7702/calibur-account/01-upgrade-eoa.ts, using the same PRIVATE_KEY.
//
// Compare with eip-7702/simple-account/04-revoke-delegation.ts, where the EOA
// sends the revocation itself and needs native tokens for gas.

interface DelegationStatusResult {
    delegationHash: string
    status: 'queued' | 'submitted' | 'confirmed' | 'failed' | 'skipped'
    reason: string | null
    txHash: string | null
    blockNumber: string | null
    totalCost: string | null
    error: { code: string; message: string | null } | null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main(): Promise<void> {
    const chainId = BigInt(requireEnv('CHAIN_ID'))
    const nodeUrl = requireEnv('NODE_URL')
    const relayerUrl = requireEnv('RELAYER_URL')
    const headers = { Authorization: `Bearer ${requireEnv('RELAYER_API_KEY')}` }
    // The EOA you delegated with the upgrade example: same PUBLIC_ADDRESS and PRIVATE_KEY in .env
    const { publicAddress: eoaAddress, privateKey } = getOrCreateOwner()

    const getCode = async () =>
        await sendJsonRpcRequest(nodeUrl, 'eth_getCode', [eoaAddress, 'latest']) as string

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Check the EOA is delegated
    // ──────────────────────────────────────────────────────────────────────
    // A delegated EOA's code is 0xef0100 followed by the delegate's address.
    const codeBefore = await getCode()
    if (!codeBefore.startsWith('0xef0100')) {
        console.log("EOA " + eoaAddress + " is not delegated. Nothing to revoke.")
        console.log("Delegate it first, e.g. npx ts-node eip-7702/simple-account/01-upgrade-eoa.ts")
        return
    }
    console.log("EOA " + eoaAddress + " is delegated to 0x" + codeBefore.slice(8))

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Sign the revocation (an authorization to the zero address)
    // ──────────────────────────────────────────────────────────────────────
    // Sign for this chainId (never 0) at the EOA's current nonce.
    const nonce = BigInt(await sendJsonRpcRequest(
        nodeUrl, 'eth_getTransactionCount', [eoaAddress, 'pending'],
    ) as string)

    // Wallets that don't expose the private key pass a signer callback instead:
    //   await createAndSignEip7702DelegationAuthorization(chainId, ZeroAddress, nonce,
    //       async (hash) => mySigner.signHash(hash))
    const authorization = createAndSignEip7702DelegationAuthorization(
        chainId, ZeroAddress, nonce, privateKey,
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 3: Send it to the relayer
    // ──────────────────────────────────────────────────────────────────────
    const { delegationHash, status, reason } = await sendJsonRpcRequest(
        relayerUrl, 'relayer_revokeDelegation', [authorization], headers,
    ) as unknown as DelegationStatusResult
    console.log("Revocation sent. delegationHash:", delegationHash, "status:", status)

    if (status === 'skipped') {
        // NONCE_MISMATCH: the nonce read above was stale; run the example again.
        console.log("Skipped:", reason)
        return
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 4: Poll until the relayer confirms or fails it
    // ──────────────────────────────────────────────────────────────────────
    // Status moves queued → submitted → confirmed | failed. "confirmed" means the
    // relayer checked the mined block: the nonce was used and the EOA's code is empty.
    let result: DelegationStatusResult
    do {
        await sleep(2000)
        result = await sendJsonRpcRequest(
            relayerUrl, 'relayer_getStatus', [delegationHash], headers,
        ) as unknown as DelegationStatusResult
        console.log("Status:", result.status)
    } while (result.status === 'queued' || result.status === 'submitted')

    if (result.status !== 'confirmed') {
        console.log("Revocation " + result.status + ":", result.error?.code ?? result.reason, result.error?.message ?? '')
        return
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 5: Check the delegation is gone
    // ──────────────────────────────────────────────────────────────────────
    // Public RPCs are load-balanced and can lag a block behind the relayer.
    let codeAfter = await getCode()
    for (let i = 0; i < 10 && codeAfter !== '0x'; i++) {
        await sleep(2000)
        codeAfter = await getCode()
    }

    console.log("\nDelegation revoked: the EOA is a plain account again (code " + codeAfter + ").")
    console.log("Transaction:", result.txHash, "in block", BigInt(result.blockNumber!).toString())
    console.log("Gas paid by the relayer:", BigInt(result.totalCost ?? '0x0').toString(), "wei")
}

main().catch((error) => {
    // JSON-RPC errors from the relayer, e.g. -32001 unauthorized, -32003 chain not supported,
    // -32005 signature does not recover
    console.error(error)
    process.exit(1)
})
