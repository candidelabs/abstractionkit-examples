import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702AccountV09 as Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    ExperimentalAllowAllParallelPaymaster,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl } = loadEnv()
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()

    // Initialize the smart account
    const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress);

    // Create a mint transaction — we'll batch two of these in a single UserOperation
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
    const mintFunctionSelector = getFunctionSelector("mint(address)");
    const mintTransaction = {
        to: nftContractAddress,
        value: 0n,
        data: createCallData(
            mintFunctionSelector,
            ["address"],
            [smartAccount.accountAddress],
        ),
    };

    // Fetch paymaster init values
    const paymaster = new ExperimentalAllowAllParallelPaymaster();
    const paymasterInitFields = await paymaster.getPaymasterFieldsInitValues(chainId);

    const userOperation = await smartAccount.createUserOperation(
        [mintTransaction, mintTransaction],
        nodeUrl,
        bundlerUrl,
        {
            parallelPaymasterInitValues: paymasterInitFields,
            eip7702Auth: {
                chainId: chainId,
            },
        },
    );

    userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
        BigInt(userOperation.eip7702Auth.chainId),
        userOperation.eip7702Auth.address,
        BigInt(userOperation.eip7702Auth.nonce),
        eoaDelegatorPrivateKey,
    );

    const [signature, paymasterData] = await Promise.all([
        smartAccount.signUserOperation(
            userOperation,
            eoaDelegatorPrivateKey,
            chainId,
        ),
        paymaster.getApprovedPaymasterData(userOperation),
    ]);

    userOperation.signature = signature;
    userOperation.paymasterData = paymasterData;

    console.log("UserOperation:", userOperation);

    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl,
    );

    console.log("UserOp sent! Waiting for inclusion...");
    console.log("UserOp hash:", sendUserOperationResponse.userOperationHash);

    const userOperationReceiptResult = await sendUserOperationResponse.included();

    console.log("UserOperation receipt received.");
    console.log(userOperationReceiptResult);
    if (userOperationReceiptResult.success) {
        console.log("EOA upgraded to a Smart Account and minted two NFTs! Transaction hash: " + userOperationReceiptResult.receipt.transactionHash);
    } else {
        console.log("UserOperation execution failed");
    }
}

main().catch(console.error);
