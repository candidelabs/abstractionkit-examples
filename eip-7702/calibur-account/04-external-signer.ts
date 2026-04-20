/**
 * Upgrade EOA to Calibur (EIP-7702) and mint an NFT with an
 * ExternalSigner.
 *
 * - Account class : Calibur7702Account
 * - Signing method: signUserOperationWithSigner(op, signer, chainId)
 * - Signer adapter: fromViem
 * - Paymaster     : Erc7677Paymaster
 *
 * Behavioral note: isDelegatedToThisAccount() checks on-chain and skips
 * the 7702 authorization if the EOA is already delegated to Calibur.
 * Re-running this example after a successful first run will not try to
 * re-delegate.
 */

import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    Calibur7702Account,
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

    const smartAccount = new Calibur7702Account(publicAddress)
    const alreadyDelegated = await smartAccount.isDelegatedToThisAccount(nodeUrl)
    if (alreadyDelegated) console.log('Already delegated to Calibur; skipping auth.')

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintData = createCallData(
        getFunctionSelector('mint(address)'),
        ['address'],
        [publicAddress],
    )

    let userOp = await smartAccount.createUserOperation(
        [{ to: nft, value: 0n, data: mintData }],
        nodeUrl, bundlerUrl,
        { eip7702Auth: alreadyDelegated ? undefined : { chainId } },
    )

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
