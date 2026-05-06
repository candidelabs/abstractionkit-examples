/**
 * Add a new owner to a Safe Unified Account on TWO chains with a SINGLE
 * passkey signature.
 *
 * Account class : SafeMultiChainSigAccountV1
 * Signing method: signUserOperationsWithSigners(opsToSign, signers)
 * Signer adapter: fromSafeWebauthn({ accountClass: SafeMultiChainSigAccountV1 })
 * Paymaster     : CandidePaymaster on each chain (two-phase)
 *
 * What this demonstrates:
 *  - One WebAuthn assertion → both UserOps validate on-chain.
 *  - The adapter sources Safe Passkeys v0.2.1 defaults (Daimo P256 verifier,
 *    RIP-7951 precompile) automatically because we pass
 *    `accountClass: SafeMultiChainSigAccountV1`. Without that param the
 *    derived signer address would not match the on-chain owner and the
 *    bundler would reject with "Invalid UserOp signature" (GS026).
 *
 * Assumes the Safe is fresh on both chains (both UserOps are isInit=true).
 * For mixed init states (deployed on one chain, fresh on the other),
 * you'd build two adapters with different `isInit` values and split the
 * ops between them.
 *
 * Use case: one-tap cross-chain account management secured by a device
 * passkey (Touch ID / Face ID / Windows Hello).
 */

