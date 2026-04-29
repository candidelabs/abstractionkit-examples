import { loadEnv, getOrCreateOwner } from '../utils/env'
import {
    SafeAccountV0_3_0 as SafeAccount,
    calculateUserOperationMaxGasCost,
    CandidePaymaster,
    SocialRecoveryModule
} from "abstractionkit";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()


    const guardian = privateKeyToAccount(generatePrivateKey());
    const guardianPublicAddress = guardian.address as string;

    //initializeNewAccount only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object for the following useroperations
    let smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
    )

    console.log("Account address(sender) : " + smartAccount.accountAddress)

    const srm = new SocialRecoveryModule()

    const transction1 = srm.createEnableModuleMetaTransaction(
        smartAccount.accountAddress
    );
    const transction2 = srm.createAddGuardianWithThresholdMetaTransaction(
        guardianPublicAddress,
        1n //threshold
    );

    //createUserOperation will determine the nonce, fetch the gas prices,
    //estimate gas limits and return a useroperation to be signed.
    //you can override all these values using the overrides parameter.
    let userOperation = await smartAccount.createUserOperation(
        [
            //You can batch multiple transactions to be executed in one useroperation.
            transction1,
            transction2
        ],
        nodeUrl, //the node rpc is used to fetch the current nonce and fetch gas prices.
        bundlerUrl, //the bundler rpc is used to estimate the gas limits.
    )

    const paymaster = new CandidePaymaster(paymasterUrl)

    const { userOperation: paymasterUserOperation } = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOperation, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    userOperation = paymasterUserOperation;

    const cost = calculateUserOperationMaxGasCost(userOperation)
    console.log("This useroperation may cost upto : " + cost + " wei")
    console.log("This example uses a Candide paymaster to sponsor the useroperation, so there is not need to fund the sender account.")
    console.log("Get early access to Candide's sponsor paymaster by visiting our Discord")

    //Safe is a multisig that can have multiple owners/signers
    //signUserOperation will create a signature for the provided
    //privateKeys
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [ownerPrivateKey],
        chainId,
    )
    console.log(userOperation)

    //use the bundler rpc to send a userOperation
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
        console.log("Successful Useroperation. The transaction hash is : " + userOperationReceiptResult.receipt.transactionHash)
        const isGuardian = await srm.isGuardian(
            nodeUrl,
            smartAccount.accountAddress,
            guardianPublicAddress
        );
        if (isGuardian) {
            console.log("Guardian added confirmed. Guardian address is : " + guardianPublicAddress)
        } else {
            console.log("Adding guardian failed.")
        }
    } else {
        console.log("Useroperation execution failed")
    }
}

main()
