/**
 * Passkey-owned Safe Account — sponsored UserOp on a single chain.
 *
 * Account class : SafeAccountV0_3_0
 * Signing method: signUserOperationWithSigners(op, signers, chainId)
 * Signer adapter: fromSafeWebauthn (no manual hash → assertion → format dance)
 * Paymaster     : CandidePaymaster (sponsored)
 *
 * The adapter handles both isInit phases of the Safe Passkeys flow:
 *  - isInit=true  → signer.address = shared signer (used during the deployment op)
 *  - isInit=false → signer.address = deterministic verifier-proxy (used afterwards)
 * Pass `isInit` based on `userOp.nonce === 0n` (or persist it next to the
 * account address on first deploy and read it back on subsequent ops).
 *
 * WebAuthn note: this script uses `webauthn.ts`'s simulator so it runs in
 * node. In a browser, replace `navigator.credentials.create/get` with
 * `window.navigator.credentials` and `webauthnSignatureFromAssertion`
 * with the same call against a real `AuthenticatorAssertionResponse`.
 * The browser APIs are async (return Promises), so the calls below use
 * `await` — harmless against the sync simulator, required in a real
 * browser.
 */

import {
    AbstractionKitError,
    CandidePaymaster,
    SafeAccountV0_3_0 as SafeAccount,
    createCallData,
    fromSafeWebauthn,
    getFunctionSelector,
    pubkeyCoordinatesFromJson,
    pubkeyCoordinatesToJson,
    webauthnSignatureFromAssertion,
    type WebauthnPublicKey,
} from 'abstractionkit'
import { hexToBytes, keccak256, numberToBytes, toBytes } from 'viem'

import { loadEnv } from '../utils/env'
import {
    UserVerificationRequirement,
    WebAuthnCredentials,
    extractPublicKey,
} from './webauthn'

// Optional: Safe Passkeys contract overrides. Pin a specific module
// version by setting these and passing them to BOTH `initializeNewAccount`
// and `fromSafeWebauthn` (and `createUserOperation` when not relying on
// SafeAccountV0_3_0's defaults). Leave undefined to use abstractionkit's
// defaults — that's what this example does.
//
// Concrete values for Safe Passkeys v0.2.1 on Arbitrum Sepolia:
//
// const passkeyOverrides = {
//     webAuthnSharedSigner:            '0x94a4F6affBd8975951142c3999aEAB7ecee555c2',
//     webAuthnSignerFactory:           '0x1d31F259eE307358a26dFb23EB365939E8641195',
//     webAuthnSignerSingleton:         '0x4E27b51350e6c2083EE19011120F50DAfEc5CA50',
//     eip7212WebAuthnContractVerifier: '0xA86e0054C51E4894D88762a017ECc5E5235f5DBA',
//     webAuthnSignerProxyCreationCode: '0x610100346100ad57601f6101b538819003918201601f19168301916001600160401b038311848410176100b2578084926080946040528339810103126100ad578051906001600160a01b03821682036100ad5760208101516040820151606090920151926001600160b01b03841684036100ad5760805260a05260c05260e05260405160ec90816100c98239608051816082015260a05181604d015260c051816027015260e0518160010152f35b600080fd5b634e487b7160e01b600052604160045260246000fdfe7f000000000000000000000000000000000000000000000000000000000000000060b63601527f000000000000000000000000000000000000000000000000000000000000000060a03601527f000000000000000000000000000000000000000000000000000000000000000036608001523660006080376000806056360160807f00000000000000000000000000000000000000000000000000000000000000005af43d600060803e60b1573d6080fd5b3d6080f3fea26469706673582212201660515548d15702d720bbc046b457ca85e941a4559ab9f9518488e4c82e5ee964736f6c634300081a0033',
// }

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()

    // 1. Create a passkey credential. In a browser, `navigator` is the
    //    global `window.navigator`; here we use the simulator from
    //    `webauthn.ts` so the example runs end-to-end in node.
    const navigator = { credentials: new WebAuthnCredentials() }
    const credential = await navigator.credentials.create({
        publicKey: {
            rp: { name: 'Candide', id: 'candide.dev' },
            user: {
                id: hexToBytes(keccak256(toBytes('chucknorris'))),
                name: 'chucknorris',
                displayName: 'Chuck Norris',
            },
            challenge: numberToBytes(Date.now()),
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        },
    })

    // Round-trip the pubkey through JSON to mirror a real app persisting
    // it (localStorage, server index, etc.) — this is the path that turns
    // bigints into strings and would trip fromSafeWebauthn's bigint guard
    // if you skipped pubkeyCoordinatesFromJson on rehydration.
    const persisted = pubkeyCoordinatesToJson(extractPublicKey(credential.response))
    const publicKey: WebauthnPublicKey = pubkeyCoordinatesFromJson(persisted)

    // 2. Initialize the Safe Account with the passkey as owner. For
    //    subsequent ops (account already deployed), use
    //    `new SafeAccount(accountAddress)` instead.
    const smartAccount = SafeAccount.initializeNewAccount([publicKey])
    console.log('Account :', smartAccount.accountAddress)

    // 3. Build a MetaTransaction: mint an NFT to the Safe.
    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintData = createCallData(
        getFunctionSelector('mint(address)'),
        ['address'],
        [smartAccount.accountAddress],
    )

    // 4. Assemble the UserOperation. `expectedSigners` makes the bundler
    //    estimator size verification gas with a realistic WebAuthn dummy
    //    signature — required for passkey signers, otherwise gas estimation
    //    under-counts and the op reverts on submission.
    let userOp = await smartAccount.createUserOperation(
        [{ to: nft, value: 0n, data: mintData }],
        nodeUrl, bundlerUrl,
        { expectedSigners: [publicKey] },
    )

    // 5. Sponsor gas via Candide paymaster.
    const paymaster = new CandidePaymaster(paymasterUrl)
    const { userOperation: sponsoredOp } = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl, sponsorshipPolicyId,
    )
    userOp = sponsoredOp

    // 6. Build the WebAuthn signer. The adapter exposes `signHash(hash)`
    //    internally; abstractionkit hashes the UserOp and feeds the result
    //    to `getAssertion` as the WebAuthn challenge.
    const isInit = userOp.nonce === 0n
    const signer = fromSafeWebauthn({
        publicKey,
        isInit,
        accountClass: SafeAccount,
        getAssertion: async (challenge) => {
            // In a browser this is a real biometric prompt. The challenge
            // is the userOpHash bytes; userVerification: 'required' forces
            // the platform authenticator (Touch ID / Face ID / Windows Hello).
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

    // 7. Sign the UserOp via the adapter.
    userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp, [signer], chainId,
    )

    // 8. Send and wait for on-chain inclusion.
    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp  :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx      :', receipt.receipt.transactionHash)
    console.log('Success :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
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
