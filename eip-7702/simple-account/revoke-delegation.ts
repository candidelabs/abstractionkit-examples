import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { Simple7702Account } from "abstractionkit";
import { createPublicClient, http } from "viem";

async function main(): Promise<void> {
    const { nodeUrl } = loadEnv()
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()

    const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress);

    // Check if the EOA is currently delegated
    const isDelegated = await smartAccount.isDelegatedToThisAccount(nodeUrl);

    if (!isDelegated) {
        console.log("EOA " + eoaDelegatorPublicAddress + " is not currently delegated to Simple7702Account. Nothing to revoke.");
        return;
    }

    console.log("EOA " + eoaDelegatorPublicAddress + " is delegated. Revoking delegation...");

    // Create and sign a revocation transaction (delegates to address zero)
    const signedTransaction = await smartAccount.createRevokeDelegationTransaction(
        eoaDelegatorPrivateKey,
        nodeUrl,
    );

    // Send the raw transaction
    const client = createPublicClient({ transport: http(nodeUrl) });
    const txHash = await client.request({
        method: 'eth_sendRawTransaction',
        params: [signedTransaction as `0x${string}`],
    });

    console.log("Revocation transaction sent! Hash:", txHash);
    console.log("Waiting for confirmation...");

    const receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

    if (receipt.status === 'success') {
        // Confirm revocation
        const stillDelegated = await smartAccount.isDelegatedToThisAccount(nodeUrl);
        if (!stillDelegated) {
            console.log("Delegation successfully revoked! EOA is back to a regular account.");
        } else {
            console.log("Transaction succeeded but EOA is still delegated. This may indicate an issue.");
        }
        console.log("Transaction hash:", receipt.transactionHash);
    } else {
        console.log("Revocation transaction failed.");
    }
}

main()
