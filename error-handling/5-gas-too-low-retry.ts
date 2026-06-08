import { loadEnv, getOrCreateOwner } from '../utils/env'
import { SafeMultiChainSigAccountV1 as SafeAccount, MetaTransaction } from 'abstractionkit'
import { classifyUserOpFailure } from './classifyUserOpFailure'

/**
 * The full loop: fail, classify, retry, succeed.
 *
 * Gas failures are the ones a wallet can usually retry on its own. The fix is to
 * refetch the gas price (for fees) or re-estimate gas (for limits), without
 * asking the user for anything. Here we deliberately underprice the op
 * (maxFeePerGas = 1 wei), watch the bundler reject it, classify it as a retriable
 * gas failure, then rebuild with current gas and resend, which succeeds.
 *
 * Self-funded: the smart account (sender) must hold a little testnet ETH to pay
 * gas. Fund the address printed below before running.
 */
async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const account = SafeAccount.initializeNewAccount([publicAddress])
    console.log('Account (sender):', account.accountAddress, '\n')

    const tx: MetaTransaction = { to: account.accountAddress, value: 0n, data: '0x' }

    // Attempt 1: deliberately underpriced (1 wei gas price). Only retry if the
    // failure classifies as retriable, whichever way it surfaces: a thrown error
    // (the usual case for an underpriced op), a mined success:false receipt, or a
    // null receipt (accepted but not bundled in time).
    console.log('Attempt 1: sending with maxFeePerGas = 1 wei (too low on purpose)...')
    let retriable = false
    try {
        const op = await account.createUserOperation([tx], nodeUrl, bundlerUrl, {
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
        })
        op.signature = account.signUserOperation(op, [privateKey], chainId)
        const resp = await account.sendUserOperation(op, bundlerUrl)
        const receipt = await resp.included()
        if (receipt?.success) {
            console.log('  unexpected: the underpriced op was accepted; nothing to retry.')
            return
        }
        if (receipt) {
            const failure = classifyUserOpFailure(receipt)
            console.log(`  mined but failed (${failure.category}): ${failure.suggestedAction}`)
            retriable = failure.isRetriable
        } else {
            console.log('  no receipt within the timeout; not retrying in this demo.')
        }
    } catch (err) {
        const failure = classifyUserOpFailure(err)
        console.log(`  rejected (${failure.category}): ${failure.suggestedAction}`)
        retriable = failure.isRetriable
    }

    if (!retriable) {
        console.log('  not retriable, stopping.')
        return
    }

    // Attempt 2: the failure was retriable, so rebuild with current gas and resend.
    // createUserOperation with no fee override refetches the current gas price and
    // re-estimates the limits, which is exactly the fix for a gas failure.
    console.log('\nAttempt 2: rebuilding with current gas and resending...')
    const retryOp = await account.createUserOperation([tx], nodeUrl, bundlerUrl)
    retryOp.signature = account.signUserOperation(retryOp, [privateKey], chainId)
    const retryReceipt = await (await account.sendUserOperation(retryOp, bundlerUrl)).included()
    if (retryReceipt?.success) {
        console.log('  success! tx:', retryReceipt.receipt.transactionHash)
    } else {
        console.log('  retry did not succeed:', retryReceipt)
    }
}

main()
