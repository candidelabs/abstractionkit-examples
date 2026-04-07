import { loadEnv } from '../utils/env'
import {
    SafeAccountV0_3_0 as SafeAccount,
    MetaTransaction,
    calculateUserOperationMaxGasCost,
    getFunctionSelector,
    createCallData,
    CandidePaymaster,
} from "abstractionkit";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()


    const owner1PrivateKey = generatePrivateKey();
    const owner1 = privateKeyToAccount(owner1PrivateKey);
    const owner2PrivateKey = generatePrivateKey();
    const owner2 = privateKeyToAccount(owner2PrivateKey);

    //initializeNewAccount only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object for the following useroperations
    let smartAccount = SafeAccount.initializeNewAccount(
        [owner1.address, owner2.address],
        {
            threshold: 2
        }
    )

    //After the account contract is deployed, no need to call initializeNewAccount
    //let smartAccount = new SafeAccount(accountAddress)

    console.log("Account address(sender) : " + smartAccount.accountAddress)

    //create two meta transaction to mint two NFTs
    //you can use favorite method (like ethers.js) to construct the call data 
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

    const transaction2: MetaTransaction = {
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    //createUserOperation will determine the nonce, fetch the gas prices,
    //estimate gas limits and return a useroperation to be signed.
    //you can override all these values using the overrides parameter.
    let userOperation = await smartAccount.createUserOperation(
        [
            //You can batch multiple transactions to be executed in one useroperation.
            transaction1, transaction2,
        ],
        nodeUrl, //the node rpc is used to fetch the current nonce and fetch gas prices.
        bundlerUrl, //the bundler rpc is used to estimate the gas limits.
        {
            expectedSigners: [owner1.address, owner2.address],
            //uncomment the following values for polygon or any chains where
            //gas prices change rapidly
            //    maxFeePerGasPercentageMultiplier:130,
            //    maxPriorityFeePerGasPercentageMultiplier:130
        }
    )

    const paymaster = new CandidePaymaster(paymasterUrl)

    const [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOperation, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    userOperation = paymasterUserOperation;

    const cost = calculateUserOperationMaxGasCost(userOperation)
    console.log("This useroperation may cost upto : " + cost + " wei")
    console.log("This example uses a Candide paymaster to sponsor the useroperation, so there is not need to fund the sender account.")
    console.log("Get early access to Candide's sponsor paymaster by visiting our discord https://discord.gg/KJSzy2Rqtg")


    //Safe is a multisig that can have multiple owners/signers
    //signUserOperation will create a signature for the provided
    //privateKeys
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [owner1PrivateKey, owner2PrivateKey],
        chainId
    )
    console.log(userOperation)

    //use the bundler rpc to send a useroperation
    //sendUserOperation will return a SendUseroperationResponse object
    //that can be awaited for the useroperation to be included onchain
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    )

    console.log("Useroperation sent. Waiting to be included ......")
    //included will return a UserOperationReceiptResult when 
    //useroperation is included onchain
    let userOperationReceiptResult = await sendUserOperationResponse.included()

    console.log("Useroperation receipt received.")
    console.log(userOperationReceiptResult)
    if (userOperationReceiptResult == null) {
        console.log("Receipt not found (timeout)")
    } else if (userOperationReceiptResult.success) {
        console.log("Two Nfts were minted. The transaction hash is : " + userOperationReceiptResult.receipt.transactionHash)
    } else {
        console.log("Useroperation execution failed")
    }
}

main()
