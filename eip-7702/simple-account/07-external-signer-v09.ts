/**
 * Sponsor gas on Simple7702AccountV09 (EntryPoint v0.9) with an
 * ExternalSigner.
 *
 * - Account class : Simple7702AccountV09
 * - Signing method: signUserOperationWithSigner(op, signer, chainId)
 * - Signer adapter: fromViem
 * - Paymaster     : CandidePaymaster (two-phase: commit -> sign -> finalize)
 *
 * Paymaster choice: EntryPoint v0.9 uses a two-phase paymaster signing
 * flow where the paymaster signature covers the owner signature. That
 * requires `signingPhase: "commit"` then `"finalize"` around the owner
 * sign step, a Candide-specific extension not part of the generic
 * ERC-7677 standard. So this file uses `CandidePaymaster`; every other
 * new example in this PR uses `Erc7677Paymaster`.
 *
 * Delegation authorization: same note as 06-external-signer.ts - signed
 * with the raw pk via createAndSignEip7702DelegationAuthorization, not
 * via the ExternalSigner.
 */

import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    Simple7702AccountV09,
    CandidePaymaster,
    createAndSignEip7702DelegationAuthorization,
    getFunctionSelector,
    createCallData,
    fromViem,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    console.log('EOA :', publicAddress)

    const smartAccount = new Simple7702AccountV09(publicAddress)
    const paymaster = new CandidePaymaster(paymasterUrl)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintData = createCallData(
        getFunctionSelector('mint(address)'),
        ['address'],
        [publicAddress],
    )

    let userOp = await smartAccount.createUserOperation(
        [{ to: nft, value: 0n, data: mintData }],
        nodeUrl, bundlerUrl,
        { eip7702Auth: { chainId } },
    )

    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            privateKey,
        )
    }

    // 1. Paymaster commit: stub data + gas estimation.
    let [commitOp] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl, sponsorshipPolicyId,
        { context: { signingPhase: 'commit' as const } },
    )
    userOp = commitOp

    // 2. Sign the UserOperation. The paymaster finalize in step 3 will
    //    see this signature in the op.
    userOp.signature = await smartAccount.signUserOperationWithSigner(
        userOp, signer, chainId,
    )

    // 3. Paymaster finalize: paymaster signature covers the signed op.
    let [finalizedOp] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl, sponsorshipPolicyId,
        { context: { signingPhase: 'finalize' as const } },
    )
    userOp = finalizedOp

    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx     :', receipt.receipt.transactionHash)
    console.log('Success:', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
