import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702AccountV09 as Simple7702Account,
    MetaTransaction,
    UserOperationV9,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
} from "abstractionkit"

/**
 * Same upgrade-and-mint flow as 01-upgrade-eoa.ts, but using the paymaster's
 * two-phase "parallel signing" flow instead of the one-shot sponsor call.
 *
 * One-shot (01): paymaster fills its data, THEN the owner signs over it. The
 * owner waits for the paymaster round-trip before signing.
 *
 * Two-phase (this file): a latency optimization. The paymaster COMMITs
 * preliminary data + gas estimates, the owner signs while the paymaster works,
 * then FINALIZE returns the paymaster data that covers the owner signature:
 *
 *     commit  ->  owner signs  ->  finalize
 *
 * Both produce a valid sponsored UserOperation; two-phase just lets the owner
 * signature and the paymaster work overlap. Reach for it when sign latency
 * (hardware wallet, remote signer) matters.
 */

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaAddress, privateKey } = getOrCreateOwner()

    const smartAccount = new Simple7702Account(eoaAddress)
    const paymaster = new CandidePaymaster(paymasterUrl)

    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintCallData = createCallData(
        getFunctionSelector('mint(address)'),
        ["address"],
        [eoaAddress],
    )
    const mintTx: MetaTransaction = { to: nftContractAddress, value: 0n, data: mintCallData }

    let userOperation: UserOperationV9 = await smartAccount.createUserOperation(
        [mintTx],
        nodeUrl,
        bundlerUrl,
        { eip7702Auth: { chainId } },
    )

    if (userOperation.eip7702Auth) {
        console.log("EOA not yet delegated — signing EIP-7702 authorization")
        userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            privateKey,
        )
    } else {
        console.log("EOA already delegated — skipping EIP-7702 authorization")
    }

    // Phase 1 — COMMIT: paymaster pins gas estimates + preliminary data.
    const { userOperation: commitOp } = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount,
        userOperation,
        bundlerUrl,
        sponsorshipPolicyId,
        { signingPhase: "commit" },
        { entrypoint: smartAccount.entrypointAddress },
    )
    userOperation = commitOp

    // Owner signs now — in parallel with the paymaster, not after it.
    userOperation.signature = smartAccount.signUserOperation(
        userOperation, privateKey, chainId,
    )

    // Phase 2 — FINALIZE: paymaster data that covers the owner signature.
    const { userOperation: finalizedOp } = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount,
        userOperation,
        bundlerUrl,
        sponsorshipPolicyId,
        { signingPhase: "finalize" },
        { entrypoint: smartAccount.entrypointAddress },
    )
    userOperation = finalizedOp

    const response = await smartAccount.sendUserOperation(userOperation, bundlerUrl)
    console.log(`UserOp sent (hash: ${response.userOperationHash}). Waiting for inclusion...`)
    const receipt = await response.included()

    if (receipt == null) {
        console.log("Receipt not found (timeout)")
    } else if (receipt.success) {
        console.log("NFT minted via two-phase signing — tx " + receipt.receipt.transactionHash)
    } else {
        console.log("UserOperation execution failed")
    }
}

main()
