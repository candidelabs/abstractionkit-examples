import * as dotenv from 'dotenv'
import {
    SafeAccountV0_2_0 as SafeAccount,
    AllowanceModule,
    CandidePaymaster,
    ZeroAddress
} from "abstractionkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi } from "viem";

const ERC20_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

async function main(): Promise<void> {
    //get values from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string);
    const nodeUrl = process.env.NODE_URL as string;
    const bundlerUrl = process.env.BUNDLER_URL as string;
    const paymasterUrl = process.env.PAYMASTER_URL as string;
    const sponsorshipPolicyId = process.env.SPONSORSHIP_POLICY_ID as string;
    const allowanceToken = process.env.TOKEN_ADDRESS as string;

    // source account owner
    const sourceOwnerPublicAddress = process.env.PUBLIC_ADDRESS as string;
    const sourceOwnerPrivateKey = process.env.PRIVATE_KEY as string;

    // delegate account owner
    const delegateOwnerPrivateKey = generatePrivateKey();
    const delegateOwner = privateKeyToAccount(delegateOwnerPrivateKey);
    const delegateOwnerPublicAddress = delegateOwner.address;

    // source safe account
    const sourceSafeAccount = SafeAccount.initializeNewAccount(
        [sourceOwnerPublicAddress], { c2Nonce: 0n }
    );

    const client = createPublicClient({ transport: http(nodeUrl) });
    const sourceSafeAccountBalance = await client.readContract({
        address: allowanceToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [sourceSafeAccount.accountAddress as `0x${string}`],
    });

    if (sourceSafeAccountBalance <= 2n) {
        console.log("Please fund the Safe Account with some tokens first");
        console.log("Safe Account Address: " + sourceSafeAccount.accountAddress);
        console.log("Token: ", allowanceToken);
        console.log("Network Chain ID ", chainId.toString());
        return;
    }

    // delegate safe account
    const delegateSafeAccount = SafeAccount.initializeNewAccount(
        [delegateOwnerPublicAddress],
    );

    const allowanceModule = new AllowanceModule();

    // Need to be enabled only once
    const enableModuleMetaTransaction = allowanceModule.createEnableModuleMetaTransaction(sourceSafeAccount.accountAddress);

    const addDelegateMetaTransaction = allowanceModule.createAddDelegateMetaTransaction(delegateSafeAccount.accountAddress);

    const setAllowanceMetaTransaction =
        allowanceModule.createRecurringAllowanceMetaTransaction(
            delegateSafeAccount.accountAddress, // The address of the delegate to whom the recurring allowance is given.
            allowanceToken, // The address of the token for which the allowance is set. 
            1n, // The amount of the token allowed for the delegate.
            3n, // The time period (in minutes) after which the allowance resets.
            0n, // The delay in minutes before the allowance can be used.
        );

    let setAllowanceUserOp =
        await sourceSafeAccount.createUserOperation(
            [enableModuleMetaTransaction, addDelegateMetaTransaction, setAllowanceMetaTransaction],
            nodeUrl,
            bundlerUrl,
        );

    const paymaster = new CandidePaymaster(paymasterUrl);

    let [sponsoredSetAllowanceUserOp, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        setAllowanceUserOp, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    setAllowanceUserOp = sponsoredSetAllowanceUserOp;

    setAllowanceUserOp.signature = sourceSafeAccount.signUserOperation(
        setAllowanceUserOp,
        [sourceOwnerPrivateKey],
        chainId,
    )
    console.log(setAllowanceUserOp)

    const sendSetAllowanceUserOpResponse = await sourceSafeAccount.sendUserOperation(
        setAllowanceUserOp, bundlerUrl
    );

    console.log("Useroperation sent. Waiting to be included ......")
    let setAllowanceUserOpReceiptResult = await sendSetAllowanceUserOpResponse.included()

    console.log("Useroperation receipt received.")
    console.log(setAllowanceUserOpReceiptResult)
    if (setAllowanceUserOpReceiptResult.success) {
        console.log("Spending Permissions is given to the Delegate. The transaction hash is : " + setAllowanceUserOpReceiptResult.receipt.transactionHash)
    } else {
        console.log("Useroperation execution failed")
    }

    /* The Delegate can now transfer the tokens on behaf of the Source Safe Account */

    const transferRecipient = ZeroAddress;
    const allowanceTransferMetaTransaction =
        allowanceModule.createAllowanceTransferMetaTransaction(
            sourceSafeAccount.accountAddress, // The safe address from which the allowance is being transferred
            allowanceToken,
            transferRecipient, // The recipient address of the allowance transfer.
            2n, // The amount of tokens to be transferred.
            delegateSafeAccount.accountAddress, // The delegate address managing the transfer.
        );

    let allowanceTransferUserOp = await delegateSafeAccount.createUserOperation([allowanceTransferMetaTransaction], nodeUrl, bundlerUrl);

    let [sponsoredAllowanceTransferUserOp, _sponsorMetaData2] = await paymaster.createSponsorPaymasterUserOperation(
        allowanceTransferUserOp, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    allowanceTransferUserOp = sponsoredAllowanceTransferUserOp;

    allowanceTransferUserOp.signature = sourceSafeAccount.signUserOperation(
        allowanceTransferUserOp,
        [delegateOwnerPrivateKey],
        chainId,
    )
    console.log(allowanceTransferUserOp)

    const sendAllowanceTransferUserOpResponse = await sourceSafeAccount.sendUserOperation(
        allowanceTransferUserOp, bundlerUrl
    );

    console.log("Useroperation sent. Waiting to be included ......")
    let allowanceTransferUserOpReceiptResult = await sendAllowanceTransferUserOpResponse.included()

    console.log("Useroperation receipt received.")
    console.log(allowanceTransferUserOpReceiptResult)
    if (allowanceTransferUserOpReceiptResult.success) {
        console.log("Delegate transfered tokens from the source Safe Account. The transaction hash is : " + allowanceTransferUserOpReceiptResult.receipt.transactionHash)
    } else {
        console.log("Useroperation execution failed")
    }
}

main();

