import { requireEnv, getOrCreateOwner } from '../../utils/env'
import { Simple7702Account } from "abstractionkit"
import { createPublicClient, http, formatEther } from "viem"

// Revokes an EIP-7702 delegation by setting the EOA's code to address(0).
// This is a regular Ethereum transaction (not a UserOperation), so the
// EOA needs native tokens to pay for gas.

async function main(): Promise<void> {
    const nodeUrl = requireEnv('NODE_URL')
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()

    const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress)
    const client = createPublicClient({ transport: http(nodeUrl) })

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Check if the EOA is currently delegated
    // ──────────────────────────────────────────────────────────────────────
    const isDelegated = await smartAccount.isDelegatedToThisAccount(nodeUrl)

    if (!isDelegated) {
        console.log("EOA " + eoaDelegatorPublicAddress + " is not currently delegated. Nothing to revoke.")
        return
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Verify the EOA has native tokens for gas
    // ──────────────────────────────────────────────────────────────────────
    const balance = await client.getBalance({ address: eoaDelegatorPublicAddress as `0x${string}` })

    // Note: a small non-zero balance may still be insufficient for gas.
    if (balance === 0n) {
        console.log("EOA " + eoaDelegatorPublicAddress + " has no native token balance to pay for gas.")
        console.log("Fund the EOA before revoking delegation.")
        return
    }

    console.log("EOA " + eoaDelegatorPublicAddress + " is delegated. Balance: " + formatEther(balance) + " ETH")
    console.log("Revoking delegation...")

    // ──────────────────────────────────────────────────────────────────────
    // Step 3: Create and send revocation transaction
    // ──────────────────────────────────────────────────────────────────────
    // This delegates to address(0), removing the smart account code from the EOA.
    const signedTransaction = await smartAccount.createRevokeDelegationTransaction(
        eoaDelegatorPrivateKey,
        nodeUrl,
    )

    const txHash = await client.request({
        method: 'eth_sendRawTransaction',
        params: [signedTransaction as `0x${string}`],
    })

    console.log("Revocation transaction sent! Hash:", txHash)
    console.log("Waiting for confirmation...")

    // ──────────────────────────────────────────────────────────────────────
    // Step 4: Wait for receipt and confirm revocation
    // ──────────────────────────────────────────────────────────────────────
    const receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` })

    if (receipt.status === 'success') {
        const stillDelegated = await smartAccount.isDelegatedToThisAccount(nodeUrl)
        if (!stillDelegated) {
            console.log("Delegation revoked! EOA is back to a regular account.")
        } else {
            console.log("Transaction succeeded but EOA is still delegated.")
        }
        console.log("Transaction hash:", receipt.transactionHash)
    } else {
        console.log("Revocation transaction failed.")
    }
}

main()
