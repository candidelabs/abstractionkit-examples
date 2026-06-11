import { loadEnv, getOrCreateOwner, requireEnv } from '../utils/env'
import { SafeMultiChainSigAccountV1 as SafeAccount, MetaTransaction, Erc7677Paymaster } from 'abstractionkit'
import { classifyUserOpFailure } from './classifyUserOpFailure'

/**
 * Pay gas in an ERC-20 token, but the account's token balance is below what the
 * paymaster needs. This covers both "holds none" and "holds some, but not
 * enough" — the failure is identical either way.
 *
 * When the required amount exceeds the balance, the Candide paymaster rejects
 * the op during the paymaster call with:
 *
 *     validator: token balance lower than the required 0x5be0f allowance
 *
 * abstractionkit surfaces that as an AbstractionKitError with code
 * PAYMASTER_ERROR (the validator message on err.cause.message), which
 * classifyUserOpFailure maps to category 'insufficient-token-funds'. Depending
 * on the bundler an underfunded op can instead slip through to send time or to a
 * success:false receipt, so the handler below covers both paths.
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
