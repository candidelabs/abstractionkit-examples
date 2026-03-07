/**
 * Upgrade EOA to Calibur Smart Account (EIP-7702)
 *
 * This example demonstrates how to:
 * 1. Delegate an EOA to the Calibur singleton via EIP-7702
 * 2. Batch multiple transactions in a single UserOperation
 * 3. Sponsor gas with AllowAllPaymaster
 * 4. Sign with a private key string or a signer callback (e.g. viem)
 *
 * After delegation, the EOA address stays the same but gains smart account
 * capabilities: passkey authentication, key management, batch transactions,
 * and gas sponsorship.
 *
 * AllowAllPaymaster is a development/testing paymaster that sponsors all
 * UserOperations unconditionally. In EntryPoint v0.9, the paymaster
 * signature is excluded from the UserOperation hash — you can sign
 * the UserOperation first, then set the paymaster data after.
 *
 * If PRIVATE_KEY is not set in .env, a new keypair will be generated.
 *
 * Prerequisites:
 * - Set up .env (see README)
 * - If not using AllowAllPaymaster, fund your EOA with some ETH
 */

import * as dotenv from 'dotenv'
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from 'viem/accounts'
import {
    Calibur7702Account,
    AllowAllPaymaster,
    CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS,
    createAndSignEip7702DelegationAuthorization,
    getFunctionSelector,
    createCallData,
    ENTRYPOINT_V9,
} from "abstractionkit";

async function main(): Promise<void> {
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const nodeUrl = process.env.NODE_URL as string

    // Generate a new keypair if PRIVATE_KEY is not set
    let privateKey = process.env.PRIVATE_KEY as string
    let publicAddress = process.env.PUBLIC_ADDRESS as string

    if (!privateKey) {
        privateKey = generatePrivateKey()
        publicAddress = privateKeyToAddress(privateKey as `0x${string}`)
        console.log("No PRIVATE_KEY found in .env — generated a new keypair.")
        console.log("Address:", publicAddress)
        console.log("Private key:", privateKey)
        console.log("Save these to your .env to reuse this account.\n")
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Initialize the Calibur account and AllowAllPaymaster
    // ──────────────────────────────────────────────────────────────────────
    // The account address is your EOA address. After delegation, it becomes
    // a smart account while keeping the same address.
    //
    // Calibur7702Account defaults to EntryPoint v0.8 (canonical Calibur).
    // We override to EntryPoint v0.9 here to use AllowAllPaymaster, which
    // is deployed on v0.9. The v0.9 singleton also enables parallel signing
    // (paymaster data is excluded from the UserOperation hash).
    const smartAccount = new Calibur7702Account(publicAddress, {
        entrypointAddress: ENTRYPOINT_V9,
        delegateeAddress: CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS,
    })

    // Check if the EOA is already delegated to Calibur.
    const alreadyDelegated = await smartAccount.isDelegated(nodeUrl);
    console.log(alreadyDelegated, "alreadyDelegated");
    if (alreadyDelegated) {
        console.log("This EOA is already delegated to Calibur.")
        console.log("You can run 02-passkeys.ts or 03-manage-keys.ts directly.")
    }

    // AllowAllPaymaster sponsors gas unconditionally (for dev/testing).
    // Uses the canonical deployment address by default.
    const paymaster = new AllowAllPaymaster()
    const paymasterFields = await paymaster.getPaymasterFieldsInitValues(chainId)

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Build transactions
    // ──────────────────────────────────────────────────────────────────────
    // We'll batch-mint two NFTs in a single UserOperation to demonstrate
    // the smart account's batching capability.
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintFunctionSelector = getFunctionSelector('mint(address)')
    const mintCallData = createCallData(
        mintFunctionSelector,
        ["address"],
        [publicAddress],
    )

    const mintNft1 = { to: nftContractAddress, value: 0n, data: mintCallData }
    const mintNft2 = { to: nftContractAddress, value: 0n, data: mintCallData }

    // ──────────────────────────────────────────────────────────────────────
    // Step 3: Create UserOperation with EIP-7702 delegation + paymaster
    // ──────────────────────────────────────────────────────────────────────
    // eip7702Auth tells the bundler to include a delegation authorization
    // in the transaction. This is only needed for the first UserOperation
    // (to delegate the EOA to the Calibur singleton). If the EOA is already
    // delegated, we skip the authorization.
    //
    // paymasterFields are included during creation so that gas estimation
    // accounts for the extra paymaster data bytes.
    let userOperation = await smartAccount.createUserOperation(
        [mintNft1, mintNft2],
        nodeUrl,
        bundlerUrl,
        {
            eip7702Auth: alreadyDelegated ? undefined : { chainId },
            paymasterFields,
        },
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 4: Sign the EIP-7702 delegation authorization
    // ──────────────────────────────────────────────────────────────────────
    // This authorizes the EOA to delegate to the Calibur singleton address.
    // Only needed on the first UserOperation (when not yet delegated).
    //
    // You can pass the private key directly, or use a signer callback for
    // external signers (viem, hardware wallets, MPC, etc.)
    //
    // Option A: Pass private key string
    if (!alreadyDelegated) {
        userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            privateKey,
        )
    }
    // Option B: Use a viem signer callback (private key never leaves the client)
    // const viemAccount = privateKeyToAccount(privateKey as `0x${string}`)
    // if (!alreadyDelegated) {
    //     userOperation.eip7702Auth = await createAndSignEip7702DelegationAuthorization(
    //         BigInt(userOperation.eip7702Auth.chainId),
    //         userOperation.eip7702Auth.address,
    //         BigInt(userOperation.eip7702Auth.nonce),
    //         async (hash) => viemAccount.sign({ hash: hash as `0x${string}` }),
    //     )
    // }

    // ──────────────────────────────────────────────────────────────────────
    // Step 5: Sign the UserOperation
    // ──────────────────────────────────────────────────────────────────────
    // Signs with the EOA's root key (secp256k1 private key).
    // In v0.9, paymaster data is excluded from the hash, so you can sign
    // first and set paymaster data after.
    //
    // Option A: Pass private key string
    userOperation.signature = smartAccount.signUserOperation(
        userOperation, privateKey, chainId,
    )
    // Option B: Use a viem signer callback
    // userOperation.signature = await smartAccount.signUserOperation(
    //     userOperation, async (hash) => viemAccount.sign({ hash: hash as `0x${string}` }), chainId,
    // )

    // ──────────────────────────────────────────────────────────────────────
    // Step 6: Set the approved paymaster data
    // ──────────────────────────────────────────────────────────────────────
    // This can be set during or after signing because v0.9 excludes paymaster data
    // from the UserOperation hash (parallel signing).
    userOperation.paymasterData = await paymaster.getApprovedPaymasterData(
        userOperation,
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 7: Send and wait for inclusion
    // ──────────────────────────────────────────────────────────────────────
    console.log("Sending sponsored UserOperation...")
    const response = await smartAccount.sendUserOperation(userOperation, bundlerUrl)
    console.log("UserOp hash:", response.userOperationHash)

    const receipt = await response.included()

    if (receipt.success) {
        if (!alreadyDelegated) {
            console.log("EOA upgraded to Calibur smart account!")
        }
        console.log("Minted 2 NFTs in a single batched UserOperation!")
        console.log("Gas was paid by the AllowAllPaymaster, not by the EOA.")
        console.log("Transaction:", receipt.receipt.transactionHash)
    } else {
        console.log("UserOperation execution failed")
        console.log(receipt)
    }
}

main()
