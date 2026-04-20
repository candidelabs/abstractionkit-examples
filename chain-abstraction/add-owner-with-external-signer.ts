/**
 * Add an owner across two chains (Sepolia + OP Sepolia) in ONE signature
 * using the multi-op ExternalSigner API on SafeMultiChainSigAccountV1.
 *
 * - Account class : SafeMultiChainSigAccountV1 (EntryPoint v0.9)
 * - Signing method: signUserOperationsWithSigners(items, [signer])
 * - Signer adapter: fromViem
 * - Paymaster     : CandidePaymaster (two-phase per chain: commit -> sign -> finalize)
 *
 * Paymaster choice: EntryPoint v0.9 uses a two-phase paymaster signing
 * flow where the paymaster signature must cover the owner signature.
 * This is a Candide-specific extension; `Erc7677Paymaster` does not
 * support EP v0.9. See 07-external-signer-v09.ts for the same note on
 * Simple7702V09.
 *
 * Key property of the multi-op signer: one call to
 * signUserOperationsWithSigners produces one signature PER op from a
 * SINGLE ECDSA operation (Merkle root). The user (or HSM) is prompted
 * once, not N times.
 */

import { loadMultiChainEnv, getOrCreateOwner } from '../utils/env'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    CandidePaymaster,
    fromViem,
} from 'abstractionkit'

async function main(): Promise<void> {
    const {
        chainId1, chainId2,
        bundlerUrl1, bundlerUrl2,
        nodeUrl1, nodeUrl2,
        paymasterUrl1, paymasterUrl2,
        sponsorshipPolicyId1, sponsorshipPolicyId2,
    } = loadMultiChainEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    const newOwner = process.env.NEW_OWNER_ADDRESS
        ?? privateKeyToAccount(generatePrivateKey()).address

    console.log('Owner     :', publicAddress)
    console.log('New owner :', newOwner)
    console.log('Chains    :', chainId1.toString(), '+', chainId2.toString())

    const smartAccount = SafeAccount.initializeNewAccount([publicAddress])
    console.log('Safe      :', smartAccount.accountAddress)

    const addOwnerTx = smartAccount.createStandardAddOwnerWithThresholdMetaTransaction(
        newOwner, 1,
    )

    const paymaster1 = new CandidePaymaster(paymasterUrl1)
    const paymaster2 = new CandidePaymaster(paymasterUrl2)
    const commitOverrides = { context: { signingPhase: 'commit' as const } }
    const finalizeOverrides = { context: { signingPhase: 'finalize' as const } }

    // 1. Create UserOperations for both chains.
    let [op1, op2] = await Promise.all([
        smartAccount.createUserOperation([addOwnerTx], nodeUrl1, bundlerUrl1),
        smartAccount.createUserOperation([addOwnerTx], nodeUrl2, bundlerUrl2),
    ])

    // 2. Paymaster commit on both chains.
    const committed = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, op1, bundlerUrl1, sponsorshipPolicyId1, commitOverrides,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, op2, bundlerUrl2, sponsorshipPolicyId2, commitOverrides,
        ),
    ])
    ;[op1, op2] = [committed[0][0], committed[1][0]]

    // 3. One signing call, N signatures out. Merkle root means one
    //    ECDSA operation authorizes both ops.
    const signatures = await smartAccount.signUserOperationsWithSigners(
        [
            { userOperation: op1, chainId: chainId1 },
            { userOperation: op2, chainId: chainId2 },
        ],
        [signer],
    )
    op1.signature = signatures[0]
    op2.signature = signatures[1]
    console.log('One signing op produced', signatures.length, 'signatures.')

    // 4. Paymaster finalize on both chains.
    const finalized = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, op1, bundlerUrl1, sponsorshipPolicyId1, finalizeOverrides,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, op2, bundlerUrl2, sponsorshipPolicyId2, finalizeOverrides,
        ),
    ])
    ;[op1, op2] = [finalized[0][0], finalized[1][0]]

    // 5. Send to both chains concurrently.
    const [resp1, resp2] = await Promise.all([
        smartAccount.sendUserOperation(op1, bundlerUrl1),
        smartAccount.sendUserOperation(op2, bundlerUrl2),
    ])
    console.log('Chain 1 UserOp:', resp1.userOperationHash)
    console.log('Chain 2 UserOp:', resp2.userOperationHash)

    const [r1, r2] = await Promise.all([resp1.included(), resp2.included()])
    if (!r1 || !r2) throw new Error('timeout waiting for inclusion')
    console.log('Chain 1 Tx    :', r1.receipt.transactionHash, '| success:', r1.success)
    console.log('Chain 2 Tx    :', r2.receipt.transactionHash, '| success:', r2.success)
    if (!r1.success || !r2.success) throw new Error('at least one chain reverted')

    const [owners1, owners2] = await Promise.all([
        smartAccount.getOwners(nodeUrl1),
        smartAccount.getOwners(nodeUrl2),
    ])
    console.log('Chain 1 owners:', owners1)
    console.log('Chain 2 owners:', owners2)
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
