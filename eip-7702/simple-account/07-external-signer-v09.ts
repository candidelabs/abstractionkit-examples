/**
 * Upgrade an EOA to Simple7702AccountV09 (EntryPoint v0.9) with an
 * ExternalSigner.
 *
 * Account class : Simple7702AccountV09
 * Signing method: signUserOperationWithSigner(op, signer, chainId)
 * Signer adapter: fromViem
 * Paymaster     : CandidePaymaster (two-phase: commit -> sign -> finalize)
 *
 * Why CandidePaymaster here: EntryPoint v0.9 uses a two-phase paymaster
 * signing flow where the paymaster signature covers the owner signature.
 * That requires `signingPhase: "commit"` then `"finalize"` around the
 * owner sign step, a Candide-specific extension that isn't part of the
 * generic ERC-7677 standard. Every other new signer example in this PR
 * uses `Erc7677Paymaster`.
 *
 * Delegation authorization: same as 06-external-signer.ts. Signed with
 * the raw pk via createAndSignEip7702DelegationAuthorization; separate
 * from the UserOperation signature.
 */

import {
    CandidePaymaster,
    Simple7702AccountV09,
    createAndSignEip7702DelegationAuthorization,
    createCallData,
    fromViem,
    getFunctionSelector,
} from 'abstractionkit'
import { privateKeyToAccount } from 'viem/accounts'

import { getOrCreateOwner, loadEnv } from '../../utils/env'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner.
    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    console.log('EOA     :', publicAddress)

    // 2. Initialize the Simple7702 v0.9 account and the paymaster client.
    const smartAccount = new Simple7702AccountV09(publicAddress)
    const paymaster = new CandidePaymaster(paymasterUrl)

    // 3. Build a MetaTransaction: mint an NFT to the EOA.
    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintData = createCallData(
        getFunctionSelector('mint(address)'),
        ['address'],
        [publicAddress],
    )

    // 4. Assemble the UserOperation with an unsigned EIP-7702 authorization.
    let userOp = await smartAccount.createUserOperation(
        [{ to: nft, value: 0n, data: mintData }],
        nodeUrl, bundlerUrl,
        { eip7702Auth: { chainId } },
    )

    // 5. Sign the EIP-7702 delegation authorization (raw pk; NOT the
    //    ExternalSigner path).
    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            privateKey,
        )
    }

    // 6. Paymaster COMMIT: stub data + gas estimation.
    let [commitOp] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl, sponsorshipPolicyId,
        { context: { signingPhase: 'commit' as const } },
    )
    userOp = commitOp

    // 7. Sign the UserOperation hash via the ExternalSigner, between the
    //    two paymaster phases.
    userOp.signature = await smartAccount.signUserOperationWithSigner(
        userOp, signer, chainId,
    )

    // 8. Paymaster FINALIZE: paymaster signature now covers the signed op.
    let [finalizedOp] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl, sponsorshipPolicyId,
        { context: { signingPhase: 'finalize' as const } },
    )
    userOp = finalizedOp

    // 9. Send and wait for on-chain inclusion.
    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp  :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx      :', receipt.receipt.transactionHash)
    console.log('Success :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
