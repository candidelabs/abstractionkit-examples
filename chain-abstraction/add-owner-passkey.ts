/**
 * Add Owner Across Chains - Passkey (WebAuthn) Signed Version
 *
 * This example demonstrates signing with a passkey (WebAuthn) for multi-chain
 * operations using Safe Unified Account.
 *
 * Use Case: Secure, phishing-resistant authentication using device biometrics
 * (Face ID, Touch ID, Windows Hello) for cross-chain account management.
 *
 * Key difference from add-owner.ts:
 * - Uses getMultiChainSingleSignatureUserOperationsEip712Hash() to get the hash to sign
 * - Signs with WebAuthn credential (passkey)
 * - Uses formatSignaturesToUseroperationsSignatures() to format the result
 *
 * Learn more: https://docs.candide.dev/account-abstraction/research/safe-unified-account
 */

import { loadMultiChainEnv } from '../utils/env'
import { hexToBytes, keccak256, toBytes, numberToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    CandidePaymaster,
    WebauthnPublicKey,
    WebauthnSignatureData,
    SignerSignaturePair,
    UserOperationV9,
} from "abstractionkit";

import {
    UserVerificationRequirement,
    WebAuthnCredentials,
    extractClientDataFields,
    extractPublicKey,
    extractSignature
} from '../passkeys/webauthn';

