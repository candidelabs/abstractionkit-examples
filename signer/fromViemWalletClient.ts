/**
 * ExternalSigner adapter: fromViemWalletClient
 *
 * Wrap a viem `WalletClient`: the client-style API dApps use to drive
 * browser wallets, WalletConnect, or other JSON-RPC providers.
 *
 * Only `signTypedData` is exposed. JSON-RPC wallets cannot sign raw
 * hashes, so this adapter intentionally omits `signHash`.
 *
 * Consequence: this signer will NOT work on the multi-op Merkle path
 * (`SafeMultiChainSigAccountV1.signUserOperationsWithSigners`), which
 * requires `signHash`. Capability negotiation throws offline with an
 * actionable error naming this adapter. Use `fromViem` with the
 * underlying `LocalAccount` when you need raw-hash support.
 */

import {
    Erc7677Paymaster,
    ExternalSigner,
    MetaTransaction,
    SafeAccountV0_3_0 as SafeAccount,
    createCallData,
    fromViemWalletClient,
    getFunctionSelector,
} from 'abstractionkit'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrumSepolia } from 'viem/chains'

import { getOrCreateOwner, loadEnv } from '../utils/env'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner from a viem WalletClient. A LocalAccount
    //    is attached here so the example is runnable from node; in a
    //    real dApp the account comes from a browser wallet / WalletConnect
    //    / injected provider.
    const localAccount = privateKeyToAccount(privateKey as `0x${string}`)
    const walletClient = createWalletClient({
        account: localAccount,
        chain: arbitrumSepolia,
        transport: http(nodeUrl),
    })
    const signer: ExternalSigner = fromViemWalletClient(walletClient)
    logSigner('fromViemWalletClient', signer)

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

    // 6. Sign with the ExternalSigner. Safe negotiates and uses
    //    signTypedData (the only capability this adapter exposes).
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
