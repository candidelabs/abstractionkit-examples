/**
 * Key Management with Calibur (EIP-7702)
 *
 * This example demonstrates how to:
 * 1. List all registered keys on the account
 * 2. Register a new secp256k1 key (e.g., a secondary EOA)
 * 3. Sign a transaction with a secondary key (signUserOperation with keyHash)
 * 4. Update a key's settings (change expiration)
 * 5. Revoke a key
 *
 * Calibur supports three key types, each identified by a keyHash:
 * - Secp256k1 (keyType=2): Standard Ethereum EOA keys
 * - WebAuthnP256 (keyType=1): Passkeys / biometric authentication
 * - P256 (keyType=0): Raw secp256r1 keys
 *
 * The root key (EOA's own secp256k1 key) has keyHash = bytes32(0) and is
 * always admin. Registered keys are non-admin by default.
 *
 * Important: Only admin keys can call management functions (register,
 * update, revoke). Non-admin keys can sign regular transactions but
 * cannot modify the account's key configuration.
 *
 * Prerequisites:
 * - EOA already delegated to Calibur (run 01-upgrade-eoa.ts first)
 * - Set up .env (see README)
 * - If PRIVATE_KEY is not set, a new keypair will be generated
 */

import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import {
    Calibur7702Account,
    CandidePaymaster,
    CaliburKeyType,
    ZeroAddress,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    const smartAccount = new Calibur7702Account(publicAddress)
    const paymaster = new CandidePaymaster(paymasterUrl)

    // This example requires an already-delegated account.
    const delegated = await smartAccount.isDelegated(nodeUrl)
    if (!delegated) {
        console.log("This EOA is not yet delegated to Calibur.")
        console.log("Run 01-upgrade-eoa.ts or 02-passkeys.ts first, then re-run this example.")
        return
    }

    // ════════════════════════════════════════════════════════════════════════
    // Step 1: List existing keys
    // ════════════════════════════════════════════════════════════════════════
    console.log("Listing registered keys...\n")

    const keys = await smartAccount.listKeys(nodeUrl)
    const keyTypeNames = { [CaliburKeyType.P256]: 'P256', [CaliburKeyType.WebAuthnP256]: 'WebAuthn', [CaliburKeyType.Secp256k1]: 'Secp256k1' }

    for (const key of keys) {
        const keyHash = Calibur7702Account.getKeyHash(key)
        const settings = await smartAccount.getKeySettings(nodeUrl, keyHash)
        console.log(`  Key: ${keyHash.slice(0, 18)}...`)
        console.log(`    Type: ${keyTypeNames[key.keyType] ?? key.keyType}`)
        console.log(`    Admin: ${settings.isAdmin}`)
        console.log(`    Expires: ${settings.expiration === 0 ? 'never' : new Date(settings.expiration * 1000).toISOString()}`)
        console.log(`    Hook: ${settings.hook === ZeroAddress ? 'none' : settings.hook}`)
        console.log()
    }

    // ════════════════════════════════════════════════════════════════════════
    // Step 2: Register a new secp256k1 key (secondary EOA)
    // ════════════════════════════════════════════════════════════════════════
    // Generate a new keypair to register as a secondary signer.
    // In practice, this would be another user's address or a session key.
    const secondaryPrivateKey = generatePrivateKey()
    const secondaryAddress = privateKeyToAddress(secondaryPrivateKey)
    console.log("Registering secondary key:", secondaryAddress)

    const newKey = Calibur7702Account.createSecp256k1Key(secondaryAddress)
    const newKeyHash = Calibur7702Account.getKeyHash(newKey)

    // Registration returns two transactions (register + update) that must
    // be included in the same UserOperation.
    // This must be signed by an admin key (here: the root EOA key).
    const registerTxs = Calibur7702Account.createRegisterKeyMetaTransactions(
        newKey,
        {
            // Key expires in 30 days
            expiration: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        }
    )

    let registerOp = await smartAccount.createUserOperation(
        registerTxs, nodeUrl, bundlerUrl,
    )
    let [sponsoredRegisterOp] = await paymaster.createSponsorPaymasterUserOperation(
        registerOp, bundlerUrl, sponsorshipPolicyId,
    )
    registerOp = sponsoredRegisterOp
    registerOp.signature = smartAccount.signUserOperation(
        registerOp, privateKey, chainId,
    )

    console.log("Sending registration UserOp...")
    const registerResponse = await smartAccount.sendUserOperation(registerOp, bundlerUrl)
    const registerReceipt = await registerResponse.included()

    if (registerReceipt.success) {
        console.log("Key registered! Tx:", registerReceipt.receipt.transactionHash)
    } else {
        console.log("Registration failed:", registerReceipt)
        return
    }

    // Verify registration
    const isRegistered = await smartAccount.isKeyRegistered(nodeUrl, newKeyHash)
    console.log("Registered on-chain:", isRegistered)

    // ════════════════════════════════════════════════════════════════════════
    // Step 3: Sign a transaction with the secondary key
    // ════════════════════════════════════════════════════════════════════════
    // Non-admin keys can sign regular transactions (just not management calls).
    // signUserOperation accepts a keyHash override to sign with any
    // registered secp256k1 key and wrap the signature automatically.
    console.log("\nSigning a transaction with the secondary key...")

    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintCallData = createCallData(
        getFunctionSelector('mint(address)'),
        ["address"],
        [publicAddress],
    )

    let secondaryOp = await smartAccount.createUserOperation(
        [{ to: nftContractAddress, value: 0n, data: mintCallData }],
        nodeUrl, bundlerUrl,
    )
    let [sponsoredSecondaryOp] = await paymaster.createSponsorPaymasterUserOperation(
        secondaryOp, bundlerUrl, sponsorshipPolicyId,
    )
    secondaryOp = sponsoredSecondaryOp
    secondaryOp.signature = smartAccount.signUserOperation(
        secondaryOp, secondaryPrivateKey, chainId, { keyHash: newKeyHash },
    )

    const secondaryResponse = await smartAccount.sendUserOperation(secondaryOp, bundlerUrl)
    const secondaryReceipt = await secondaryResponse.included()

    if (secondaryReceipt.success) {
        console.log("Transaction signed by secondary key! Tx:", secondaryReceipt.receipt.transactionHash)
    } else {
        console.log("Transaction failed:", secondaryReceipt)
        return
    }

    // ════════════════════════════════════════════════════════════════════════
    // Step 4: Update key settings (extend expiration) — admin only
    // ════════════════════════════════════════════════════════════════════════
    // Only admin keys can update settings. A non-admin key trying to call
    // update() will be rejected with OnlyAdminCanSelfCall.
    console.log("\nUpdating key expiration to 1 year...")

    const updateTx = Calibur7702Account.createUpdateKeySettingsMetaTransaction(
        newKeyHash,
        {
            // Extend to 1 year from now
            expiration: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        }
    )

    let updateOp = await smartAccount.createUserOperation(
        [updateTx], nodeUrl, bundlerUrl,
    )
    let [sponsoredUpdateOp] = await paymaster.createSponsorPaymasterUserOperation(
        updateOp, bundlerUrl, sponsorshipPolicyId,
    )
    updateOp = sponsoredUpdateOp
    updateOp.signature = smartAccount.signUserOperation(
        updateOp, privateKey, chainId,
    )

    const updateResponse = await smartAccount.sendUserOperation(updateOp, bundlerUrl)
    const updateReceipt = await updateResponse.included()

    if (updateReceipt.success) {
        const updatedSettings = await smartAccount.getKeySettings(nodeUrl, newKeyHash)
        console.log("Expiration updated to:", new Date(updatedSettings.expiration * 1000).toISOString())
        console.log("Tx:", updateReceipt.receipt.transactionHash)
    } else {
        console.log("Update failed:", updateReceipt)
        return
    }

    // ════════════════════════════════════════════════════════════════════════
    // Step 5: Revoke the key
    // ════════════════════════════════════════════════════════════════════════
    // Like register and update, revoke requires an admin key signature.
    console.log("\nRevoking the secondary key...")

    const revokeTx = Calibur7702Account.createRevokeKeyMetaTransaction(newKeyHash)

    let revokeOp = await smartAccount.createUserOperation(
        [revokeTx], nodeUrl, bundlerUrl,
    )
    let [sponsoredRevokeOp] = await paymaster.createSponsorPaymasterUserOperation(
        revokeOp, bundlerUrl, sponsorshipPolicyId,
    )
    revokeOp = sponsoredRevokeOp
    revokeOp.signature = smartAccount.signUserOperation(
        revokeOp, privateKey, chainId,
    )

    const revokeResponse = await smartAccount.sendUserOperation(revokeOp, bundlerUrl)
    const revokeReceipt = await revokeResponse.included()

    if (revokeReceipt.success) {
        const stillRegistered = await smartAccount.isKeyRegistered(nodeUrl, newKeyHash)
        console.log("Key still registered:", stillRegistered) // false
        console.log("Tx:", revokeReceipt.receipt.transactionHash)
    } else {
        console.log("Revocation failed:", revokeReceipt)
    }

    // ════════════════════════════════════════════════════════════════════════
    // Final: List keys again
    // ════════════════════════════════════════════════════════════════════════
    console.log("\nFinal key list:")
    const finalKeys = await smartAccount.listKeys(nodeUrl)
    for (const key of finalKeys) {
        const kh = Calibur7702Account.getKeyHash(key)
        console.log(`  ${kh.slice(0, 18)}... (${keyTypeNames[key.keyType] ?? key.keyType})`)
    }
}

main()
