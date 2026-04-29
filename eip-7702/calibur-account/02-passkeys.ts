/**
 * Passkey Authentication with Calibur (EIP-7702)
 *
 * This example demonstrates how to:
 * 1. Delegate the EOA to Calibur if not already delegated (EIP-7702)
 * 2. Register a WebAuthn passkey on a Calibur smart account
 * 3. Execute a transaction signed by that passkey
 *
 * Calibur supports three key types:
 * - Secp256k1 (EOA root key, always available)
 * - WebAuthnP256 (passkeys / biometric)
 * - P256 (raw secp256r1 keys)
 *
 * Each registered key has its own settings: expiration, hook, and admin flag.
 * Non-admin keys cannot call management functions (register/revoke/update).
 *
 * Prerequisites:
 * - Set up .env (see README)
 * - If PRIVATE_KEY is not set, a new keypair will be generated
 *
 * Note: This example uses a simulated WebAuthn authenticator.
 * In a real browser app, use the native navigator.credentials API.
 */

import * as crypto from 'crypto'
import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { toBytes, toHex } from 'viem'
import {
    Calibur7702Account,
    CandidePaymaster,
    createAndSignEip7702DelegationAuthorization,
    getDelegatedAddress,
    getFunctionSelector,
    createCallData,
    WebAuthnSignatureData,
} from "abstractionkit";

