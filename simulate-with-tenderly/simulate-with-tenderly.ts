import * as dotenv from 'dotenv'
import { Wallet } from "ethers";
import {
    SafeAccountV0_3_0,
    MetaTransaction,
    getFunctionSelector,
    createCallData,
    simulateUserOperationWithTenderlyAndCreateShareLink
} from "abstractionkit";

async function main(): Promise<void> {
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const nodeUrl = process.env.NODE_URL as string

    const owner = Wallet.createRandom();
    const ownerPublicAddress = process.env.PUBLIC_ADDRESS || owner.address as string
    const ownerPrivateKey = process.env.PRIVATE_KEY || owner.privateKey as string

    const tenderlyAccountSlug = '';
    const tenderlyProjectSlug = '';
    const tenderlyAccessKey = '';

    if (!tenderlyAccountSlug || !tenderlyProjectSlug || !tenderlyProjectSlug) {
        console.log("Tenderly config is not setup. Fill in the above config from https://dashboard.tenderly.co >> Settings >> Integration");
        return;
    }

    const smartAccount = SafeAccountV0_3_0.initializeNewAccount(
        [ownerPublicAddress],
    )

    //create two meta transaction to mint two NFTs
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
    const mintFunctionSignature = 'mint(address)';
    const mintFunctionSelector = getFunctionSelector(mintFunctionSignature);
    const mintTransactionCallData = createCallData(
        mintFunctionSelector,
        ["address"],
        [smartAccount.accountAddress]
    );
    const metaTx1: MetaTransaction = {
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }
    const metaTx2: MetaTransaction = {
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    // Simulate the calldata 
    const callDataSim = await smartAccount.simulateCallDataWithTenderlyAndCreateShareLink(
        tenderlyAccountSlug,
        tenderlyProjectSlug,
        tenderlyAccessKey,
        nodeUrl,
        chainId,
        [metaTx1, metaTx2],
    )
    console.log("calldata simulation link: ", callDataSim.callDataSimulationShareLink)

    let userOperation = await smartAccount.createUserOperation(
        [metaTx1, metaTx2],
        nodeUrl, 
        bundlerUrl, 
    )

    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [ownerPrivateKey],
        chainId
    );

    // Simulate the userOp 
    const userOpSim = await simulateUserOperationWithTenderlyAndCreateShareLink(
        tenderlyAccountSlug,
        tenderlyProjectSlug,
        tenderlyAccessKey,
        chainId,
        smartAccount.entrypointAddress,
        userOperation
    );
    console.log("useroperation simulation link: ", userOpSim.simulationShareLink)
}

main()
