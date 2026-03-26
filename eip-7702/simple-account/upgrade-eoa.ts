import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
    // Uncomment these imports if using viem wallet client signing (see below)
    // createEip7702DelegationAuthorizationHash,
    // createUserOperationHash,
} from "abstractionkit";
// Uncomment these imports if using viem wallet client signing (see below)
// import { sign } from "viem/accounts";
// import { createPublicClient, http, toHex } from "viem";

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

    // --- Option A: Sign delegation with private key (default) ---
    userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
        BigInt(userOperation.eip7702Auth.chainId),
        userOperation.eip7702Auth.address,
        BigInt(userOperation.eip7702Auth.nonce),
        eoaDelegatorPrivateKey
    )

    // --- Option B: Sign delegation with viem wallet client ---
    // Useful when signing is handled externally (hardware wallet, external signer).
    // Uncomment this block and the viem imports above, and comment out Option A.
    //
    // const client = createPublicClient({ transport: http(nodeUrl) });
    // const nonce = await client.getTransactionCount({ address: eoaDelegatorPublicAddress as `0x${string}` });
    //
    // const eip7702DelegationAuthorizationHash = createEip7702DelegationAuthorizationHash(
    //     chainId,
    //     smartAccount.delegateeAddress,
    //     BigInt(nonce)
    // );
    //
    // const delegationSig = await sign({
    //     hash: eip7702DelegationAuthorizationHash as `0x${string}`,
    //     privateKey: eoaDelegatorPrivateKey as `0x${string}`
    // });
    //
    // userOperation.eip7702Auth = {
    //     chainId: toHex(chainId),
    //     address: smartAccount.delegateeAddress,
    //     nonce: toHex(nonce),
    //     yParity: toHex(delegationSig.v === 27n ? 0 : 1),
    //     r: delegationSig.r,
    //     s: delegationSig.s
    // };

    // Sponsor gas with paymaster
    const paymaster = new CandidePaymaster(paymasterUrl);
    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl, sponsorshipPolicyId)
    userOperation = paymasterUserOperation;

    // --- Option A: Sign UserOperation with private key (default) ---
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        eoaDelegatorPrivateKey,
        chainId,
    );

    // --- Option B: Sign UserOperation with viem wallet client ---
    // Uncomment this block and comment out Option A above.
    //
    // const userOperationHash = createUserOperationHash(
    //     userOperation,
    //     smartAccount.entrypointAddress,
    //     chainId,
    // );
    // userOperation.signature = await sign({
    //     hash: userOperationHash as `0x${string}`,
    //     privateKey: eoaDelegatorPrivateKey as `0x${string}`,
    //     to: 'hex'
    // });

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