async function main(): Promise<void> {
    const { chainId1, chainId2, bundlerUrl1, bundlerUrl2, nodeUrl1, nodeUrl2, paymasterUrl1, paymasterUrl2, sponsorshipPolicyId1, sponsorshipPolicyId2 } = loadMultiChainEnv()

    console.log("=".repeat(60))
    console.log("ADD OWNER - PASSKEY (WEBAUTHN) SIGNED DEMO")
    console.log("=".repeat(60))

    console.log("\n[1/8] Creating WebAuthn credential (passkey)...")

    const navigator = {
        credentials: new WebAuthnCredentials(),
    }

    const credential = navigator.credentials.create({
        publicKey: {
            rp: {
                name: 'Safe',
                id: 'safe.global',
            },
            user: {
                id: hexToBytes(keccak256(toBytes('chain-abstraction-demo'))),
                name: 'demo-user',
                displayName: 'Demo User',
            },
            challenge: numberToBytes(Date.now()),
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        },
    })

    const publicKey = extractPublicKey(credential.response)
    const webauthPublicKey: WebauthnPublicKey = {
        x: publicKey.x,
        y: publicKey.y,
    }

    console.log("  Passkey created!")
    console.log("  Public key X:", publicKey.x.toString().slice(0, 20) + "...")

    const newOwnerAddress = privateKeyToAccount(generatePrivateKey()).address

    console.log("\nPasskey owner (signer):", credential.id.slice(0, 20) + "...")
    console.log("New owner to add:", newOwnerAddress)

    // Initialize Safe Unified Account with passkey as owner
    const smartAccount = SafeAccount.initializeNewAccount([webauthPublicKey])

    console.log("\nSafe Account (same on both chains):", smartAccount.accountAddress)
    console.log("\nTarget chains:")
    console.log("  - Chain 1:", chainId1.toString())
    console.log("  - Chain 2:", chainId2.toString())

    // Create add owner transaction
    const addOwnerTx = smartAccount.createStandardAddOwnerWithThresholdMetaTransaction(
        newOwnerAddress, 1
    );

    // Set up CandidePaymaster for gas sponsorship on both chains
    const paymaster1 = new CandidePaymaster(paymasterUrl1)
    const paymaster2 = new CandidePaymaster(paymasterUrl2)

    console.log("\n[2/8] Creating UserOperations for both chains...")

    let [userOperation1, userOperation2] = await Promise.all([
        smartAccount.createUserOperation(
            [addOwnerTx], nodeUrl1, bundlerUrl1,
        ),
        smartAccount.createUserOperation(
            [addOwnerTx], nodeUrl2, bundlerUrl2,
        ),
    ]);

    console.log("[3/8] Paymaster commit on both chains...")

    const commitOverrides = { context: { signingPhase: "commit" as const } };
    const [[commitOp1], [commitOp2]] = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, userOperation1, bundlerUrl1, sponsorshipPolicyId1, commitOverrides,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, userOperation2, bundlerUrl2, sponsorshipPolicyId2, commitOverrides,
        ),
    ])
    userOperation1 = commitOp1
    userOperation2 = commitOp2

    const userOperationsToSign = [
        { userOperation: userOperation1, chainId: chainId1 },
        { userOperation: userOperation2, chainId: chainId2 }
    ];

    console.log("[4/8] Getting cross-chain EIP-712 hash for signing...")

    const multiChainHash = SafeAccount.getMultiChainSingleSignatureUserOperationsEip712Hash(
        userOperationsToSign
    );

    console.log("  Cross-chain hash:", multiChainHash.slice(0, 20) + "...")

    console.log("[5/8] Signing with passkey (WebAuthn)...")

    const assertion = navigator.credentials.get({
        publicKey: {
            challenge: hexToBytes(multiChainHash as `0x${string}`),
            rpId: 'safe.global',
            allowCredentials: [{ type: 'public-key', id: new Uint8Array(credential.rawId) }],
            userVerification: UserVerificationRequirement.required,
        },
    })

    const webauthSignatureData: WebauthnSignatureData = {
        authenticatorData: assertion.response.authenticatorData,
        clientDataFields: extractClientDataFields(assertion.response),
        rs: extractSignature(assertion.response),
    }

    const webauthSignature = SafeAccount.createWebAuthnSignature(webauthSignatureData)

    console.log("  Passkey signature obtained!")

    const signerSignaturePair: SignerSignaturePair = {
        signer: webauthPublicKey,
        signature: webauthSignature,
    }

    console.log("[6/8] Formatting signatures for both chains...")

    const signatures = SafeAccount.formatSignaturesToUseroperationsSignatures(
        userOperationsToSign,
        [signerSignaturePair],
        { isInit: userOperation1.nonce == 0n, safe4337ModuleAddress: SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS } as any,
    );

    console.log("  Single passkey signature formatted into", signatures.length, "UserOperation signatures")

    userOperation1.signature = signatures[0];
    userOperation2.signature = signatures[1];

    console.log("[7/8] Paymaster finalize on both chains...")

    const finalizeOverrides = { context: { signingPhase: "finalize" as const } };
    const [[finalOp1], [finalOp2]] = await Promise.all([
        paymaster1.createSponsorPaymasterUserOperation(
            smartAccount, userOperation1, bundlerUrl1, sponsorshipPolicyId1, finalizeOverrides,
        ),
        paymaster2.createSponsorPaymasterUserOperation(
            smartAccount, userOperation2, bundlerUrl2, sponsorshipPolicyId2, finalizeOverrides,
        ),
    ])
    userOperation1 = finalOp1
    userOperation2 = finalOp2

    console.log("[8/8] Submitting to both chains...")

    await Promise.all([
        sendAndMonitorUserOperation(userOperation1, bundlerUrl1, "Chain 1"),
        sendAndMonitorUserOperation(userOperation2, bundlerUrl2, "Chain 2"),
    ]);

    // Verify owners on both chains
    console.log("\nVerifying owners on both chains...")

    const [owners1, owners2] = await Promise.all([
        smartAccount.getOwners(nodeUrl1),
        smartAccount.getOwners(nodeUrl2)
    ]);

    console.log("\n" + "=".repeat(60))
    console.log("VERIFICATION COMPLETE")
    console.log("=".repeat(60))
    console.log("\nOwners on Chain 1:", owners1)
    console.log("Owners on Chain 2:", owners2)

    const hasNewOwner1 = owners1.map((o: string) => o.toLowerCase()).includes(newOwnerAddress.toLowerCase())
    const hasNewOwner2 = owners2.map((o: string) => o.toLowerCase()).includes(newOwnerAddress.toLowerCase())

    if (hasNewOwner1 && hasNewOwner2) {
        console.log("\nNew owner successfully added on BOTH chains!")
        console.log("Signed with a single passkey authentication.")
    }
}

async function sendAndMonitorUserOperation(
    userOperation: UserOperationV9,
    bundlerUrl: string,
    chainName: string
): Promise<void> {
    const smartAccount = new SafeAccount(userOperation.sender);
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl,
    )

    console.log(`  [${chainName}] UserOperation sent. Waiting for inclusion...`)
    const receipt = await sendUserOperationResponse.included()

    if (receipt == null) {
        console.log(`  [${chainName}] Receipt not found (timeout)`)
    } else if (receipt.success) {
        console.log(`  [${chainName}] Success! Tx: ${receipt.receipt.transactionHash}`)
    } else {
        console.log(`  [${chainName}] Execution failed`)
    }
}

main().catch(console.error)
