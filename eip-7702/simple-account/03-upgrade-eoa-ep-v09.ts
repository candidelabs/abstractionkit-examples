import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702AccountV09 as Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
} from "abstractionkit"

// Same as 01-upgrade-eoa.ts, but uses EntryPoint v0.9 with
// Simple7702AccountV09 and CandidePaymaster with parallel signing
// (commit/finalize flow).

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaAddress, privateKey } = getOrCreateOwner()

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Initialize smart account and build transactions
    // ──────────────────────────────────────────────────────────────────────
    const smartAccount = new Simple7702Account(eoaAddress)
    const paymaster = new CandidePaymaster(paymasterUrl)

    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintCallData = createCallData(
        getFunctionSelector('mint(address)'),
        ["address"],
        [eoaAddress],
    )
    const mintNft = { to: nftContractAddress, value: 0n, data: mintCallData }

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Create UserOperation with EIP-7702 authorization
    // ──────────────────────────────────────────────────────────────────────
    let userOperation = await smartAccount.createUserOperation(
        [mintNft, mintNft],
        nodeUrl,
        bundlerUrl,
        { eip7702Auth: { chainId } },
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 3: Sign EIP-7702 delegation authorization (if needed)
    // ──────────────────────────────────────────────────────────────────────
    if (userOperation.eip7702Auth) {
        userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            privateKey,
        )
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 4: Paymaster COMMIT (estimate gas + preliminary data)
    // ──────────────────────────────────────────────────────────────────────
    console.log("Paymaster commit: estimating gas...")

    let [commitOp] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount,
        userOperation,
        bundlerUrl,
        sponsorshipPolicyId,
        { entrypoint: smartAccount.entrypointAddress, context: { signingPhase: "commit" as const } },
    )
    userOperation = commitOp

    // ──────────────────────────────────────────────────────────────────────
    // Step 5: Sign UserOp
    // ──────────────────────────────────────────────────────────────────────
    userOperation.signature = smartAccount.signUserOperation(
        userOperation, privateKey, chainId,
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 6: Paymaster FINALIZE (get final paymasterData)
    // ──────────────────────────────────────────────────────────────────────
    console.log("Paymaster finalize: getting final paymasterData...")

    let [finalizedOp] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount,
        userOperation,
        bundlerUrl,
        sponsorshipPolicyId,
        { entrypoint: smartAccount.entrypointAddress, context: { signingPhase: "finalize" as const } },
    )
    userOperation = finalizedOp

    // ──────────────────────────────────────────────────────────────────────
    // Step 7: Send and wait for inclusion
    // ──────────────────────────────────────────────────────────────────────
    console.log("UserOperation:", userOperation)

    const response = await smartAccount.sendUserOperation(userOperation, bundlerUrl)

    console.log("UserOp sent! Waiting for inclusion...")
    console.log("UserOp hash:", response.userOperationHash)

    const receipt = await response.included()

    console.log("UserOperation receipt received.")
    console.log(receipt)
    if (receipt == null) {
        console.log("Receipt not found (timeout)")
    } else if (receipt.success) {
        console.log("Minted two NFTs with parallel signing! Tx: " + receipt.receipt.transactionHash)
    } else {
        console.log("UserOperation execution failed")
    }
}

main()
