import { loadEnv, getOrCreateOwner, requireEnv } from '../utils/env'
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    MetaTransaction,
    getFunctionSelector,
    createCallData,
    decodeUserOperationRevertReason,
} from 'abstractionkit'
import { classifyUserOpFailure } from './classifyUserOpFailure'

/**
 * Reach the execution stage and fail there (success:false).
 *
 * This is the only failure mode that actually gets mined. To reach it the op has
 * to pass validation, which means gas has to be paid, so this demo is self-funded
 * with no paymaster. A hosted paymaster will not help: it pre-screens the op and
 * refuses to pay for one it can see will fail (Candide's paymaster enforces a
 * minimum callGasLimit), so a sponsored op never reaches execution.
 *
 * Two things make the inner call fail on-chain rather than during estimation:
 *   1. the call reverts: it transfers more tokens than the account owns.
 *   2. skipGasEstimation is set, so createUserOperation does not simulate the call
 *      (estimation would see the revert and throw before sending). We pass the gas
 *      limits manually instead.
 *
 * The smart account (printed below as "sender") must hold a little testnet ETH to
 * pay for gas. Fund that address first. Without ETH the bundler rejects with AA21
 * and you get 'insufficient-account-funds' instead.
 */
async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()
    const tokenAddress = requireEnv('TOKEN_ADDRESS')

    const account = SafeAccount.initializeNewAccount([publicAddress])
    console.log('Account (sender):', account.accountAddress)
    console.log('Self-funded (no paymaster). Fund this address with a little ETH first.\n')

    // transfer(address,uint256) of far more than the account owns -> reverts on-chain.
    const revertingTransfer = createCallData(
        getFunctionSelector('transfer(address,uint256)'),
        ['address', 'uint256'],
        [publicAddress, (10n ** 30n).toString()],
    )
    const tx: MetaTransaction = { to: tokenAddress, value: 0n, data: revertingTransfer }

    try {
        const userOperation = await account.createUserOperation(
            [tx],
            nodeUrl,
            bundlerUrl,
            {
                // Skip estimation so the reverting call is not simulated here.
                // Gas prices are still fetched from the node automatically.
                skipGasEstimation: true,
                // Pass gas limits manually, generous enough to run until the revert.
                callGasLimit: 200000n,
                verificationGasLimit: 500000n,
                preVerificationGas: 300000n,
            },
        )
        userOperation.signature = account.signUserOperation(userOperation, [privateKey], chainId)

        const response = await account.sendUserOperation(userOperation, bundlerUrl)
        console.log('Sent, waiting for inclusion...')
        const receipt = await response.included()
        if (receipt == null) {
            console.log('Receipt timed out (no classification).')
        } else if (receipt.success) {
            console.log('Unexpected: the op succeeded, so the transfer did not revert.')
        } else {
            // The classifier decodes the receipt to set its verdict, so its
            // isRetriable and suggestedAction already reflect out-of-gas vs a hard
            // revert. Call abstractionkit's decodeUserOperationRevertReason directly
            // when you want the raw reason as well.
            const failure = classifyUserOpFailure(receipt)
            console.log('UserOperation was included but reverted:')
            console.log(failure)

            const revert = decodeUserOperationRevertReason(receipt)
            if (revert.errorMessage) console.log('\nRevert reason:', revert.errorMessage)
            else if (revert.outOfGas) console.log('\nNo revert data: most likely out of gas.')

            console.log('\nSuggested wallet action:', failure.suggestedAction)
            console.log('tx:', receipt.receipt.transactionHash)
        }
    } catch (err) {
        // If the account has no ETH this is AA21 instead. The classifier handles both.
        const failure = classifyUserOpFailure(err)
        console.log('UserOperation failed before inclusion:')
        console.log(failure)
        console.log('\nSuggested wallet action:', failure.suggestedAction)
    }
}

main()
