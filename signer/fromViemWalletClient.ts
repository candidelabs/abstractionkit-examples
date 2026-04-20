// ExternalSigner adapter: fromViemWalletClient -> signTypedData only
//
// Use this adapter when you hold a viem `WalletClient` (the client-style
// API dApps use to drive browser / WalletConnect / JSON-RPC wallets).
// WalletClient cannot sign raw hashes (JSON-RPC wallets refuse), so
// this adapter exposes only signTypedData.
//
// Capability caveat: this signer will NOT work on the multi-op Merkle
// path (SafeMultiChainSigAccountV1.signUserOperationsWithSigners). That
// path requires signHash, and pickScheme will throw offline with an
// actionable error naming this adapter. Use fromViem instead when you
// need multi-op.
//
// For local accounts (privateKeyToAccount), pass the LocalAccount to
// fromViem instead of wrapping it in a WalletClient. You'll get raw-
// hash support for free.

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrumSepolia } from 'viem/chains'
import {
    SafeAccountV0_3_0 as SafeAccount,
    Erc7677Paymaster,
    ExternalSigner,
    fromViemWalletClient,
    getFunctionSelector,
    createCallData,
    MetaTransaction,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner from a viem WalletClient.
    //    A LocalAccount is attached here so the example is runnable
    //    without a browser; in a dApp the account would come from a
    //    browser wallet / WalletConnect / injected provider.
    const localAccount = privateKeyToAccount(privateKey as `0x${string}`)
    const walletClient = createWalletClient({
        account: localAccount,
        chain: arbitrumSepolia,
        transport: http(nodeUrl),
    })
    const signer: ExternalSigner = fromViemWalletClient(walletClient)
    console.log('Adapter       : fromViemWalletClient')
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
