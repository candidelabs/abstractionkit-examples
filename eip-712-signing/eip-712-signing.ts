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
 * Key difference from sponsor-gas.ts:
 * - Uses getUserOperationEip712Data() to get typed data for signing
 * - Signs with viem's walletClient.signTypedData()
 * - Uses formatEip712SingleSignatureToUseroperationSignature() to format the result
 */

import { loadEnv, getOrCreateOwner } from '../utils/env'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
    SafeAccountV0_3_0 as SafeAccount,
    MetaTransaction,
    CandidePaymaster,
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

    // Get EIP-712 typed data for signing
    const eip712Data = SafeAccount.getUserOperationEip712Data(
        userOperation,
        chainId,
    )

    console.log("EIP-712 domain:", JSON.stringify(eip712Data.domain, bigIntReplacer))

    // Create a viem wallet client
    // In a browser, this would be connected to MetaMask, WalletConnect, etc.
    const walletClient = createWalletClient({
        account: ownerAccount,
        transport: http(nodeUrl)
    });

    // Sign the EIP-712 typed data
    // In a browser, this would trigger a wallet popup showing the structured data
    const signature = await walletClient.signTypedData({
        domain: eip712Data.domain as Parameters<typeof walletClient.signTypedData>[0]['domain'],
        types: eip712Data.types,
        primaryType: 'SafeOp',
        message: eip712Data.messageValue as unknown as Record<string, unknown>
    });

    console.log("EIP-712 signature obtained:", signature.slice(0, 20) + "...")

    // Format the EIP-712 signature for the UserOperation
    userOperation.signature = SafeAccount.formatEip712SingleSignatureToUseroperationSignature(
        signature,
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

// Helper to serialize BigInt values in JSON
function bigIntReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

main()
