import { loadEnv, getOrCreateOwner, requireEnv } from '../utils/env'
import {
    SafeMultiChainSigAccountV1 as SafeAccount,
    MetaTransaction,
    Erc7677Paymaster,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl } = loadEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()
    const paymasterTokenAddress = requireEnv('TOKEN_ADDRESS')

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
            //add some extra buffer to the estimated gas limits

            //uncomment the following values for polygon or any chains where
            //gas prices change rapidly
            //    maxFeePerGasPercentageMultiplier:130,
            //    maxPriorityFeePerGasPercentageMultiplier:130
        }
    )

    const paymaster = new Erc7677Paymaster(paymasterUrl)

    console.log("This example pays gas in an ERC-20 token via an ERC-7677 paymaster");
    console.log("Please visit https://dashboard.candide.dev/ to get a Paymaster URL");
    console.log("Get test tokens from our faucet https://dashboard.candide.dev/faucet");

    // Passing { token } triggers the token-gas flow: the provider is auto-detected
    // from the paymaster URL, the exchange rate is fetched, the ERC-20 approval is
    // prepended to callData, and the max token cost is returned in tokenQuote.
    const { userOperation: tokenOp, tokenQuote } = await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOperation,
        bundlerUrl,
        { token: paymasterTokenAddress },
    )
    userOperation = tokenOp
    if (tokenQuote) {
        console.log("This useroperation may cost upto : " + tokenQuote.tokenCost + " of the token (exchange rate: " + tokenQuote.exchangeRate + ")")
        console.log("Fund the sender account : " + userOperation.sender + " with at least " + tokenQuote.tokenCost + " of the token")
    }

    //Safe is a multisig that can have multiple owners/signers
    //signUserOperation will create a signature for the provided
    //privateKeys
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [ownerPrivateKey],
        chainId,
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
