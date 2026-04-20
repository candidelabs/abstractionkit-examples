/**
 * ExternalSigner adapter: fromViem
 *
 * Wrap any viem `LocalAccount` (e.g. `privateKeyToAccount`, `toAccount`,
 * a wagmi connector's underlying account).
 *
 * Best for viem-first projects. Both `signHash` and `signTypedData` are
 * exposed; Safe accounts negotiate and pick `signTypedData` for
 * structured EIP-712 display.
 */

import {
    Erc7677Paymaster,
    ExternalSigner,
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

    // 1. Build the ExternalSigner from a viem LocalAccount. In a real app
    //    the LocalAccount comes from wherever you already create one.
    const localAccount = privateKeyToAccount(privateKey as `0x${string}`)
    const signer: ExternalSigner = fromViem(localAccount)
    logSigner('fromViem', signer)

    // 2. Initialize a counterfactual Safe with the signer as its sole owner.
    const smartAccount = SafeAccount.initializeNewAccount([signer.address])
    console.log('Safe          :', smartAccount.accountAddress)

    // 3. Build a MetaTransaction: mint an NFT to the Safe.
    const mintTx: MetaTransaction = mintNftTransaction(smartAccount.accountAddress)

    // 4. Assemble the UserOperation.
    let userOp = await smartAccount.createUserOperation(
        [mintTx], nodeUrl, bundlerUrl,
    )

    // 5. Sponsor gas via an ERC-7677 paymaster (provider-agnostic).
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
    console.log('UserOp hash   :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx            :', receipt.receipt.transactionHash)
    console.log('Success       :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

function logSigner(adapter: string, signer: ExternalSigner): void {
    console.log('Adapter       :', adapter)
    console.log('Capabilities  : signHash=%s signTypedData=%s',
        typeof signer.signHash === 'function',
        typeof signer.signTypedData === 'function')
    console.log('Signer address:', signer.address)
}

function mintNftTransaction(to: string): MetaTransaction {
    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    return {
        to: nft,
        value: 0n,
        data: createCallData(
            getFunctionSelector('mint(address)'),
            ['address'],
            [to],
        ),
    }
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
