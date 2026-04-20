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
 * Delegation authorization: same as 05-external-signer.ts. Signed via
 * the callback overload of createAndSignEip7702DelegationAuthorization
 * using the viem LocalAccount's .sign, so no raw private key reaches
 * abstractionkit; separate from the UserOperation signature.
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

    // 1. Build the ExternalSigner. We keep a reference to the underlying
    //    viem LocalAccount so we can reuse its .sign method below for the
    //    7702 delegation authorization, without handing the raw private
    //    key to abstractionkit.
    const localAccount = privateKeyToAccount(privateKey as `0x${string}`)
    const signer = fromViem(localAccount)
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

    // 5. Sign the EIP-7702 delegation authorization via the external
    //    signer callback. createAndSignEip7702DelegationAuthorization
    //    accepts a callback (hash) => Promise<sig>; we delegate to the
    //    viem LocalAccount so the key never enters abstractionkit.
    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = await createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            async (hash) => localAccount.sign({ hash: hash as `0x${string}` }),
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
