import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    createUserOperationHash,
    CandidePaymaster,
} from "abstractionkit";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

// This example demonstrates upgrading an EOA to a 7702 smart account using
// an external signer via abstractionkit's callback pattern. The delegation
// authorization and UserOperation are signed through a viem WalletClient,
// which can be backed by any signer (hardware wallet, WalletConnect, browser
// extension, etc.). Here we use privateKeyToAccount for demonstration, but
// the WalletClient can be swapped for any viem account adapter.

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()

    // Create a viem WalletClient — replace privateKeyToAccount with your
    // preferred account adapter (e.g. JSON-RPC, hardware wallet)
    const walletClient = createWalletClient({
        account: privateKeyToAccount(eoaDelegatorPrivateKey as `0x${string}`),
        chain: arbitrumSepolia,
        transport: http(nodeUrl),
    });

    // Initialize the smart account
    const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress);

    // We will be minting two random NFTs in a single UserOperation
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
    const mintFunctionSelector = getFunctionSelector('mint(address)');
    const mintTransactionCallData = createCallData(
        mintFunctionSelector,
        ["address"],
        [smartAccount.accountAddress]
    );

    const transaction1 = {
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    const transaction2 = {
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    let userOperation = await smartAccount.createUserOperation(
        [
            // You can batch multiple transactions to be executed in one UserOperation
            transaction1, transaction2,
        ],
        nodeUrl,
        bundlerUrl,
        {
            eip7702Auth: {
                chainId: chainId,
            }
        }
    );

    // Sign delegation using abstractionkit's signer callback.
    // The callback receives the authorization hash and returns the signature.
    // This decouples signing from key management — any signer can be plugged in.
    userOperation.eip7702Auth = await createAndSignEip7702DelegationAuthorization(
        BigInt(userOperation.eip7702Auth.chainId),
        userOperation.eip7702Auth.address,
        BigInt(userOperation.eip7702Auth.nonce),
        async (hash: string) => {
            return await walletClient.signMessage({
                message: { raw: hash as `0x${string}` },
            });
        }
    )

    // Sponsor gas with paymaster
    const paymaster = new CandidePaymaster(paymasterUrl);
    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl, sponsorshipPolicyId)
    userOperation = paymasterUserOperation;

    // Sign UserOperation using the same external signer pattern.
    // createUserOperationHash produces the hash, then sign it externally.
    const userOperationHash = createUserOperationHash(
        userOperation,
        smartAccount.entrypointAddress,
        chainId,
    );

    userOperation.signature = await walletClient.signMessage({
        message: { raw: userOperationHash as `0x${string}` },
    });

    console.log("UserOperation:", userOperation)

    let sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    );

    console.log("UserOp sent! Waiting for inclusion...");
    console.log("UserOp hash:", sendUserOperationResponse.userOperationHash);

    let userOperationReceiptResult = await sendUserOperationResponse.included();

    console.log("UserOperation receipt received.")
    console.log(userOperationReceiptResult)
    if (userOperationReceiptResult.success) {
        console.log("EOA upgraded to a Smart Account and minted two NFTs! Transaction hash: " + userOperationReceiptResult.receipt.transactionHash)
    } else {
        console.log("UserOperation execution failed")
    }
}

main()
