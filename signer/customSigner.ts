// ExternalSigner: custom inline shape (HSM / MPC / hardware-wallet pattern)
//
// Use this pattern when your signing key lives somewhere abstractionkit
// doesn't know about: a cloud HSM, an MPC threshold service, a hardware
// wallet, a Uint8Array-only key that you want to zero after use, etc.
//
// The runnable stand-in uses viem's `privateKeyToAccount().sign` for the
// cryptography so the file only imports viem. In your own code, replace
// the body of `signHash` (and optionally `signTypedData`) with a call to
// your HSM / MPC SDK. The OUTER shape (address + one-or-more capability
// methods) is what matters.
//
// The SDK enforces the "at least one capability" rule at compile time
// via a discriminated union: `{ address }` with neither method is a
// TypeScript error.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

// Pretend this is your HSM client. Replace the body of each method with
// a real HSM / MPC / hardware-wallet SDK call.
function buildHsmSigner(privateKey: `0x${string}`): ExternalSigner {
    const account = privateKeyToAccount(privateKey)  // stand-in cryptography
    return {
        address: account.address,
        // ─── Replace below with your HSM call ──────────────────────────
        // In production the pk never exists in JS memory; the HSM signs
        // the hash remotely and returns the signature.
        signHash: async (hash) => account.sign({ hash }),
        // ─── Optional: only declare if your HSM supports EIP-712 ──────
        // Omitting signTypedData is fine; Safe will fall back to signHash.
    }
}

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the custom ExternalSigner.
    const signer = buildHsmSigner(privateKey as `0x${string}`)
    console.log('Adapter       : custom (HSM / MPC / hardware pattern)')
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
