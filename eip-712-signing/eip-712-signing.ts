/**
 * EIP-712 Signed UserOperation Example
 *
 * This example demonstrates signing a UserOperation via EIP-712 typed data
 * using viem, instead of passing private keys directly to abstractionkit.
 *
 * Use Case: Browser wallet integrations (MetaMask, WalletConnect), hardware
 * wallets (Ledger, Trezor), or any scenario where you don't have direct
 * access to the private key.
 *
 * Manual typed-data path (drive signTypedData yourself):
 * - getUserOperationEip712Data() returns the { domain, types, messageValue }
 *   to sign — useful when you want to inspect/log the structured payload, or
 *   you already have a signTypedData(domain, types, message) primitive.
 * - formatSignaturesToUseroperationSignature() turns the raw EIP-712
 *   signature into the UserOperation signature. The Safe Unified Account
 *   validates single ops through its multi-chain scheme, so pass
 *   `isMultiChainSignature: true`.
 *
 * Prefer not to hand-roll this? Wrap the wallet with `fromViemWalletClient`
 * and call `signUserOperationWithSigners` instead (see signer/).
 */

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { createWalletClient, http, type TypedDataDefinition } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    MetaTransaction,
    CandidePaymaster,
    EIP712_SAFE_OPERATION_PRIMARY_TYPE,
    calculateUserOperationMaxGasCost,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { privateKey: ownerPrivateKey } = getOrCreateOwner()
    const ownerAccount = privateKeyToAccount(ownerPrivateKey as `0x${string}`)

    // Initialize account
    let smartAccount = SafeAccount.initializeNewAccount(
        [ownerAccount.address],
    )

    console.log("Account address(sender) : " + smartAccount.accountAddress)

    // Create a meta transaction to mint an NFT
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
    const mintFunctionSignature = 'mint(address)';
    const mintFunctionSelector = getFunctionSelector(mintFunctionSignature);
    const mintTransactionCallData = createCallData(
        mintFunctionSelector,
        ["address"],
        [smartAccount.accountAddress]
    );
    const transaction1: MetaTransaction = {
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    // Create UserOperation
    let userOperation = await smartAccount.createUserOperation(
        [transaction1],
        nodeUrl,
        bundlerUrl,
    )

    // Sponsor with paymaster
    const paymaster = new CandidePaymaster(paymasterUrl)
    const { userOperation: paymasterUserOperation } = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOperation, bundlerUrl, sponsorshipPolicyId)
    userOperation = paymasterUserOperation;

    const cost = calculateUserOperationMaxGasCost(userOperation)
    console.log("This useroperation may cost upto : " + cost + " wei")

    // Get the EIP-712 typed data for this UserOperation. You can inspect or
    // log this payload — it's exactly what the wallet popup will display.
    const eip712Data = SafeAccount.getUserOperationEip712Data(
        userOperation,
        chainId,
    )

    // Create a viem wallet client. In a browser, this is backed by the
    // injected provider (MetaMask, WalletConnect, ...).
    const walletClient = createWalletClient({
        account: ownerAccount,
        transport: http(nodeUrl)
    });

    // Sign the EIP-712 typed data. In a browser this triggers a wallet popup
    // showing the structured data.
    const signature = await walletClient.signTypedData({
        domain: eip712Data.domain,
        types: eip712Data.types,
        primaryType: EIP712_SAFE_OPERATION_PRIMARY_TYPE,
        message: eip712Data.messageValue,
    } as unknown as TypedDataDefinition);

    // Format the raw EIP-712 signature into the UserOperation signature. The
    // Unified Account validates single ops via the multi-chain scheme, so set
    // isMultiChainSignature: true (without it the bundler rejects the signature).
    userOperation.signature = SafeAccount.formatSignaturesToUseroperationSignature(
        [{ signer: ownerAccount.address, signature }],
        { isMultiChainSignature: true },
    )

    console.log(userOperation)

    // Send the UserOperation
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    )

    console.log("Useroperation sent. Waiting to be included ......")
    let userOperationReceiptResult = await sendUserOperationResponse.included()

    console.log("Useroperation receipt received.")
    console.log(userOperationReceiptResult)
    if (userOperationReceiptResult == null) {
        console.log("Receipt not found (timeout)")
    } else if (userOperationReceiptResult.success) {
        console.log("An Nft was minted. The transaction hash is : " + userOperationReceiptResult.receipt.transactionHash)
    } else {
        console.log("Useroperation execution failed")
    }
}

main()
