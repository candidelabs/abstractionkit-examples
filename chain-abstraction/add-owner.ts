/**
 * Add Owner Across Chains - Sign Once, Execute Everywhere
 *
 * This example demonstrates Safe Unified Account's key value proposition:
 * adding a new owner across ALL chains with a SINGLE signature.
 *
 * Use Case: Adding a team member or backup key to your Safe on all chains.
 * You want the same owner added everywhere with guaranteed consistency.
 *
 * Traditional approach: N chains = N signatures
 * Safe Unified Account: N chains = 1 signature
 *
 * Learn more: https://docs.candide.dev/account-abstraction/research/safe-unified-account
 */

import { loadMultiChainEnv, getOrCreateOwner } from '../utils/env'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
    ExperimentalSafeMultiChainSigAccount as SafeAccount,
    ExperimentalAllowAllParallelPaymaster,
    UserOperationV9,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId1, chainId2, bundlerUrl1, bundlerUrl2, nodeUrl1, nodeUrl2 } = loadMultiChainEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()

    // Generate a new owner address to add
    const newOwnerAccount = privateKeyToAccount(generatePrivateKey())
    const newOwnerAddress = process.env.NEW_OWNER_ADDRESS || newOwnerAccount.address

    console.log("=".repeat(60))
    console.log("ADD OWNER ACROSS CHAINS - SINGLE SIGNATURE DEMO")
    console.log("=".repeat(60))
    console.log("\nOriginal owner:", ownerPublicAddress)
    console.log("New owner to add:", newOwnerAddress)

    // Initialize ExperimentalSafeMultiChainSigAccount with c2Nonce for deterministic address
    const smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
    )

    console.log("\nSafe Account (same on both chains):", smartAccount.accountAddress)
    console.log("\nTarget chains:")
    console.log("  - Chain 1:", chainId1.toString())
    console.log("  - Chain 2:", chainId2.toString())

    // Create add owner transaction (threshold = 1, any single owner can sign)
    const addOwnerTx = smartAccount.createStandardAddOwnerWithThresholdMetaTransaction(
        newOwnerAddress,
        1 // threshold
    );

    // Set up ExperimentalAllowAllParallelPaymaster for gas sponsorship
    const paymaster = new ExperimentalAllowAllParallelPaymaster();

    const [paymasterInitFields1, paymasterInitFields2] = await Promise.all([
        paymaster.getPaymasterFieldsInitValues(chainId1),
        paymaster.getPaymasterFieldsInitValues(chainId2),
    ]);

    console.log("\n[1/3] Creating UserOperations for both chains...")

    const [userOperation1, userOperation2] = await Promise.all([
        smartAccount.createUserOperation(
            [addOwnerTx],
            nodeUrl1,
            bundlerUrl1,
            {
                parallelPaymasterInitValues: paymasterInitFields1,
                preVerificationGasPercentageMultiplier: 120
            }
        ),
        smartAccount.createUserOperation(
            [addOwnerTx],
            nodeUrl2,
            bundlerUrl2,
            {
                parallelPaymasterInitValues: paymasterInitFields2,
                preVerificationGasPercentageMultiplier: 120
            }
        ),
    ]);

    console.log("[2/3] Signing for BOTH chains with ONE signature...")

    const [signatures, paymasterData1, paymasterData2] = await Promise.all([
        smartAccount.signUserOperations(
            [
                { userOperation: userOperation1, chainId: chainId1 },
                { userOperation: userOperation2, chainId: chainId2 }
            ],
            [ownerPrivateKey],
        ),
        paymaster.getApprovedPaymasterData(userOperation1),
        paymaster.getApprovedPaymasterData(userOperation2)
    ]);

    userOperation1.signature = signatures[0];
    userOperation2.signature = signatures[1];
    userOperation1.paymasterData = paymasterData1;
    userOperation2.paymasterData = paymasterData2;

    console.log("  Single signing operation generated", signatures.length, "signatures!")

    console.log("[3/3] Submitting to both chains...")

    await Promise.all([
        sendAndMonitorUserOperation(userOperation1, bundlerUrl1, "Chain 1"),
        sendAndMonitorUserOperation(userOperation2, bundlerUrl2, "Chain 2"),
    ]);

    // Verify owners on both chains
    console.log("\nVerifying owners on both chains...")

    const [owners1, owners2] = await Promise.all([
        smartAccount.getOwners(nodeUrl1),
        smartAccount.getOwners(nodeUrl2)
    ]);

    console.log("\n" + "=".repeat(60))
    console.log("VERIFICATION COMPLETE")
    console.log("=".repeat(60))
    console.log("\nOwners on Chain 1:", owners1)
    console.log("Owners on Chain 2:", owners2)

    const hasNewOwner1 = owners1.map(o => o.toLowerCase()).includes(newOwnerAddress.toLowerCase())
    const hasNewOwner2 = owners2.map(o => o.toLowerCase()).includes(newOwnerAddress.toLowerCase())

    if (hasNewOwner1 && hasNewOwner2) {
        console.log("\nNew owner successfully added on BOTH chains with ONE signature!")
    }
}

async function sendAndMonitorUserOperation(
    userOperation: UserOperationV9,
    bundlerUrl: string,
    chainName: string
): Promise<void> {
    const smartAccount = new SafeAccount(userOperation.sender);
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation,
        bundlerUrl
    )

    console.log(`  [${chainName}] UserOperation sent. Waiting for inclusion...`)
    const receipt = await sendUserOperationResponse.included()

    if (receipt.success) {
        console.log(`  [${chainName}] Success! Tx: ${receipt.receipt.transactionHash}`)
    } else {
        console.log(`  [${chainName}] Execution failed`)
    }
}

main().catch(console.error)
