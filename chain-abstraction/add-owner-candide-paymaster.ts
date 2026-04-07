/**
 * Add Owner Across Chains — Parallel Signing with CandidePaymaster
 *
 * Same multi-chain add-owner flow as add-owner.ts, but uses CandidePaymaster
 * with the commit/finalize parallel signing protocol:
 *
 * 1. Create UserOperations for both chains
 * 2. COMMIT: paymaster estimates gas + returns preliminary data (both chains)
 * 3. Sign for ALL chains with ONE Merkle-tree signature
 * 4. FINALIZE: paymaster returns final paymasterData (both chains)
 * 5. Submit to both chains
 *
 * Steps 3 and 4 can run in parallel with an async signer (hardware wallet,
 * passkey, multisig), saving the finalize round-trip latency.
 */

import { loadMultiChainEnv, getOrCreateOwner } from '../utils/env'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    CandidePaymaster,
    UserOperationV9,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId1, chainId2, bundlerUrl1, bundlerUrl2, nodeUrl1, nodeUrl2, paymasterUrl1, paymasterUrl2 } = loadMultiChainEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()

    const newOwnerAccount = privateKeyToAccount(generatePrivateKey())
    const newOwnerAddress = process.env.NEW_OWNER_ADDRESS || newOwnerAccount.address

    console.log("=".repeat(60))
    console.log("ADD OWNER — PARALLEL SIGNING WITH CANDIDE PAYMASTER")
    console.log("=".repeat(60))
    console.log("\nOriginal owner:", ownerPublicAddress)
    console.log("New owner to add:", newOwnerAddress)

    const smartAccount = SafeAccount.initializeNewAccount([ownerPublicAddress])

    console.log("\nSafe Account (same on both chains):", smartAccount.accountAddress)
    console.log("\nTarget chains:")
    console.log("  - Chain 1:", chainId1.toString())
    console.log("  - Chain 2:", chainId2.toString())

    const addOwnerTx = smartAccount.createStandardAddOwnerWithThresholdMetaTransaction(
        newOwnerAddress, 1
    );

    const paymaster1 = new CandidePaymaster(paymasterUrl1)
    const paymaster2 = new CandidePaymaster(paymasterUrl2)

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Create UserOperations for both chains (parallel)
    // ──────────────────────────────────────────────────────────────────────
    console.log("\n[1/5] Creating UserOperations for both chains...")

    let [userOperation1, userOperation2] = await Promise.all([
        smartAccount.createUserOperation(
            [addOwnerTx], nodeUrl1, bundlerUrl1,
        ),
        smartAccount.createUserOperation(
            [addOwnerTx], nodeUrl2, bundlerUrl2,
        ),
    ]);

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Paymaster COMMIT — estimate gas + preliminary data (parallel)
    // ──────────────────────────────────────────────────────────────────────
    // Both paymasters estimate gas and return preliminary paymasterData.
    // After this, gas limits are final on both chains.
    console.log("[2/5] Paymaster commit on both chains...")

    const commitOverrides = { preVerificationGasPercentageMultiplier: 120, context: { signingPhase: "commit" as const } };
    const [[commitOp1], [commitOp2]] = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, userOperation1, bundlerUrl1,
            undefined,
            commitOverrides,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, userOperation2, bundlerUrl2,
            undefined,
            commitOverrides,
        ),
    ])
    userOperation1 = commitOp1
    userOperation2 = commitOp2

    // ──────────────────────────────────────────────────────────────────────
    // Step 3: Sign for BOTH chains with ONE signature
    // ──────────────────────────────────────────────────────────────────────
    // Gas limits are final. Multi-chain signing generates a Merkle tree
    // over both UserOp hashes and signs the root — one signature, N chains.
    console.log("[3/5] Signing for both chains...")

    const signatures = smartAccount.signUserOperations(
        [
            { userOperation: userOperation1, chainId: chainId1 },
            { userOperation: userOperation2, chainId: chainId2 },
        ],
        [ownerPrivateKey],
    )
    userOperation1.signature = signatures[0]
    userOperation2.signature = signatures[1]

    // ──────────────────────────────────────────────────────────────────────
    // Step 4: Paymaster FINALIZE — get final paymasterData (parallel)
    // ──────────────────────────────────────────────────────────────────────
    // Finalize skips gas re-estimation — just gets the final on-chain
    // paymaster signature. The user signatures are preserved.
    // With an async signer, this step can overlap with step 3.
    console.log("[4/5] Paymaster finalize on both chains...")

    const finalizeOverrides = { context: { signingPhase: "finalize" as const } };
    const [[finalOp1], [finalOp2]] = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, userOperation1, bundlerUrl1,
            undefined,
            finalizeOverrides,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, userOperation2, bundlerUrl2,
            undefined,
            finalizeOverrides,
        ),
    ])
    userOperation1 = finalOp1
    userOperation2 = finalOp2

    // ──────────────────────────────────────────────────────────────────────
    // Step 5: Submit to both chains (parallel)
    // ──────────────────────────────────────────────────────────────────────
    console.log("[5/5] Submitting to both chains...")

    await Promise.all([
        sendAndMonitor(userOperation1, bundlerUrl1, "Chain 1"),
        sendAndMonitor(userOperation2, bundlerUrl2, "Chain 2"),
    ])

    // Verify
    console.log("\nVerifying owners on both chains...")
    const [owners1, owners2] = await Promise.all([
        smartAccount.getOwners(nodeUrl1),
        smartAccount.getOwners(nodeUrl2),
    ])

    console.log("\n" + "=".repeat(60))
    console.log("VERIFICATION COMPLETE")
    console.log("=".repeat(60))
    console.log("\nOwners on Chain 1:", owners1)
    console.log("Owners on Chain 2:", owners2)

    const success =
        owners1.map(o => o.toLowerCase()).includes(newOwnerAddress.toLowerCase()) &&
        owners2.map(o => o.toLowerCase()).includes(newOwnerAddress.toLowerCase())

    if (success) {
        console.log("\nNew owner added on BOTH chains with parallel CandidePaymaster signing!")
    }
}

async function sendAndMonitor(
    userOperation: UserOperationV9,
    bundlerUrl: string,
    chainName: string,
): Promise<void> {
    const account = new SafeAccount(userOperation.sender);
    const response = await account.sendUserOperation(userOperation, bundlerUrl)

    console.log(`  [${chainName}] UserOp sent. Waiting for inclusion...`)
    const receipt = await response.included()

    if (receipt == null) {
        console.log(`  [${chainName}] Receipt not found (timeout)`)
    } else if (receipt.success) {
        console.log(`  [${chainName}] Success! Tx: ${receipt.receipt.transactionHash}`)
    } else {
        console.log(`  [${chainName}] Execution failed`)
    }
}

main().catch(console.error)
