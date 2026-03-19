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

import * as dotenv from 'dotenv'
import { hexToBytes, keccak256, toBytes, numberToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import {
    ExperimentalSafeMultiChainSigAccount as SafeAccount,
    ExperimentalAllowAllParallelPaymaster,
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
    dotenv.config()

    // Chain configuration - set in .env (see .env.example)
    const chainId1 = BigInt(process.env.CHAIN_ID1 as string)
    const chainId2 = BigInt(process.env.CHAIN_ID2 as string)
    const bundlerUrl1 = process.env.BUNDLER_URL1 as string
    const bundlerUrl2 = process.env.BUNDLER_URL2 as string
    const nodeUrl1 = process.env.NODE_URL1 as string
    const nodeUrl2 = process.env.NODE_URL2 as string

    console.log("=".repeat(60))
    console.log("ADD OWNER - PASSKEY (WEBAUTHN) SIGNED DEMO")
    console.log("=".repeat(60))

    // Create a WebAuthn credential (passkey)
    // In a browser, this would trigger device biometrics (Face ID, Touch ID, etc.)
    console.log("\n[1/6] Creating WebAuthn credential (passkey)...")

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

    // Extract the public key from the credential
    const publicKey = extractPublicKey(credential.response)
    const webauthPublicKey: WebauthnPublicKey = {
        x: publicKey.x,
        y: publicKey.y,
    }

    console.log("  Passkey created!")
    console.log("  Public key X:", publicKey.x.toString().slice(0, 20) + "...")

    // Generate a new owner address to add (using random address for demo)
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
        newOwnerAddress,
        1
    );

    // Set up ExperimentalAllowAllParallelPaymaster for gas sponsorship
    const paymaster = new ExperimentalAllowAllParallelPaymaster();

    const [paymasterInitFields1, paymasterInitFields2] = await Promise.all([
        paymaster.getPaymasterFieldsInitValues(chainId1),
        paymaster.getPaymasterFieldsInitValues(chainId2),
    ]);

    console.log("\n[2/6] Creating UserOperations for both chains...")

    const [userOperation1, userOperation2] = await Promise.all([
        smartAccount.createUserOperation(
            [addOwnerTx],
            nodeUrl1,
            bundlerUrl1,
            {
                parallelPaymasterInitValues: paymasterInitFields1,
                preVerificationGasPercentageMultiplier: 120,
                verificationGasLimitPercentageMultiplier: 150,
            }
        ),
        smartAccount.createUserOperation(
            [addOwnerTx],
            nodeUrl2,
            bundlerUrl2,
            {
                parallelPaymasterInitValues: paymasterInitFields2,
                preVerificationGasPercentageMultiplier: 120,
                verificationGasLimitPercentageMultiplier: 150,
            }
        ),
    ]);

    // Prepare the UserOperations to sign
    const userOperationsToSign = [
        { userOperation: userOperation1, chainId: chainId1 },
        { userOperation: userOperation2, chainId: chainId2 }
    ];

    console.log("[3/6] Getting cross-chain EIP-712 hash for signing...")

    // Get the single hash that covers all chains
    const multiChainHash = SafeAccount.getMultiChainSingleSignatureUserOperationsEip712Hash(
        userOperationsToSign
    );

    console.log("  Cross-chain hash:", multiChainHash.slice(0, 20) + "...")

    console.log("[4/6] Signing with passkey (WebAuthn)...")

    // Sign the cross-chain hash with the passkey
    // In a browser, this would trigger device biometrics
    const assertion = navigator.credentials.get({
        publicKey: {
            challenge: hexToBytes(multiChainHash as `0x${string}`),
            rpId: 'safe.global',
            allowCredentials: [{ type: 'public-key', id: new Uint8Array(credential.rawId) }],
            userVerification: UserVerificationRequirement.required,
        },
    })

    // Extract signature data from WebAuthn assertion
    const webauthSignatureData: WebauthnSignatureData = {
        authenticatorData: assertion.response.authenticatorData,
        clientDataFields: extractClientDataFields(assertion.response),
        rs: extractSignature(assertion.response),
    }

    // Create the WebAuthn signature format
    const webauthSignature = SafeAccount.createWebAuthnSignature(webauthSignatureData)

    console.log("  Passkey signature obtained!")

    // Create signer-signature pair
    const signerSignaturePair: SignerSignaturePair = {
        signer: webauthPublicKey,
        signature: webauthSignature,
    }

    console.log("[5/6] Formatting signatures for both chains...")

    // Format the single passkey signature into per-UserOperation signatures
    // isInit is required for WebAuthn signatures - true for first tx (account deployment)
    const signatures = SafeAccount.formatSignaturesToUseroperationsSignatures(
        userOperationsToSign,
        [signerSignaturePair],
        { isInit: userOperation1.nonce == 0n }
    );

    console.log("  Single passkey signature formatted into", signatures.length, "UserOperation signatures")

    // Apply signatures
    userOperation1.signature = signatures[0];
    userOperation2.signature = signatures[1];

    // Get paymaster data
    const [paymasterData1, paymasterData2] = await Promise.all([
        paymaster.getApprovedPaymasterData(userOperation1),
        paymaster.getApprovedPaymasterData(userOperation2)
    ]);

    userOperation1.paymasterData = paymasterData1;
    userOperation2.paymasterData = paymasterData2;

    console.log("[6/6] Submitting to both chains...")

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

    const hasNewOwner1 = owners1.map(o => o.toLowerCase()).includes(newOwnerAddress.toLowerCase())
    const hasNewOwner2 = owners2.map(o => o.toLowerCase()).includes(newOwnerAddress.toLowerCase())

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
        userOperation,
        bundlerUrl,
    )

    console.log(`  [${chainName}] UserOperation sent. Waiting for inclusion...`)
    const receipt = await sendUserOperationResponse.included()

    if (receipt.success) {
        console.log(`  [${chainName}] Success! Tx: ${receipt.receipt.transactionHash}`)
    } else {
        console.log(`  [${chainName}] Execution failed`)
    }
}

main().catch(console.error)
