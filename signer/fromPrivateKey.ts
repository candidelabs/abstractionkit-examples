// ExternalSigner adapter: fromPrivateKey -> signHash + signTypedData
//
// Use this adapter when all you have is a raw 0x-prefixed private key
// string. Zero external deps: the library uses its internal ethers
// dependency under the hood, so callers don't have to install anything.
//
// Why it exists: most scripts, integration tests, and server-side
// workers already hold a pk in an env var. fromPrivateKey wraps it
// without forcing the developer to instantiate a viem or ethers object
// just to sign a UserOperation.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    fromPrivateKey,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner. This is the only line that changes
    //    between hub examples.
    const signer: ExternalSigner = fromPrivateKey(privateKey)
    console.log('Adapter       : fromPrivateKey')
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

    // 3. Sponsor gas via ERC-7677. Works against any ERC-7677 provider
    //    (Candide, Pimlico, Alchemy, self-hosted).
    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOp = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )

    // 4. Sign with the ExternalSigner. Safe accepts an array of signers
    //    (multi-owner ready); we pass a single-element array here.
    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

    // 5. Send + wait.
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