import {
    AbstractionKitError,
    CandidePaymaster,
    SafeMultiChainSigAccountV1,
    fromSafeWebauthn,
    pubkeyCoordinatesFromJson,
    pubkeyCoordinatesToJson,
    webauthnSignatureFromAssertion,
    type CandidePaymasterContext,
    type UserOperationV9,
    type WebauthnPublicKey,
} from 'abstractionkit'
import { hexToBytes, keccak256, numberToBytes, toBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { loadMultiChainEnv } from '../utils/env'
import {
    UserVerificationRequirement,
    WebAuthnCredentials,
    extractPublicKey,
} from '../passkeys/webauthn'

async function main(): Promise<void> {
    const {
        chainId1, chainId2,
        bundlerUrl1, bundlerUrl2,
        nodeUrl1, nodeUrl2,
        paymasterUrl1, paymasterUrl2,
        sponsorshipPolicyId1, sponsorshipPolicyId2,
    } = loadMultiChainEnv()

    console.log('='.repeat(60))
    console.log('ADD OWNER ACROSS CHAINS — SIGNED BY ONE PASSKEY')
    console.log('='.repeat(60))

    // 1. Create a passkey credential. The simulator from `webauthn.ts`
    //    keeps this runnable in node; in a browser, replace `navigator`
    //    with `window.navigator` (and await the async create/get calls).
    console.log('\n[1/7] Creating passkey...')
    const navigator = { credentials: new WebAuthnCredentials() }
    const credential = await navigator.credentials.create({
        publicKey: {
            rp: { name: 'Candide', id: 'candide.dev' },
            user: {
                id: hexToBytes(keccak256(toBytes('chain-abstraction-demo'))),
                name: 'demo-user',
                displayName: 'Demo User',
            },
            challenge: numberToBytes(Date.now()),
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        },
    })

    // Round-trip the pubkey through JSON — mirrors what a real app does
    // when persisting + rehydrating, and exercises the typeof-bigint guard
    // in fromSafeWebauthn (use pubkeyCoordinatesFromJson to hydrate).
    const persisted = pubkeyCoordinatesToJson(extractPublicKey(credential.response))
    const publicKey: WebauthnPublicKey = pubkeyCoordinatesFromJson(persisted)

    // 2. Initialize the multichain Safe with this passkey as owner. The
    //    same address deploys on both chains.
    const smartAccount = SafeMultiChainSigAccountV1.initializeNewAccount([publicKey])
    console.log(`[2/7] Safe (same on both chains): ${smartAccount.accountAddress}`)

    const newOwnerAddress = privateKeyToAccount(generatePrivateKey()).address
    console.log(`      New owner to add: ${newOwnerAddress}`)
    console.log(`      Chains: ${chainId1} + ${chainId2}`)

    // 3. Build the add-owner MetaTransaction (same calldata on both chains).
    const addOwnerTx = smartAccount.createStandardAddOwnerWithThresholdMetaTransaction(
        newOwnerAddress, 1,
    )

    // 4. Build both UserOps in parallel, then run the paymaster COMMIT
    //    phase on each chain. After commit each op's userOpHash is
    //    committed to its final shape (gas + paymaster fields).
    console.log('[3/7] Building UserOperations...')
    const paymaster1 = new CandidePaymaster(paymasterUrl1)
    const paymaster2 = new CandidePaymaster(paymasterUrl2)
    const expectedSigners = [publicKey] // gas estimator uses WebAuthn dummy sig

    let [userOp1, userOp2] = await Promise.all([
        smartAccount.createUserOperation([addOwnerTx], nodeUrl1, bundlerUrl1, { expectedSigners }),
        smartAccount.createUserOperation([addOwnerTx], nodeUrl2, bundlerUrl2, { expectedSigners }),
    ])

    console.log('[4/7] Paymaster commit on both chains...')
    const commit: CandidePaymasterContext = { signingPhase: 'commit' }
    const [{ userOperation: c1 }, { userOperation: c2 }] = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(smartAccount, userOp1, bundlerUrl1, sponsorshipPolicyId1, commit),
        paymaster2.createSponsorPaymasterUserOperation(smartAccount, userOp2, bundlerUrl2, sponsorshipPolicyId2, commit),
    ])
    userOp1 = c1
    userOp2 = c2

    // 5. Sign both UserOps with one passkey assertion. The method computes
    //    the multi-op EIP-712 hash, hands it to the adapter as the WebAuthn
    //    challenge, and splits the resulting signature into per-op
    //    signatures. `accountClass` locks the adapter to the v0.2.1 module
    //    addresses the on-chain owner is bound to — omit it and the bundler
    //    rejects with "Invalid UserOp signature" (GS026 inside Safe).
    console.log('[5/7] Signing both UserOps with one passkey assertion...')
    const signer = fromSafeWebauthn({
        publicKey,
        isInit: userOp1.nonce === 0n,
        accountClass: SafeMultiChainSigAccountV1,
        getAssertion: async (challenge) => {
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge,
                    rpId: 'candide.dev',
                    allowCredentials: [
                        { type: 'public-key', id: new Uint8Array(credential.rawId) },
                    ],
                    userVerification: UserVerificationRequirement.required,
                },
            })
            return webauthnSignatureFromAssertion(assertion.response)
        },
    })

    const [sig1, sig2] = await smartAccount.signUserOperationsWithSigners(
        [
            { userOperation: userOp1, chainId: chainId1 },
            { userOperation: userOp2, chainId: chainId2 },
        ],
        [signer],
    )
    userOp1.signature = sig1
    userOp2.signature = sig2

    // 6. Paymaster FINALIZE on both chains: paymaster signs over the
    //    owner's signature.
    console.log('[6/7] Paymaster finalize on both chains...')
    const finalize: CandidePaymasterContext = { signingPhase: 'finalize' }
    const [{ userOperation: f1 }, { userOperation: f2 }] = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(smartAccount, userOp1, bundlerUrl1, sponsorshipPolicyId1, finalize),
        paymaster2.createSponsorPaymasterUserOperation(smartAccount, userOp2, bundlerUrl2, sponsorshipPolicyId2, finalize),
    ])
    userOp1 = f1
    userOp2 = f2

    // 7. Submit and wait for inclusion on both chains in parallel.
    console.log('[7/7] Submitting to both chains...')
    await Promise.all([
        sendAndWait(userOp1, bundlerUrl1, 'Chain 1'),
        sendAndWait(userOp2, bundlerUrl2, 'Chain 2'),
    ])

    // Verify owners on both chains.
    const [owners1, owners2] = await Promise.all([
        smartAccount.getOwners(nodeUrl1),
        smartAccount.getOwners(nodeUrl2),
    ])
    const has1 = owners1.map((o: string) => o.toLowerCase()).includes(newOwnerAddress.toLowerCase())
    const has2 = owners2.map((o: string) => o.toLowerCase()).includes(newOwnerAddress.toLowerCase())

    console.log('\n' + '='.repeat(60))
    console.log('Owners on Chain 1:', owners1)
    console.log('Owners on Chain 2:', owners2)
    if (has1 && has2) {
        console.log('\nNew owner added on BOTH chains via a single passkey assertion.')
    } else {
        throw new Error(`Owner not found on one of the chains (chain1=${has1}, chain2=${has2})`)
    }
}

async function sendAndWait(
    userOp: UserOperationV9,
    bundlerUrl: string,
    label: string,
): Promise<void> {
    const account = new SafeMultiChainSigAccountV1(userOp.sender)
    const response = await account.sendUserOperation(userOp, bundlerUrl)
    console.log(`      [${label}] sent — waiting...`)
    const receipt = await response.included()
    if (!receipt) throw new Error(`[${label}] timeout waiting for inclusion`)
    if (!receipt.success) {
        throw new Error(`[${label}] reverted on-chain — tx ${receipt.receipt.transactionHash}`)
    }
    console.log(`      [${label}] ok — tx ${receipt.receipt.transactionHash}`)
}

main().catch((err: unknown) => {
    if (err instanceof AbstractionKitError) {
        console.error('FAILED :', err.code, '-', err.message)
        if (err.context) console.error('Context:', err.context)
        if (err.cause) console.error('Cause  :', err.cause)
    } else {
        console.error(err)
    }
    process.exit(1)
})
