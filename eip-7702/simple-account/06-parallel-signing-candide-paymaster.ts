import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702AccountV09 as Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
} from "abstractionkit"

// Demonstrates parallel signing with CandidePaymaster on EntryPoint v0.9.
//
// Standard flow (sequential):
//   createUserOp → paymaster → sign → send
//
// Parallel flow with CandidePaymaster:
//   createUserOp → paymaster COMMIT (estimate gas + preliminary data)
//               → sign + paymaster FINALIZE (in parallel) → send
//
// The "commit" phase returns gas limits and preliminary paymasterData.
// Once gas limits are final, the user can sign while the paymaster
// generates its final signature ("finalize") — both concurrently.
//
// With a slow signer (hardware wallet, passkey, multisig), this saves
// the full paymaster finalize round-trip latency.

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaAddress, privateKey } = getOrCreateOwner()

    const smartAccount = new Simple7702Account(eoaAddress)
    const paymaster = new CandidePaymaster(paymasterUrl)

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Build transactions
    // ──────────────────────────────────────────────────────────────────────
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintCallData = createCallData(
        getFunctionSelector('mint(address)'),
        ["address"],
        [eoaAddress],
    )
    const mintNft = { to: nftContractAddress, value: 0n, data: mintCallData }

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Create UserOperation
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
    // Step 4: Paymaster COMMIT — estimate gas + preliminary paymasterData
    // ──────────────────────────────────────────────────────────────────────
    // After commit, gas limits are final. The paymasterData contains a
    // preliminary signature — the final one comes from the finalize step.
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
    // Gas limits are final from commit. The user signs now.
    // With an async signer (hardware wallet, passkey), this step and the
    // finalize step below can run in parallel via Promise.all.
    userOperation.signature = smartAccount.signUserOperation(
        userOperation, privateKey, chainId,
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 6: Paymaster FINALIZE — get final paymasterData
    // ──────────────────────────────────────────────────────────────────────
    // Finalize skips gas re-estimation and returns the UserOp with the
    // final on-chain paymaster signature. The user signature from step 5
    // is preserved in the returned UserOp.
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
        console.log("Minted two NFTs with parallel CandidePaymaster signing! Tx: " + receipt.receipt.transactionHash)
    } else {
        console.log("UserOperation execution failed")
    }
}

main()
