import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()

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

    userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
        BigInt(userOperation.eip7702Auth.chainId),
        userOperation.eip7702Auth.address,
        BigInt(userOperation.eip7702Auth.nonce),
        eoaDelegatorPrivateKey
    )

    // Sponsor gas with paymaster
    const paymaster = new CandidePaymaster(paymasterUrl);
    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl, sponsorshipPolicyId)
    userOperation = paymasterUserOperation;

    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        eoaDelegatorPrivateKey,
        chainId,
    );

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
