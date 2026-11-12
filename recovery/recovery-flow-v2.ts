/**
 * Social Recovery Module v0.2.0: Full Recovery Flow
 *
 * This example walks through a complete account recovery on module v0.2.0:
 *   1. Create a Safe, enable the recovery module and add a guardian (threshold 1)
 *   2. The guardian signs the recovery to a new owner (EIP-712, off-chain)
 *   3. A relayer submits the signed confirmation and starts the grace period
 *   4. Once the grace period is over, the relayer finalizes the recovery
 *
 * Nobody needs testnet ETH: the guardian only signs, and the relayer is a
 * fresh Safe whose UserOperations are sponsored by the paymaster.
 * multiConfirmRecovery and finalizeRecovery are permissionless, so any
 * account can submit them.
 *
 * The 3-minute grace period module is deployed on testnets only. Use
 * After3Days, After7Days or After14Days in production.
 *
 * Accounts that enabled the v0.1.0 module must use SocialRecoveryModuleV1.
 * v0.2.0 guardian signatures and confirmations are bound to a recovery nonce.
 */

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { waitForNonceAfter, waitForState } from '../utils/wait'
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    Erc7677Paymaster,
    MetaTransaction,
    SocialRecoveryModuleV2,
    SocialRecoveryModuleGracePeriodSelectorV2,
    EXECUTE_RECOVERY_PRIMARY_TYPE,
} from "abstractionkit";
import { createPublicClient, http, TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    const publicClient = createPublicClient({ transport: http(nodeUrl) })

    // Signs, sponsors and sends a UserOperation, then waits for inclusion.
    async function sendSponsoredUserOperation(
        account: SafeAccount,
        transactions: MetaTransaction[],
        signerPrivateKey: string,
    ): Promise<void> {
        let userOperation = await account.createUserOperation(transactions, nodeUrl, bundlerUrl)
        const { userOperation: sponsoredUserOperation } = await paymaster.createPaymasterUserOperation(
            account, userOperation, bundlerUrl, sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined)
        userOperation = sponsoredUserOperation
        userOperation.signature = account.signUserOperation(userOperation, [signerPrivateKey], chainId)

        const response = await account.sendUserOperation(userOperation, bundlerUrl)
        console.log("  Useroperation sent. Waiting to be included ......")
        const receipt = await response.included()
        if (receipt == null) {
            throw new Error("Receipt not found (timeout)")
        }
        if (!receipt.success) {
            throw new Error("Useroperation execution failed. Tx: " + receipt.receipt.transactionHash)
        }
        console.log("  Included. The transaction hash is : " + receipt.receipt.transactionHash)
        // The public RPC is load-balanced: wait until it has seen this block, so
        // the reads and UserOperations that follow are built on fresh state.
        await waitForNonceAfter(nodeUrl, account.entrypointAddress, account.accountAddress, userOperation.nonce)
    }

    // The guardian is a plain EOA. It only signs, so it needs no funds.
    const guardian = privateKeyToAccount(generatePrivateKey())
    // The owner the account will be recovered to (e.g. the user's new device key).
    const newOwner = privateKeyToAccount(generatePrivateKey())
    // The relayer submits the guardian's signature on-chain. Here it is a
    // fresh sponsored Safe; in production this is usually your backend.
    const relayerOwnerPrivateKey = generatePrivateKey()
    const relayerAccount = SafeAccount.initializeNewAccount(
        [privateKeyToAccount(relayerOwnerPrivateKey).address],
        { c2Nonce: BigInt(Date.now()) },
    )

    // Social Recovery Module v0.2.0 with a 3-minute grace period (testnets only).
    const srm = new SocialRecoveryModuleV2(SocialRecoveryModuleGracePeriodSelectorV2.After3Minutes)

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Create the Safe, enable the module and add a guardian
    // ──────────────────────────────────────────────────────────────────────
    const smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
        { c2Nonce: BigInt(Date.now()) },
    )
    const accountAddress = smartAccount.accountAddress

    console.log("Account address(sender) : " + accountAddress)
    console.log("Guardian                : " + guardian.address)
    console.log("New owner               : " + newOwner.address)
    console.log("Relayer account         : " + relayerAccount.accountAddress)

    console.log("\n[1/4] Deploying the account, enabling the recovery module and adding the guardian...")
    // Deployment, enableModule and addGuardianWithThreshold are batched in one UserOperation.
    await sendSponsoredUserOperation(smartAccount, [
        srm.createEnableModuleMetaTransaction(accountAddress),
        srm.createAddGuardianWithThresholdMetaTransaction(guardian.address, 1n),
    ], ownerPrivateKey)

    const isGuardian = await waitForState(
        () => srm.isGuardian(nodeUrl, accountAddress, guardian.address), (added) => added,
    )
    console.log("  Guardian added : " + isGuardian)

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: The guardian signs the recovery, a relayer submits it
    // ──────────────────────────────────────────────────────────────────────
    // The owner key is now considered lost. The guardian approves replacing
    // the owners with [newOwner] and a threshold of 1.
    console.log("\n[2/4] Guardian signs the recovery request (EIP-712)...")
    const newOwners = [newOwner.address]
    const newThreshold = 1

    // getRecoveryRequestEip712Data reads the account's current recovery nonce
    // from the module. v0.2.0 binds the signature to that nonce: any guardian
    // change or cancelRecovery bumps it and invalidates collected signatures.
    const { domain, types, messageValue } = await srm.getRecoveryRequestEip712Data(
        nodeUrl,
        chainId,
        accountAddress,
        newOwners,
        BigInt(newThreshold),
    )
    const recoveryNonce = messageValue.nonce
    console.log("  Recovery nonce : " + recoveryNonce)

    const guardianSignature = await guardian.signTypedData({
        domain,
        types,
        primaryType: EXECUTE_RECOVERY_PRIMARY_TYPE,
        message: messageValue,
    } as unknown as TypedDataDefinition)

    // multiConfirmRecovery checks the guardian signatures, and with
    // execute = true starts the recovery since the threshold (1) is reached.
    // The nonce passed must be the one the guardian signed.
    console.log("  Relayer submits the signed confirmation and starts the recovery...")
    const confirmRecoveryTx = srm.createMultiConfirmRecoveryMetaTransaction(
        accountAddress,
        newOwners,
        newThreshold,
        recoveryNonce,
        [{ signer: guardian.address, signature: guardianSignature }],
        true, // execute: start the grace period now
    )
    // The relayer Safe is deployed by this first UserOperation.
    await sendSponsoredUserOperation(relayerAccount, [confirmRecoveryTx], relayerOwnerPrivateKey)

    // ──────────────────────────────────────────────────────────────────────
    // Step 3: Read the pending recovery request
    // ──────────────────────────────────────────────────────────────────────
    console.log("\n[3/4] Reading the recovery request...")
    const recoveryRequest = await waitForState(
        () => srm.getRecoveryRequest(nodeUrl, accountAddress),
        (request) => request.executableAt > 0n,
    )
    // Without a pending request there is no grace period to wait out, and
    // finalizing now would fail, so stop here.
    if (recoveryRequest.executableAt === 0n) {
        throw new Error("The node still reports no pending recovery request for " + accountAddress)
    }
    console.log("  Approvals      : " + recoveryRequest.guardiansApprovalCount)
    console.log("  New owners     : " + recoveryRequest.newOwners.join(", "))
    console.log("  New threshold  : " + recoveryRequest.newThreshold)
    console.log("  Nonce          : " + recoveryRequest.nonce)
    console.log("  Executable at  : " + recoveryRequest.executableAt +
        " (" + new Date(Number(recoveryRequest.executableAt) * 1000).toISOString() + ")")

    // During the grace period the current owner can still cancel the
    // recovery with srm.createCancelRecoveryMetaTransaction().

    // ──────────────────────────────────────────────────────────────────────
    // Step 4: Wait out the grace period, then finalize
    // ──────────────────────────────────────────────────────────────────────
    console.log("\n[4/4] Waiting for the grace period to end...")
    while (true) {
        const { timestamp } = await publicClient.getBlock()
        if (timestamp >= recoveryRequest.executableAt) break
        console.log("  " + (recoveryRequest.executableAt - timestamp) + "s remaining")
        await new Promise((resolve) => setTimeout(resolve, 15_000))
    }

    // finalizeRecovery is callable by anyone, so the relayer sends it too.
    console.log("  Grace period over. Relayer finalizes the recovery...")
    await sendSponsoredUserOperation(
        relayerAccount,
        [srm.createFinalizeRecoveryMetaTransaction(accountAddress)],
        relayerOwnerPrivateKey,
    )

    const owners = await waitForState(
        () => smartAccount.getOwners(nodeUrl),
        (current) => current.length === 1 && current[0].toLowerCase() === newOwner.address.toLowerCase(),
    )
    console.log("  Account owners : " + owners.join(", "))
    if (owners.length === 1 && owners[0].toLowerCase() === newOwner.address.toLowerCase()) {
        console.log("\nRecovery complete. The account is now controlled by the new owner.")
    } else {
        console.log("\nRecovery finalized, but the owners do not match the expected new owner.")
    }
}

main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
})
