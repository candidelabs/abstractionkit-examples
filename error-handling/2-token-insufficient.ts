import { loadEnv, getOrCreateOwner, requireEnv } from '../utils/env'
import { SafeMultiChainSigAccountV1 as SafeAccount, MetaTransaction, Erc7677Paymaster } from 'abstractionkit'
import { classifyUserOpFailure } from './classifyUserOpFailure'

/**
 * Pay gas in an ERC-20 token, but the account holds none of it.
 *
 * The token-paymaster flow has nothing to charge, so it fails. Depending on the
 * bundler this shows up as a thrown error at send time, or as a success:false
 * receipt. The handler below covers both paths.
 */
async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()
    const tokenAddress = requireEnv('TOKEN_ADDRESS')

    const account = SafeAccount.initializeNewAccount([publicAddress])
    console.log('Account (sender):', account.accountAddress)
    console.log('Paying gas in token', tokenAddress, 'but the account holds none.\n')

    const tx: MetaTransaction = { to: account.accountAddress, value: 0n, data: '0x' }

    try {
        let userOperation = await account.createUserOperation([tx], nodeUrl, bundlerUrl)
        const paymaster = new Erc7677Paymaster(paymasterUrl)
        // { token } triggers the token-gas flow: fetches a quote and prepends an approval.
        const { userOperation: tokenOp } = await paymaster.createPaymasterUserOperation(
            account, userOperation, bundlerUrl, { token: tokenAddress })
        userOperation = tokenOp
        userOperation.signature = account.signUserOperation(userOperation, [privateKey], chainId)

        const response = await account.sendUserOperation(userOperation, bundlerUrl)
        const receipt = await response.included()
        if (receipt == null) {
            console.log('Unexpected: receipt timed out (no classification).')
        } else if (receipt.success) {
            console.log('Unexpected: the op succeeded, so the account must hold the token.')
        } else {
            const failure = classifyUserOpFailure(receipt)
            console.log('Included but reverted:', failure)
            console.log('\nSuggested wallet action:', failure.suggestedAction)
        }
    } catch (err) {
        const failure = classifyUserOpFailure(err)
        console.log('Token-paymaster UserOperation failed before inclusion:')
        console.log(failure)
        console.log('\nSuggested wallet action:', failure.suggestedAction)
    }
}

main()
