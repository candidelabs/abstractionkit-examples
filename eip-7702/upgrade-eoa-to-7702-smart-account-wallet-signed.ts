import * as dotenv from 'dotenv'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    CandidePaymaster,
    createEip7702DelegationAuthorizationHash,
    createUserOperationHash,
} from "abstractionkit";
import { JsonRpcProvider, toBeHex, Wallet } from 'ethers';

async function main(): Promise<void> {
    try {
        //get values from .env
        dotenv.config();
        const chainId = BigInt(process.env.CHAIN_ID as string)
        const bundlerUrl = process.env.BUNDLER_URL as string
        const nodeUrl = process.env.NODE_URL as string;

        const provider = new JsonRpcProvider(nodeUrl);

        const eoaDelegator = Wallet.createRandom(provider);
        const eoaDelegatorPublicAddress = eoaDelegator.address;
        const paymasterUrl = process.env.PAYMASTER_URL as string;
        const sponsorshipPolicyId = process.env.SPONSORSHIP_POLICY_ID as string;

        // This example demonstrates upgrading an EOA to a 7702 smart account using pre-signed hashes
        // instead of directly passing the private key. This approach is useful when the signing logic
        // is handled separately or when you want more control over the authorization signature.

        // initiate the smart account
        const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress);

        // We will be minting a random NFT on top of upgrading the EOA to a smart account
        const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
        const mintFunctionSignature = 'mint(address)';
        const mintFunctionSelector = getFunctionSelector(mintFunctionSignature);
        const mintTransactionCallData = createCallData(
            mintFunctionSelector,
            ["address"],
            [smartAccount.accountAddress]
        );

        const tx = {
            to: nftContractAddress,
            value: 0n,
            data: mintTransactionCallData,
        }

        let userOperation = await smartAccount.createUserOperation(
            [tx],
            nodeUrl,
            bundlerUrl,
            {
                eip7702Auth: {
                    chainId: chainId,
                }
            }
        );

        const nonce = await eoaDelegator.getNonce();

        const eip7702DelegationAuthorizationHash = createEip7702DelegationAuthorizationHash(
            chainId,
            smartAccount.delegateeAddress,
            BigInt(nonce)
        );

        const signedHash = eoaDelegator.signingKey.sign(
            eip7702DelegationAuthorizationHash,
        );

        userOperation.eip7702Auth = {
            chainId: toBeHex(chainId),
            address: smartAccount.delegateeAddress,
            nonce: toBeHex(nonce),
            yParity: toBeHex(signedHash.yParity),
            r: signedHash.r,
            s: signedHash.s
        };

        const paymaster = new CandidePaymaster(paymasterUrl);

        let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
            userOperation, bundlerUrl, sponsorshipPolicyId)
        userOperation = paymasterUserOperation;

        const userOperationHash = createUserOperationHash(
            userOperation,
            smartAccount.entrypointAddress,
            chainId,
        );

        userOperation.signature = eoaDelegator.signingKey.sign(userOperationHash).serialized;

        let sendUserOperationResponse = await smartAccount.sendUserOperation(
            userOperation, bundlerUrl
        );

        console.log("UserOperation: ", userOperation)
        console.log("UserOperation sent! Waiting for inclusion...");
        console.log("UserOperation hash: ", sendUserOperationResponse.userOperationHash);

        let userOperationReceiptResult = await sendUserOperationResponse.included();

        console.log("UserOperation receipt received.")
        console.log(userOperationReceiptResult)
        if (userOperationReceiptResult.success) {
            console.log("EOA upgraded to a Smart Account and minted NFT! Transaction hash: " + userOperationReceiptResult.receipt.transactionHash)
        } else {
            console.log("UserOperation execution failed")
        }
    } catch (error) {
        console.error("Error:", error);
        throw error;
    }
}

main()
