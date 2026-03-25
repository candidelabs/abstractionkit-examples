/**
 * Upgrade EOA to Calibur Smart Account (EIP-7702)
 *
 * This example demonstrates how to:
 * 1. Delegate an EOA to the Calibur singleton via EIP-7702
 * 2. Batch multiple transactions in a single UserOperation
 * 3. Sponsor gas with CandidePaymaster
 * 4. Sign with a private key string or a signer callback (e.g. viem)
 *
 * After delegation, the EOA address stays the same but gains smart account
 * capabilities: passkey authentication, key management, batch transactions,
 * and gas sponsorship.
 *
 * If PRIVATE_KEY is not set in .env, a new keypair will be generated.
 *
 * Prerequisites:
 * - Set up .env (see README)
 */

import { loadEnv, getOrCreateOwner } from '../../utils/env'
import { privateKeyToAccount } from 'viem/accounts'
import {
    Calibur7702Account,
    CandidePaymaster,
    createAndSignEip7702DelegationAuthorization,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Initialize the Calibur account and CandidePaymaster
    // ──────────────────────────────────────────────────────────────────────
    // The account address is your EOA address. After delegation, it becomes
    // a smart account while keeping the same address.
    const smartAccount = new Calibur7702Account(publicAddress)

    // Check if the EOA is already delegated to Calibur.
    const alreadyDelegated = await smartAccount.isDelegated(nodeUrl)
    if (alreadyDelegated) {
        console.log("This EOA is already delegated to Calibur.")
        console.log("You can run 02-passkeys.ts or 03-manage-keys.ts directly.")
    }

    // CandidePaymaster sponsors gas so the EOA doesn't need native tokens.
    const paymaster = new CandidePaymaster(paymasterUrl)

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
    // Step 3: Create UserOperation with EIP-7702 delegation
    // ──────────────────────────────────────────────────────────────────────
    // eip7702Auth tells the bundler to include a delegation authorization
    // in the transaction. This is only needed for the first UserOperation
    // (to delegate the EOA to the Calibur singleton). If the EOA is already
    // delegated, we skip the authorization.
    let userOperation = await smartAccount.createUserOperation(
        [mintNft1, mintNft2],
        nodeUrl,
        bundlerUrl,
        {
            eip7702Auth: alreadyDelegated ? undefined : { chainId },
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
    // Step 5: Sponsor gas with CandidePaymaster
    // ──────────────────────────────────────────────────────────────────────
    // In EP v0.8, paymaster data is included in the UserOperation hash,
    // so it must be set before signing.
    let [sponsoredUserOperation] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl, sponsorshipPolicyId,
    )
    userOperation = sponsoredUserOperation

    // ──────────────────────────────────────────────────────────────────────
    // Step 6: Sign the UserOperation
    // ──────────────────────────────────────────────────────────────────────
    // Signs with the EOA's root key (secp256k1 private key).
    //
    // Option A: Pass private key string
    userOperation.signature = smartAccount.signUserOperation(
        userOperation, privateKey, chainId,
    )
    // Option B: Use a viem signer callback (reuse viemAccount from Step 4)
    // userOperation.signature = await smartAccount.signUserOperationWithSigner(
    //     userOperation, async (hash) => viemAccount.sign({ hash: hash as `0x${string}` }), chainId,
    // )

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
        console.log("Gas was sponsored by CandidePaymaster.")
        console.log("Transaction:", receipt.receipt.transactionHash)
    } else {
        console.log("UserOperation execution failed")
        console.log(receipt)
    }
}

main()
