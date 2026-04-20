// ExternalSigner adapter: fromEthersWallet -> signHash + signTypedData
//
// Use this adapter when your project already depends on ethers (>=6).
// This is the ONLY hub file that imports ethers; every other adapter
// works without it. If you don't use ethers, skip this file.
//
// Why it exists: ethers users don't need to swap to viem to get signer
// support in abstractionkit.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { Wallet } from 'ethers'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    fromEthersWallet,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner from an ethers Wallet. In a real app,
    //    the Wallet comes from wherever you already create one (new
    //    Wallet(pk), HDNodeWallet.fromPhrase, ethers.getSigner(), ...).
    const wallet = new Wallet(privateKey)
    const signer: ExternalSigner = fromEthersWallet(wallet)
    console.log('Adapter       : fromEthersWallet')
    console.log('Capabilities  : signHash=%s signTypedData=%s',
        typeof signer.signHash === 'function',
        typeof signer.signTypedData === 'function')
    console.log('Signer address:', signer.address)

    // 2. Standard Safe flow.
    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe (sender) :', smartAccount.accountAddress)

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
    console.log('UserOp hash   :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx            :', receipt.receipt.transactionHash)
    console.log('Success       :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
