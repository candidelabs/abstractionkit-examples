import { loadEnv, getOrCreateOwner } from '../utils/env'
import {
    SafeAccountV0_3_0 as SafeAccount,
    MetaTransaction,
    Erc7677Paymaster,
    calculateUserOperationMaxGasCost,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";

/**
 * Sponsored (gasless) UserOperation via any ERC-7677 paymaster.
 *
 * Works with any provider that implements ERC-7677 — Candide, Pimlico,
 * Alchemy, and others. The provider is auto-detected from the paymaster
 * URL, and provider-specific optimizations are used when available.
 *
 * See ../sponsor-gas/sponsor-gas.ts for the Candide-specific variant
 * (SponsorMetadata, richer helpers).
 */

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()

    // 1. Initialize a new smart account.
    const smartAccount = SafeAccount.initializeNewAccount([ownerPublicAddress])
    console.log("Smart account:", smartAccount.accountAddress)

    // 2. Build a transaction (mint an NFT).
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const transaction: MetaTransaction = {
        to: nftContractAddress,
        value: 0n,
        data: createCallData(
            getFunctionSelector("mint(address)"),
            ["address"],
            [smartAccount.accountAddress],
        ),
    }

    // 3. Create the UserOperation.
    let userOperation = await smartAccount.createUserOperation(
        [transaction],
        nodeUrl,
        bundlerUrl,
    )

    // 4. Sponsor the UserOperation via the ERC-7677 paymaster.
    //    Candide and Pimlico read `sponsorshipPolicyId`; Alchemy reads
    //    `policyId`. We send both so this example is portable across
    //    providers — unknown keys are ignored.
    const paymaster = new Erc7677Paymaster(paymasterUrl)
    const context = sponsorshipPolicyId
        ? { sponsorshipPolicyId, policyId: sponsorshipPolicyId }
        : {}
    userOperation = await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOperation,
        bundlerUrl,
        context,
    )

    const cost = calculateUserOperationMaxGasCost(userOperation)
    console.log("This UserOperation may cost up to:", cost, "wei (sponsored by the paymaster)")

    // 5. Sign and send.
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [ownerPrivateKey],
        chainId,
    )
    const response = await smartAccount.sendUserOperation(userOperation, bundlerUrl)
    console.log("UserOperation sent. Waiting to be included...")

    const receipt = await response.included()
    if (receipt == null) {
        console.log("Receipt not found (timeout)")
    } else if (receipt.success) {
        console.log("NFT minted. Tx hash:", receipt.receipt.transactionHash)
    } else {
        console.log("UserOperation execution failed")
    }
}

main()
