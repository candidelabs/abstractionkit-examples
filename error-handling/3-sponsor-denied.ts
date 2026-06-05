import { loadEnv, getOrCreateOwner } from '../utils/env'
import { SafeMultiChainSigAccountV1 as SafeAccount, MetaTransaction, Erc7677Paymaster } from 'abstractionkit'
import { classifyUserOpFailure } from './classifyUserOpFailure'

/**
 * Ask for gas sponsorship and get denied.
 *
 * The denial happens while building the paymaster op: createPaymasterUserOperation
 * calls the paymaster RPC, which returns an error, so it arrives as a thrown error.
 *
 * The public endpoint sponsors freely, so to get a denial reliably we point at a
 * policy id that does not exist ('123'). With a real, valid policy the script
 * reports that sponsorship was granted instead.
 */
async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl } = loadEnv()
    const sponsorshipPolicyId = '123' // does not exist, so the sponsor rejects the op
    const { publicAddress, privateKey } = getOrCreateOwner()

    const account = SafeAccount.initializeNewAccount([publicAddress])
    console.log('Account (sender):', account.accountAddress)
    console.log('Requesting gas sponsorship with policy id:', sponsorshipPolicyId, '\n')

    const tx: MetaTransaction = { to: account.accountAddress, value: 0n, data: '0x' }

    try {
        const userOperation = await account.createUserOperation([tx], nodeUrl, bundlerUrl)
        const paymaster = new Erc7677Paymaster(paymasterUrl)
        const context = sponsorshipPolicyId ? { sponsorshipPolicyId } : {}
        const { userOperation: sponsored } = await paymaster.createPaymasterUserOperation(
            account, userOperation, bundlerUrl, context)
        sponsored.signature = account.signUserOperation(sponsored, [privateKey], chainId)

        console.log('Sponsorship was granted (no denial). To see a denial, use an invalid policy id.')
    } catch (err) {
        const failure = classifyUserOpFailure(err)
        console.log('Sponsorship request failed:')
        console.log(failure)
        console.log('\nSuggested wallet action:', failure.suggestedAction)
        // In a wallet you would fall back to self-funded or token gas here.
    }
}

main()
