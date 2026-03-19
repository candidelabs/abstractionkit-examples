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

import * as dotenv from 'dotenv'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
    ExperimentalSafeMultiChainSigAccount as SafeAccount,
    ExperimentalAllowAllParallelPaymaster,
    SocialRecoveryModule,
    SocialRecoveryModuleGracePeriodSelector,
    UserOperationV9,
} from "abstractionkit";

async function main(): Promise<void> {
    dotenv.config()

    // Chain configuration - set in .env (see .env.example)
    const chainId1 = BigInt(process.env.CHAIN_ID1 as string)
    const chainId2 = BigInt(process.env.CHAIN_ID2 as string)
    const bundlerUrl1 = process.env.BUNDLER_URL1 as string
    const bundlerUrl2 = process.env.BUNDLER_URL2 as string
    const nodeUrl1 = process.env.NODE_URL1 as string
    const nodeUrl2 = process.env.NODE_URL2 as string

    // Auto-generate keys if not provided (zero-setup for quick testing)
    const ownerPrivateKey = (process.env.PRIVATE_KEY || generatePrivateKey()) as `0x${string}`
    const ownerAccount = privateKeyToAccount(ownerPrivateKey)
    const ownerPublicAddress = process.env.PUBLIC_ADDRESS || ownerAccount.address

    // Generate guardian address (or use from env)
    const guardianAddress = process.env.GUARDIAN_ADDRESS || privateKeyToAccount(generatePrivateKey()).address

    console.log("=".repeat(60))
    console.log("ADD GUARDIAN ACROSS CHAINS - SINGLE SIGNATURE DEMO")
    console.log("=".repeat(60))
    console.log("\nOwner:", ownerPublicAddress)
    console.log("Guardian to add:", guardianAddress)

    // Initialize ExperimentalSafeMultiChainSigAccount with c2Nonce for deterministic address
    const smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
    )

    console.log("\nSafe Account (same on both chains):", smartAccount.accountAddress)
    console.log("\nTarget chains:")
    console.log("  - Chain 1:", chainId1.toString())
    console.log("  - Chain 2:", chainId2.toString())

    // Create SocialRecoveryModule instance
    const gracePeriod3Minutes = SocialRecoveryModuleGracePeriodSelector.After3Minutes;
    const srm = new SocialRecoveryModule(gracePeriod3Minutes)

    // Create transactions to enable module and add guardian
    // These are the same for both chains
    console.log("\n[1/4] Creating guardian setup transactions...")

    const enableModuleTx = srm.createEnableModuleMetaTransaction(
        smartAccount.accountAddress
    )
    const addGuardianTx = srm.createAddGuardianWithThresholdMetaTransaction(
        guardianAddress,
        1n // Recovery threshold: 1 guardian needed to recover
    )

    // Transactions to execute on each chain
    const transactions = [enableModuleTx, addGuardianTx]

    // Set up ExperimentalAllowAllParallelPaymaster for gas sponsorship
    const paymaster = new ExperimentalAllowAllParallelPaymaster();

    // Fetch paymaster init values concurrently
    const [paymasterInitFields1, paymasterInitFields2] = await Promise.all([
        paymaster.getPaymasterFieldsInitValues(chainId1),
        paymaster.getPaymasterFieldsInitValues(chainId2),
    ]);

    // Create UserOperations for both chains concurrently
    console.log("[2/4] Creating UserOperations for both chains...")

    const [userOperation1, userOperation2] = await Promise.all([
        smartAccount.createUserOperation(
            transactions,
            nodeUrl1,
            bundlerUrl1,
            {
                parallelPaymasterInitValues: paymasterInitFields1,
                preVerificationGasPercentageMultiplier: 120,
            }
        ),
        smartAccount.createUserOperation(
            transactions,
            nodeUrl2,
            bundlerUrl2,
            {
                parallelPaymasterInitValues: paymasterInitFields2,
                preVerificationGasPercentageMultiplier: 120,
            }
        ),
    ]);

    // KEY VALUE PROPOSITION: Single signature for ALL chains!
    console.log("[3/4] Signing operations for BOTH chains with ONE signature...")

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

    // Apply signatures and paymaster data
    userOperation1.signature = signatures[0];
    userOperation2.signature = signatures[1];
    userOperation1.paymasterData = paymasterData1;
    userOperation2.paymasterData = paymasterData2;

    console.log("  Single signing operation generated", signatures.length, "signatures!")

    // Submit to bundlers concurrently
    console.log("[4/4] Submitting to bundlers on both chains...")

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
