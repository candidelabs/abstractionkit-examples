import { loadEnv, getOrCreateOwner } from '../utils/env'
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    MetaTransaction,
    calculateUserOperationMaxGasCost,
    Erc7677Paymaster,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()

    //initializeNewAccount only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object for the following useroperations
    let smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
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

    //createUserOperation will determine the nonce, fetch the gas prices,
    //estimate gas limits and return a useroperation to be signed.
    //you can override all these values using the overrides parameter.
    let userOperation = await smartAccount.createUserOperation(
        [
            //You can batch multiple transactions to be executed in one useroperation.
            transaction1, //transaction2,
        ],
        nodeUrl, //the node rpc is used to fetch the current nonce and fetch gas prices.
        bundlerUrl, //the bundler rpc is used to estimate the gas limits.
        //uncomment the following values for polygon or any chains where
        //gas prices change rapidly
        //{
        //    maxFeePerGasPercentageMultiplier:130,
        //    maxPriorityFeePerGasPercentageMultiplier:130
        //}
    )

    //Erc7677Paymaster speaks the ERC-7677 standard, so it works with any
    //compliant provider. The provider is auto-detected from the paymaster URL.
    const paymaster = new Erc7677Paymaster(paymasterUrl)
    //Candide and Pimlico read `sponsorshipPolicyId`; Alchemy reads `policyId`.
    //Send both so the same context is portable across providers; empty = public gas policies.
    const context = sponsorshipPolicyId ? { sponsorshipPolicyId, policyId: sponsorshipPolicyId } : {}

    const { userOperation: paymasterUserOperation } = await paymaster.createPaymasterUserOperation(
        smartAccount, userOperation, bundlerUrl, context)
    userOperation = paymasterUserOperation;


    const cost = calculateUserOperationMaxGasCost(userOperation)
    console.log("This useroperation may cost upto : " + cost + " wei")
    console.log("This example uses Erc7677Paymaster (any ERC-7677 provider) to sponsor the useroperation, so there is no need to fund the sender account.")
    console.log("Set up your own gas sponsorship policy at https://dashboard.candide.dev")

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
        console.log("Two Nfts were minted. The transaction hash is : " + userOperationReceiptResult.receipt.transactionHash)
    } else {
        console.log("Useroperation execution failed")
    }
}

main()
