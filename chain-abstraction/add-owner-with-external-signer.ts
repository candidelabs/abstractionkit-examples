/**
 * Add an owner across two chains (Sepolia + OP Sepolia) with a SINGLE
 * ECDSA signature via the multi-op ExternalSigner API.
 *
 * Account class : SafeMultiChainSigAccountV1 (EntryPoint v0.9)
 * Signing method: signUserOperationsWithSigners(items, [signer])
 * Signer adapter: fromViem
 * Paymaster     : CandidePaymaster (two-phase per chain: commit -> sign -> finalize)
 *
 * Key property: one call to signUserOperationsWithSigners produces one
 * signature per op from a single signing operation (Merkle root). The
 * user, HSM, or hardware wallet is prompted once for N chains.
 *
 * Why CandidePaymaster here: EntryPoint v0.9 uses a two-phase paymaster
 * signing flow where the paymaster signature covers the owner signature.
 * That requires `signingPhase: "commit"` then `"finalize"` around the
 * owner sign step, a Candide-specific extension not part of the
 * generic ERC-7677 standard. `Erc7677Paymaster` does not support
 * EntryPoint v0.9.
 */

import {
    CandidePaymaster,
    SafeMultiChainSigAccountV1 as SafeAccount,
    fromViem,
} from 'abstractionkit'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { getOrCreateOwner, loadMultiChainEnv } from '../utils/env'

async function main(): Promise<void> {
    const {
        chainId1, chainId2,
        bundlerUrl1, bundlerUrl2,
        nodeUrl1, nodeUrl2,
        paymasterUrl1, paymasterUrl2,
        sponsorshipPolicyId1, sponsorshipPolicyId2,
    } = loadMultiChainEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner and pick a new-owner address to add.
    const signer = fromViem(privateKeyToAccount(privateKey as `0x${string}`))
    const newOwner = process.env.NEW_OWNER_ADDRESS
        ?? privateKeyToAccount(generatePrivateKey()).address
    console.log('Owner     :', publicAddress)
    console.log('New owner :', newOwner)
    console.log('Chains    :', chainId1.toString(), '+', chainId2.toString())

    // 2. Initialize the Safe (same address on every chain).
    const smartAccount = SafeAccount.initializeNewAccount([publicAddress])
    console.log('Safe      :', smartAccount.accountAddress)

    // 3. Build the add-owner meta-transaction (identical on both chains).
    const addOwnerTx = smartAccount.createStandardAddOwnerWithThresholdMetaTransaction(
        newOwner, 1,
    )

    const paymaster1 = new CandidePaymaster(paymasterUrl1)
    const paymaster2 = new CandidePaymaster(paymasterUrl2)
    const commit = { context: { signingPhase: 'commit' as const } }
    const finalize = { context: { signingPhase: 'finalize' as const } }

    // 4. Assemble a UserOperation on each chain.
    let [op1, op2] = await Promise.all([
        smartAccount.createUserOperation([addOwnerTx], nodeUrl1, bundlerUrl1),
        smartAccount.createUserOperation([addOwnerTx], nodeUrl2, bundlerUrl2),
    ])

    // 5. Paymaster COMMIT on each chain (stub data + gas estimation).
    const committed = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, op1, bundlerUrl1, sponsorshipPolicyId1, commit,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, op2, bundlerUrl2, sponsorshipPolicyId2, commit,
        ),
    ])
    ;[op1, op2] = [committed[0][0], committed[1][0]]

    // 6. ONE signing call, N signatures out.
    const signatures = await smartAccount.signUserOperationsWithSigners(
        [
            { userOperation: op1, chainId: chainId1 },
            { userOperation: op2, chainId: chainId2 },
        ],
        [signer],
    )
    op1.signature = signatures[0]
    op2.signature = signatures[1]
    console.log(`Produced ${signatures.length} signatures from 1 signing operation.`)

    // 7. Paymaster FINALIZE on each chain.
    const finalized = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, op1, bundlerUrl1, sponsorshipPolicyId1, finalize,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, op2, bundlerUrl2, sponsorshipPolicyId2, finalize,
        ),
    ])
    ;[op1, op2] = [finalized[0][0], finalized[1][0]]

    // 8. Submit to each bundler concurrently and wait for inclusion.
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

    // 9. Read back the owner set on each chain to confirm.
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
