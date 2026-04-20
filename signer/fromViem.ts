// ExternalSigner adapter: fromViem -> signHash + signTypedData
//
// Use this adapter when you already hold a viem `LocalAccount`
// (the most common shape in viem-first projects). Exposes both
// capabilities; when Safe negotiates, it picks signTypedData so the
// user sees structured EIP-712 fields instead of an opaque hex blob.
//
// Why it exists: avoids round-tripping your viem Account through a raw
// pk string just to get a signature.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    fromViem,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner from a viem LocalAccount. In a real
    //    app, this LocalAccount comes from wherever you already create
    //    one (privateKeyToAccount, toAccount, a wagmi connector, ...).
    const localAccount = privateKeyToAccount(privateKey as `0x${string}`)
    const signer: ExternalSigner = fromViem(localAccount)
    console.log('Adapter       : fromViem')
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
