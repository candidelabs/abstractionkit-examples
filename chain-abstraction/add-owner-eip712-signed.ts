/**
 * Add Owner Across Chains - Wallet-Signed Version
 *
 * This example demonstrates signing with an external wallet (EIP-712 typed data)
 * instead of passing private keys directly to abstractionkit.
 *
 * Use Case: Browser wallet integrations (MetaMask, WalletConnect), hardware
 * wallets (Ledger, Trezor), or any scenario where you don't have direct
 * access to the private key.
 *
 * Key difference from add-owner.ts:
 * - Uses getMultiChainSingleSignatureUserOperationsEip712Data() to get typed data
 * - Signs with viem's walletClient.signTypedData()
 * - Uses formatSignaturesToUseroperationsSignatures() to format the result
 *
 * Learn more: https://docs.candide.dev/account-abstraction/research/safe-unified-account
 */

import { loadMultiChainEnv, getOrCreateOwner } from '../utils/env'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import {
    ExperimentalSafeMultiChainSigAccount as SafeAccount,
    ExperimentalAllowAllParallelPaymaster,
    UserOperationV9,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId1, chainId2, bundlerUrl1, bundlerUrl2, nodeUrl1, nodeUrl2 } = loadMultiChainEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()
    const ownerAccount = privateKeyToAccount(ownerPrivateKey as `0x${string}`)

    // Generate a new owner address to add
    const newOwnerAccount = privateKeyToAccount(generatePrivateKey())
    const newOwnerAddress = process.env.NEW_OWNER_ADDRESS || newOwnerAccount.address

    console.log("=".repeat(60))
    console.log("ADD OWNER - WALLET-SIGNED (EIP-712) DEMO")
    console.log("=".repeat(60))
    console.log("\nOriginal owner:", ownerPublicAddress)
    console.log("New owner to add:", newOwnerAddress)

    // Initialize Safe Unified Account
    const smartAccount = SafeAccount.initializeNewAccount([ownerPublicAddress])

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

    console.log("\n[1/4] Creating UserOperations for both chains...")

    const [userOperation1, userOperation2] = await Promise.all([
        smartAccount.createUserOperation(
            [addOwnerTx],
            nodeUrl1,
            bundlerUrl1,
            {
                parallelPaymasterInitValues: paymasterInitFields1,
                preVerificationGasPercentageMultiplier: 120
            }
        ),
        smartAccount.createUserOperation(
            [addOwnerTx],
            nodeUrl2,
            bundlerUrl2,
            {
                parallelPaymasterInitValues: paymasterInitFields2,
                preVerificationGasPercentageMultiplier: 120
            }
        ),
    ]);

    // Prepare the UserOperations to sign
    const userOperationsToSign = [
        { userOperation: userOperation1, chainId: chainId1 },
        { userOperation: userOperation2, chainId: chainId2 }
    ];

    console.log("[2/4] Getting EIP-712 typed data for signing...")

    // Get EIP-712 typed data structure (instead of signing directly with private key)
    const eip712Data = SafeAccount.getMultiChainSingleSignatureUserOperationsEip712Data(
        userOperationsToSign
    );

    console.log("  Domain:", JSON.stringify(eip712Data.domain, bigIntReplacer))
    console.log("  Primary type: MerkleTreeRoot")

    console.log("[3/4] Signing with wallet (EIP-712 signTypedData)...")

    // Create a wallet client (in a real app, this would be MetaMask, WalletConnect, etc.)
    const walletClient = createWalletClient({
        account: ownerAccount,
        chain: sepolia,
        transport: http()
    });

    // Sign the EIP-712 typed data
    // In a browser, this would trigger a wallet popup
    const signature = await walletClient.signTypedData({
        domain: eip712Data.domain as Parameters<typeof walletClient.signTypedData>[0]['domain'],
        types: eip712Data.types,
        primaryType: 'MerkleTreeRoot',
        message: eip712Data.messageValue as unknown as Record<string, unknown>
    });

    console.log("  Signature obtained:", signature.slice(0, 20) + "...")

    // Format the single signature into per-UserOperation signatures
    // Note: safe4337ModuleAddress must be passed to ensure the merkle proof
    // is computed with the same module address used during EIP-712 data generation
    const signatures = SafeAccount.formatSignaturesToUseroperationsSignatures(
        userOperationsToSign,
        [{ signer: ownerPublicAddress, signature }],
        { safe4337ModuleAddress: eip712Data.domain.verifyingContract } as any,
    );

    console.log("  Formatted into", signatures.length, "UserOperation signatures")

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

    console.log("[4/4] Submitting to both chains...")

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
        console.log("Signed with EIP-712 typed data (wallet-compatible).")
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
        bundlerUrl
    )

    console.log(`  [${chainName}] UserOperation sent. Waiting for inclusion...`)
    const receipt = await sendUserOperationResponse.included()

    if (receipt.success) {
        console.log(`  [${chainName}] Success! Tx: ${receipt.receipt.transactionHash}`)
    } else {
        console.log(`  [${chainName}] Execution failed`)
    }
}

// Helper to serialize BigInt values in JSON
function bigIntReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

main().catch(console.error)
