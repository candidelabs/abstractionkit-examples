import { loadEnv, getOrCreateOwner } from '../utils/env'
import { SafeMultiChainSigAccountV1 as SafeAccount, MetaTransaction } from 'abstractionkit'
import { classifyUserOpFailure } from './classifyUserOpFailure'

/**
 * Self-funded account with no ETH and no paymaster.
 *
 * The bundler rejects the op for not paying the prefund (AA21). The op is never
 * mined, so there is no receipt: the failure arrives as a thrown error, either
 * from gas estimation (createUserOperation) or from sendUserOperation.
 */
async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const account = SafeAccount.initializeNewAccount([publicAddress])
    console.log('Account (sender):', account.accountAddress)
    console.log('This account is intentionally unfunded and uses no paymaster.\n')

    const tx: MetaTransaction = { to: account.accountAddress, value: 0n, data: '0x' }

    try {
        const userOperation = await account.createUserOperation([tx], nodeUrl, bundlerUrl)
        userOperation.signature = account.signUserOperation(userOperation, [privateKey], chainId)

        const response = await account.sendUserOperation(userOperation, bundlerUrl)
        const receipt = await response.included()
        if (receipt == null) {
            console.log('Unexpected: receipt timed out (no classification).')
        } else if (receipt.success) {
            console.log('Unexpected: the op succeeded, so the account must have been funded.')
        } else {
            console.log('Included but reverted:', classifyUserOpFailure(receipt))
        }
    } catch (err) {
        const failure = classifyUserOpFailure(err)
        console.log('UserOperation failed before inclusion:')
        console.log(failure)
        console.log('\nSuggested wallet action:', failure.suggestedAction)
        // In a wallet you would prompt the user to top up, then rebuild and resend:
        //   const retryOp = await account.createUserOperation([tx], nodeUrl, bundlerUrl)
        //   retryOp.signature = account.signUserOperation(retryOp, [privateKey], chainId)
        //   await account.sendUserOperation(retryOp, bundlerUrl)
    }
}

main()