import { WebAuthnCredentials, extractPublicKey, extractSignature } from './webauthn-utils'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const smartAccount = new Calibur7702Account(publicAddress)
    const paymaster = new CandidePaymaster(paymasterUrl)

    // Check if the EOA is already delegated to the expected Calibur singleton.
    // isDelegated() returns true only if delegated to this account's delegateeAddress.
    // getDelegatedAddress() returns the raw delegatee address for diagnostics.
    const alreadyDelegated = await smartAccount.isDelegatedToThisAccount(nodeUrl)
    if (!alreadyDelegated) {
        const currentDelegatee = await getDelegatedAddress(publicAddress, nodeUrl);
        if (currentDelegatee) {
            console.log("This EOA is delegated to a different singleton:", currentDelegatee)
            console.log("Expected:", smartAccount.delegateeAddress)
            console.log("Proceeding will re-delegate to the expected singleton.")
        } else {
            console.log("This EOA is not yet delegated. Will delegate as part of the first UserOperation.")
        }
    }

    // Simulated WebAuthn authenticator (use navigator.credentials in browsers)
    const navigator = { credentials: new WebAuthnCredentials() }

    // ════════════════════════════════════════════════════════════════════════
    // Part 1: Register a Passkey
    // ════════════════════════════════════════════════════════════════════════

    // ──────────────────────────────────────────────────────────────────────
    // Step 1.1: Create a WebAuthn credential (passkey)
    // ──────────────────────────────────────────────────────────────────────
    // In a browser, this would trigger a biometric prompt (Face ID, fingerprint, etc.)
    const credential = navigator.credentials.create({
        publicKey: {
            rp: { name: 'Calibur Wallet', id: 'localhost' },
            user: {
                id: crypto.randomBytes(32),
                name: 'demo-user',
                displayName: 'Demo User',
            },
            challenge: crypto.randomBytes(32),
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        },
    })

    // Extract the public key coordinates from the credential
    const { x, y } = extractPublicKey(credential.response)
    console.log("Passkey public key:")
    console.log("  x:", toHex(x))
    console.log("  y:", toHex(y))

    // ──────────────────────────────────────────────────────────────────────
    // Step 1.2: Build the key registration transactions
    // ──────────────────────────────────────────────────────────────────────
    // createWebAuthnP256Key wraps the coordinates into a CaliburKey struct
    const webAuthnKey = Calibur7702Account.createWebAuthnP256Key(x, y)
    const keyHash = Calibur7702Account.getKeyHash(webAuthnKey)
    console.log("Key hash:", keyHash)

    // createRegisterKeyMetaTransactions returns two transactions that MUST
    // be included in the same UserOperation: register() + update().
    // The key is non-admin by default (admin keys require manual encoding).
    const registerTxs = Calibur7702Account.createRegisterKeyMetaTransactions(
        webAuthnKey,
        {
            // Key expires in 1 year. Set to 0 for no expiration.
            expiration: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        }
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 1.3: Create, sign, and send the registration UserOperation
    // ──────────────────────────────────────────────────────────────────────
    // Registration must be signed by the root key (EOA private key),
    // because only admin keys can call management functions.
    // If not yet delegated, include eip7702Auth to delegate in the same UserOp.
    let registerOp = await smartAccount.createUserOperation(
        registerTxs, nodeUrl, bundlerUrl,
        {
            eip7702Auth: alreadyDelegated ? undefined : { chainId },
        },
    )

    if (!alreadyDelegated) {
        if (registerOp.eip7702Auth == null) {
            throw new Error("eip7702Auth is null after createUserOperation")
        }
        registerOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(registerOp.eip7702Auth.chainId),
            registerOp.eip7702Auth.address,
            BigInt(registerOp.eip7702Auth.nonce),
            privateKey,
        )
    }

    const { userOperation: sponsoredRegisterOp } = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, registerOp, bundlerUrl, sponsorshipPolicyId,
    )
    registerOp = sponsoredRegisterOp

    registerOp.signature = smartAccount.signUserOperation(
        registerOp, privateKey, chainId,
    )

    console.log("\nRegistering passkey" + (alreadyDelegated ? "..." : " and delegating EOA..."))
    const registerResponse = await smartAccount.sendUserOperation(registerOp, bundlerUrl)
    const registerReceipt = await registerResponse.included()

    if (registerReceipt == null) {
        console.log("Receipt not found (timeout)")
        return
    }
    if (!registerReceipt.success) {
        console.log("Registration failed:", registerReceipt)
        return
    }
    if (!alreadyDelegated) {
        console.log("EOA delegated to Calibur!")
    }
    console.log("Passkey registered! Tx:", registerReceipt.receipt.transactionHash)

    // Verify the key is registered on-chain
    const isRegistered = await smartAccount.isKeyRegistered(nodeUrl, keyHash)
    console.log("Key registered on-chain:", isRegistered)

    const settings = await smartAccount.getKeySettings(nodeUrl, keyHash)
    console.log("Key settings:", {
        isAdmin: settings.isAdmin,
        expiration: new Date(settings.expiration * 1000).toISOString(),
        hook: settings.hook,
    })

    // ════════════════════════════════════════════════════════════════════════
    // Part 2: Sign a Transaction with the Passkey
    // ════════════════════════════════════════════════════════════════════════

    // ──────────────────────────────────────────────────────────────────────
    // Step 2.1: Create the UserOperation
    // ──────────────────────────────────────────────────────────────────────
    // When signing with a passkey, provide a dummy WebAuthn signature for
    // accurate gas estimation (WebAuthn signatures are larger than ECDSA).
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintFunctionSelector = getFunctionSelector('mint(address)')
    const mintCallData = createCallData(
        mintFunctionSelector,
        ["address"],
        [publicAddress],
    )

    const dummyWebAuthnSig = Calibur7702Account.createDummyWebAuthnSignature(keyHash)

    let userOperation = await smartAccount.createUserOperation(
        [{ to: nftContractAddress, value: 0n, data: mintCallData }],
        nodeUrl,
        bundlerUrl,
        { dummySignature: dummyWebAuthnSig },
    )

    // Sponsor gas before signing (EP v0.8 includes paymaster data in hash)
    const { userOperation: sponsoredUserOperation } = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOperation, bundlerUrl, sponsorshipPolicyId,
    )
    userOperation = sponsoredUserOperation

    // ──────────────────────────────────────────────────────────────────────
    // Step 2.2: Compute the UserOperation hash
    // ──────────────────────────────────────────────────────────────────────
    // This is what the passkey will sign.
    const userOpHash = smartAccount.getUserOperationHash(
        userOperation, chainId,
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 2.3: Sign with the passkey (WebAuthn assertion)
    // ──────────────────────────────────────────────────────────────────────
    // In a browser, this would trigger a biometric prompt.
    const assertion = navigator.credentials.get({
        publicKey: {
            challenge: toBytes(userOpHash as `0x${string}`),
            rpId: 'localhost',
            allowCredentials: [{
                type: 'public-key',
                id: new Uint8Array(credential.rawId),
            }],
        },
    })

    // Extract signature components from the WebAuthn assertion
    const { r, s } = extractSignature(assertion.response)
    const clientDataJSON = new TextDecoder().decode(assertion.response.clientDataJSON)

    const webAuthnSignatureData: WebAuthnSignatureData = {
        authenticatorData: toHex(new Uint8Array(assertion.response.authenticatorData)),
        clientDataJSON,
        challengeIndex: BigInt(clientDataJSON.indexOf('"challenge"')),
        typeIndex: BigInt(clientDataJSON.indexOf('"type"')),
        r,
        s,
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 2.4: Format and set the signature
    // ──────────────────────────────────────────────────────────────────────
    // formatWebAuthnSignature wraps the WebAuthn assertion data into the
    // Calibur signature format: abi.encode(keyHash, webAuthnAuth, hookData)
    userOperation.signature = smartAccount.formatWebAuthnSignature(
        keyHash, webAuthnSignatureData,
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 2.5: Send and wait
    // ──────────────────────────────────────────────────────────────────────
    console.log("\nSending passkey-signed UserOperation...")
    const response = await smartAccount.sendUserOperation(userOperation, bundlerUrl)
    console.log("UserOp hash:", response.userOperationHash)

    const receipt = await response.included()
    if (receipt == null) {
        console.log("Receipt not found (timeout)")
    } else if (receipt.success) {
        console.log("NFT minted with passkey signature!")
        console.log("Transaction:", receipt.receipt.transactionHash)
    } else {
        console.log("UserOperation failed:", receipt)
    }
}

main()
