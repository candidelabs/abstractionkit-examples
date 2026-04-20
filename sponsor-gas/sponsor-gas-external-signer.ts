/**
 * Sponsor gas on SafeAccountV0_3_0 (EntryPoint v0.7) with an
 * ExternalSigner.
 *
 * - Account class : SafeAccountV0_3_0
 * - Signing method: signUserOperationWithSigners(op, [signer], chainId)
 * - Signer adapter: fromViem  (swap to fromEthersWallet if your project
 *                              uses ethers; see signer/ hub for all
 *                              adapters)
 * - Paymaster     : Erc7677Paymaster (provider-agnostic)
 */

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    getFunctionSelector,
    createCallData,
    fromViem,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // External signer. No private key is passed into abstractionkit.
    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    console.log('Signer  :', signer.address)

    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe    :', smartAccount.accountAddress)

    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintTx: MetaTransaction = {
        to: nft,
        value: 0n,
        data: createCallData(
            getFunctionSelector('mint(address)'),
            ['address'],
            [smartAccount.accountAddress],
        ),
    }

    let userOp = await smartAccount.createUserOperation(
        [mintTx], nodeUrl, bundlerUrl,
    )

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

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
