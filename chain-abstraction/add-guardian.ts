/**
 * Add Guardian Across Chains - Sign Once, Execute Everywhere
 *
 * This example demonstrates adding a recovery guardian to Safe accounts
 * on multiple chains with a SINGLE signature using Safe Unified Account.
 *
 * Use Case: Setting up consistent recovery across all chains.
 * A guardian should be able to recover your account on ALL chains, not just some.
 * Single signature ensures the same guardian is set up everywhere atomically.
 *
 * Traditional approach: N chains = N signatures (risk of inconsistent setup)
 * Safe Unified Account: N chains = 1 signature (guaranteed consistency)
 *
 * Learn more: https://docs.candide.dev/account-abstraction/research/safe-unified-account
 */

import { loadMultiChainEnv, getOrCreateOwner } from '../utils/env'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    CandidePaymaster,
    type CandidePaymasterContext,
    SocialRecoveryModule,
    SocialRecoveryModuleGracePeriodSelector,
    UserOperationV9,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId1, chainId2, bundlerUrl1, bundlerUrl2, nodeUrl1, nodeUrl2, paymasterUrl1, paymasterUrl2, sponsorshipPolicyId1, sponsorshipPolicyId2 } = loadMultiChainEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()

    // Generate guardian address (or use from env)
    const guardianAddress = process.env.GUARDIAN_ADDRESS || privateKeyToAccount(generatePrivateKey()).address

    console.log("=".repeat(60))
    console.log("ADD GUARDIAN ACROSS CHAINS - SINGLE SIGNATURE DEMO")
    console.log("=".repeat(60))
    console.log("\nOwner:", ownerPublicAddress)
    console.log("Guardian to add:", guardianAddress)

    // Initialize SafeMultiChainSigAccountV1 for deterministic address across chains
    const smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
    )

    console.log("\nSafe Account (same on both chains):", smartAccount.accountAddress)
    console.log("\nTarget chains:")
    console.log("  - Chain 1:", chainId1.toString())
    console.log("  - Chain 2:", chainId2.toString())

    const gracePeriod3Minutes = SocialRecoveryModuleGracePeriodSelector.After3Minutes;
    const srm = new SocialRecoveryModule(gracePeriod3Minutes)

    console.log("\n[1/6] Creating guardian setup transactions...")

    const enableModuleTx = srm.createEnableModuleMetaTransaction(
        smartAccount.accountAddress
    )
    const addGuardianTx = srm.createAddGuardianWithThresholdMetaTransaction(
        guardianAddress,
        1n
    )

    const transactions = [enableModuleTx, addGuardianTx]

    // Set up CandidePaymaster for gas sponsorship on both chains
    const paymaster1 = new CandidePaymaster(paymasterUrl1)
    const paymaster2 = new CandidePaymaster(paymasterUrl2)

    console.log("[2/6] Creating UserOperations for both chains...")

    let [userOperation1, userOperation2] = await Promise.all([
        smartAccount.createUserOperation(
            transactions, nodeUrl1, bundlerUrl1,
        ),
        smartAccount.createUserOperation(
            transactions, nodeUrl2, bundlerUrl2,
        ),
    ]);

    console.log("[3/6] Paymaster commit on both chains...")

    const commitContext: CandidePaymasterContext = { signingPhase: "commit" };
    const [{ userOperation: commitOp1 }, { userOperation: commitOp2 }] = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, userOperation1, bundlerUrl1, sponsorshipPolicyId1, commitContext,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, userOperation2, bundlerUrl2, sponsorshipPolicyId2, commitContext,
        ),
    ])
    userOperation1 = commitOp1
    userOperation2 = commitOp2

    console.log("[4/6] Signing operations for BOTH chains with ONE signature...")

    const signatures = smartAccount.signUserOperations(
        [
            { userOperation: userOperation1, chainId: chainId1 },
            { userOperation: userOperation2, chainId: chainId2 }
        ],
        [ownerPrivateKey],
    )
    userOperation1.signature = signatures[0]
    userOperation2.signature = signatures[1]

    console.log("  Single signing operation generated", signatures.length, "signatures!")

    console.log("[5/6] Paymaster finalize on both chains...")

    const finalizeContext: CandidePaymasterContext = { signingPhase: "finalize" };
    const [{ userOperation: finalOp1 }, { userOperation: finalOp2 }] = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, userOperation1, bundlerUrl1, sponsorshipPolicyId1, finalizeContext,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, userOperation2, bundlerUrl2, sponsorshipPolicyId2, finalizeContext,
        ),
    ])
    userOperation1 = finalOp1
    userOperation2 = finalOp2

    console.log("[6/6] Submitting to bundlers on both chains...")

    await Promise.all([
        sendAndMonitorUserOperation(userOperation1, bundlerUrl1, "Chain 1"),
        sendAndMonitorUserOperation(userOperation2, bundlerUrl2, "Chain 2"),
    ]);

    // Verify guardian was added on both chains
    console.log("\nVerifying guardian on both chains...")

    const [isGuardian1, isGuardian2] = await Promise.all([
        srm.isGuardian(nodeUrl1, smartAccount.accountAddress, guardianAddress),
        srm.isGuardian(nodeUrl2, smartAccount.accountAddress, guardianAddress)
    ]);

    console.log("\n" + "=".repeat(60))
    console.log("VERIFICATION COMPLETE")
    console.log("=".repeat(60))
    console.log("\nGuardian status on Chain 1:", isGuardian1 ? "ACTIVE" : "NOT SET")
    console.log("Guardian status on Chain 2:", isGuardian2 ? "ACTIVE" : "NOT SET")

    if (isGuardian1 && isGuardian2) {
        console.log("\nGuardian successfully added on BOTH chains with ONE signature!")
        console.log("Your recovery setup is now consistent across all chains.")
    }
}

async function sendAndMonitorUserOperation(
    userOperation: UserOperationV9,
    bundlerUrl: string,
    chainName: string
): Promise<void> {
    const smartAccount = new SafeAccount(userOperation.sender);
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    )

    console.log(`  [${chainName}] UserOperation sent. Waiting for inclusion...`)
    const receipt = await sendUserOperationResponse.included()

    if (receipt == null) {
        console.log(`  [${chainName}] Receipt not found (timeout)`)
    } else if (receipt.success) {
        console.log(`  [${chainName}] Success! Tx: ${receipt.receipt.transactionHash}`)
    } else {
        console.log(`  [${chainName}] Execution failed`)
    }
}

main().catch(console.error)
