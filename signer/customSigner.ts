/**
 * ExternalSigner: custom inline object (HSM / MPC / hardware wallet).
 *
 * Use this pattern when your signing key lives somewhere abstractionkit
 * doesn't know about: a cloud HSM, an MPC threshold service, a Ledger,
 * a Uint8Array-only key you zero after use, etc.
 *
 * The shape is an object with `address` plus `signHash` and/or
 * `signTypedData`. The SDK enforces at compile time that at least one
 * capability method is present.
 *
 * In this runnable stand-in, `signHash` delegates to viem's local
 * crypto so the file can execute end-to-end. In your own code, replace
 * that line with a call to your HSM / MPC / hardware-wallet SDK. The
 * outer shape is what you should copy.
 */

import {
    Erc7677Paymaster,
    ExternalSigner,
    MetaTransaction,
    SafeAccountV0_3_0 as SafeAccount,
    createCallData,
    getFunctionSelector,
} from 'abstractionkit'
import { privateKeyToAccount } from 'viem/accounts'

import { getOrCreateOwner, loadEnv } from '../utils/env'

/**
 * Build an ExternalSigner that simulates an HSM / MPC / hardware wallet.
 *
 * Replace the body of `signHash` with a call to your device SDK. Declare
 * `signTypedData` only if the device supports EIP-712 structured data;
 * omitting it is valid, and Safe will fall back to `signHash`.
 */
function buildCustomSigner(privateKey: `0x${string}`): ExternalSigner {
    // Stand-in only. In production the key never lives in JS memory;
    // the device signs remotely and returns the signature bytes.
    const account = privateKeyToAccount(privateKey)

    return {
        address: account.address,
        signHash: async (hash) => account.sign({ hash }),
        // signTypedData: async (data) => yourDevice.signTypedData(data),
    }
}

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the custom ExternalSigner.
    const signer = buildCustomSigner(privateKey as `0x${string}`)
    logSigner('custom (HSM / MPC / hardware)', signer)

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
    const { userOperation: sponsoredOp } = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )
    userOp = sponsoredOp

    // 6. Sign with the custom ExternalSigner.
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
