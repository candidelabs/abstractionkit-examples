import * as dotenv from 'dotenv'

import {
    SafeMultiChainSigAccount as SafeAccount,
    MetaTransaction,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";
import { UserOperationV9 } from 'abstractionkit/dist/types';

async function main(): Promise<void> {
    //get values from .env
    dotenv.config()
    const chainId1 = BigInt(process.env.CHAIN_ID1 as string)
    const chainId2 = BigInt(process.env.CHAIN_ID2 as string)
    const bundlerUrl1 = process.env.BUNDLER_URL1 as string
    const bundlerUrl2 = process.env.BUNDLER_URL2 as string
    const nodeUrl1 = process.env.NODE_URL1 as string
    const nodeUrl2 = process.env.NODE_URL2 as string
    const ownerPublicAddress = process.env.PUBLIC_ADDRESS as string
    const ownerPrivateKey = process.env.PRIVATE_KEY as string
    
    //initializeNewAccount only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object for the following useroperations
    let smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
        {c2Nonce: 2n}
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
    
    // createUserOperation for useroperations can be done concurrently
    const [userOperation1, userOperation2]= await Promise.all(
        [
            await smartAccount.createUserOperation(
                [transaction1], nodeUrl1, bundlerUrl1,
                {
                    preVerificationGasPercentageMultiplier: 100
                }
            ),
            await smartAccount.createUserOperation(
                [transaction2], nodeUrl2, bundlerUrl2,
                {
                    preVerificationGasPercentageMultiplier: 100
                }
            ),
        ]
    );

    const signatures = smartAccount.signUserOperations(
        [
            {
                userOperation: userOperation1,
                chainId: chainId1
            },
            {
                userOperation: userOperation2,
                chainId: chainId2
            }
        ],
        [ownerPrivateKey],
    );

    userOperation1.signature = signatures[0];
    userOperation2.signature = signatures[1];
    
    // sendAndMonitorUserOperation for useroperations can be done concurrently
    await Promise.all(
        [
            sendAndMonitorUserOperation(userOperation1, bundlerUrl1, 1),
            sendAndMonitorUserOperation(userOperation2, bundlerUrl2, 2),
        ]
    );
}

async function sendAndMonitorUserOperation(
    userOperation: UserOperationV9, bundlerUrl: string, userOperationIndex: number
){
    //use the bundler rpc to send a userOperation
    //sendUserOperation will return a SendUseroperationResponse object
    //that can be awaited for the useroperation to be included onchain
    const smartAccount = new SafeAccount(userOperation.sender);
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    )

    console.log(`Useroperation ${userOperationIndex} sent. Waiting to be included ......`)
    //included will return a UserOperationReceiptResult when 
    //useroperation is included onchain
    let userOperationReceiptResult = await sendUserOperationResponse.included()

    console.log(`Useroperation ${userOperationIndex} receipt received.`)
    console.log(userOperationReceiptResult)
    if (userOperationReceiptResult.success) {
        console.log(
            `Two Nfts were minted. Useroperation ${userOperationIndex} transaction hash is : ` +
            userOperationReceiptResult.receipt.transactionHash
        )
    } else {
        console.log(`Useroperation ${userOperationIndex} execution failed`)
    }
}

main()
