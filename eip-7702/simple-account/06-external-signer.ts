/**
 * Upgrade an EOA to Simple7702Account (EntryPoint v0.8) with an
 * ExternalSigner.
 *
 * Account class : Simple7702Account
 * Signing method: signUserOperationWithSigner(op, signer, chainId)
 * Signer adapter: fromViem
 * Paymaster     : Erc7677Paymaster
 *
 * Two signatures happen here, for different purposes:
 *   1. The EIP-7702 delegation authorization is signed with the raw pk
 *      via createAndSignEip7702DelegationAuthorization. It authorizes the
 *      7702 transaction type itself and is NOT what ExternalSigner
 *      covers.
 *   2. The UserOperation hash is signed via the ExternalSigner.
 */

import {
    Erc7677Paymaster,
    Simple7702Account,
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

    // 2. Initialize the Simple7702 account (sender = EOA address after delegation).
    const smartAccount = new Simple7702Account(publicAddress)

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
    //    ExternalSigner path). Skipped if the EOA is already delegated.
    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            privateKey,
        )
    }

    // 6. Sponsor gas via an ERC-7677 paymaster.
    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    // 7. Sign the UserOperation hash via the ExternalSigner.
    userOp.signature = await smartAccount.signUserOperationWithSigner(
        userOp, signer, chainId,
    )

    // 8. Send and wait for on-chain inclusion.
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
