/**
 * Sponsor gas on Simple7702Account (EntryPoint v0.8) with an
 * ExternalSigner.
 *
 * - Account class : Simple7702Account
 * - Signing method: signUserOperationWithSigner(op, signer, chainId)
 * - Signer adapter: fromViem
 * - Paymaster     : Erc7677Paymaster
 *
 * Note on the two signatures in this file:
 *   - EIP-7702 delegation authorization  : signed with the raw pk via
 *     createAndSignEip7702DelegationAuthorization. This is a separate
 *     concern from UserOperation signing and is required by the 7702
 *     transaction type itself. The ExternalSigner API does NOT cover
 *     this; it signs the UserOperation hash.
 *   - UserOperation hash                 : signed via the ExternalSigner.
 */

import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    Simple7702Account,
    Erc7677Paymaster,
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

    const smartAccount = new Simple7702Account(publicAddress)

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

    // 1. Sign the EIP-7702 delegation authorization (separate from the
    //    UserOperation signature). This must use the raw pk.
    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            privateKey,
        )
    }

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    // 2. Sign the UserOperation hash via the ExternalSigner.
    userOp.signature = await smartAccount.signUserOperationWithSigner(
        userOp, signer, chainId,
    )

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
