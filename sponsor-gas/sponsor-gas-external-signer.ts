/**
 * Sponsor gas on a Safe (EntryPoint v0.7) with an ExternalSigner.
 *
 * Account class : SafeAccountV0_3_0
 * Signing method: signUserOperationWithSigners(op, [signer], chainId)
 * Signer adapter: fromViem (swap to fromEthersWallet / fromPrivateKey /
 *                 fromViemWalletClient as you like; see the signer/ hub)
 * Paymaster     : Erc7677Paymaster (provider-agnostic)
 */

import {
    Erc7677Paymaster,
    MetaTransaction,
    SafeAccountV0_3_0 as SafeAccount,
    createCallData,
    fromViem,
    getFunctionSelector,
} from 'abstractionkit'
import { privateKeyToAccount } from 'viem/accounts'

import { getOrCreateOwner, loadEnv } from '../utils/env'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner. No private key is passed into abstractionkit.
    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    console.log('Signer  :', signer.address)

    // 2. Initialize a counterfactual Safe with the signer as its sole owner.
    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe    :', smartAccount.accountAddress)

    // 3. Build a MetaTransaction: mint an NFT to the Safe.
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

    // 4. Assemble the UserOperation.
    let userOp = await smartAccount.createUserOperation(
        [mintTx], nodeUrl, bundlerUrl,
    )

    // 5. Sponsor gas via an ERC-7677 paymaster.
    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    // 6. Sign with the ExternalSigner.
    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

    // 7. Send and wait for on-chain inclusion.
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
