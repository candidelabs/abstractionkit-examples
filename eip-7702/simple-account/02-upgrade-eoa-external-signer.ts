import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    createUserOperationHash,
    CandidePaymaster,
} from "abstractionkit";
import { privateKeyToAccount } from "viem/accounts";

// This example demonstrates upgrading an EOA to a 7702 smart account using
// an external signer via abstractionkit's callback pattern. The delegation
// authorization and UserOperation are signed through a viem Account, which
// can be backed by any signer (hardware wallet, WalletConnect, browser
// extension, etc.). Here we use privateKeyToAccount for demonstration, but
// it can be swapped for any viem account adapter (e.g. toAccount() for
// custom signers).
//
// Key difference from 01-upgrade-eoa.ts: signing uses account.sign() (raw
// hash signing) instead of passing private keys directly to abstractionkit.

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()

    // Create a viem Account — replace privateKeyToAccount with your
    // preferred account adapter (e.g. toAccount() for custom signers)
    const account = privateKeyToAccount(eoaDelegatorPrivateKey as `0x${string}`);

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
    // The callback receives the raw authorization hash and returns the signature.
    // This decouples signing from key management — any signer can be plugged in.
    // Important: use account.sign() for raw hash signing, NOT signMessage()
    // which adds an EIP-191 prefix and produces a different recovered address.
    userOperation.eip7702Auth = await createAndSignEip7702DelegationAuthorization(
        BigInt(userOperation.eip7702Auth.chainId),
        userOperation.eip7702Auth.address,
        BigInt(userOperation.eip7702Auth.nonce),
        async (hash: string) => {
            const sig = await account.sign({ hash: hash as `0x${string}` });
            return sig;
        }
    )

    // Sponsor gas with paymaster
    const paymaster = new CandidePaymaster(paymasterUrl);
    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl, sponsorshipPolicyId)
    userOperation = paymasterUserOperation;

    // Sign UserOperation using the same external signer pattern.
    // createUserOperationHash produces the hash, then sign it with account.sign().
    const userOperationHash = createUserOperationHash(
        userOperation,
        smartAccount.entrypointAddress,
        chainId,
    );

    userOperation.signature = await account.sign({ hash: userOperationHash as `0x${string}` });

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
