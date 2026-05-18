import { loadEnv, getOrCreateOwner, requireEnv } from '../utils/env'
import {
    SafeAccountV0_3_0 as SafeAccount,
    AllowanceModule,
    CandidePaymaster,
} from "abstractionkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi } from "viem";

const ERC20_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const allowanceTransferAmount = 1n;

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const allowanceToken = requireEnv('TOKEN_ADDRESS')

    // source account owner
    const { publicAddress: sourceOwnerPublicAddress, privateKey: sourceOwnerPrivateKey } = getOrCreateOwner()

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

    if (sourceSafeAccountBalance < allowanceTransferAmount) {
        console.log(`Please fund the Safe Account with at least ${allowanceTransferAmount} token first`);
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

    const setupTransactions = [];
    const allowanceModuleEnabled = await sourceSafeAccount.isModuleEnabled(
        nodeUrl,
        allowanceModule.moduleAddress,
    );

    // Need to be enabled only once. Skipping this on reruns keeps the example idempotent.
    if (!allowanceModuleEnabled) {
        setupTransactions.push(
            allowanceModule.createEnableModuleMetaTransaction(sourceSafeAccount.accountAddress)
        );
    }

    const addDelegateMetaTransaction = allowanceModule.createAddDelegateMetaTransaction(delegateSafeAccount.accountAddress);
    setupTransactions.push(addDelegateMetaTransaction);

    const setAllowanceMetaTransaction =
        allowanceModule.createRecurringAllowanceMetaTransaction(
            delegateSafeAccount.accountAddress, // The address of the delegate to whom the recurring allowance is given.
            allowanceToken, // The address of the token for which the allowance is set. 
            allowanceTransferAmount, // The amount of the token allowed for the delegate.
            3n, // The time period (in minutes) after which the allowance resets.
            0n, // The delay in minutes before the allowance can be used.
        );

    let setAllowanceUserOp =
        await sourceSafeAccount.createUserOperation(
            [...setupTransactions, setAllowanceMetaTransaction],
            nodeUrl,
            bundlerUrl,
        );

    const paymaster = new CandidePaymaster(paymasterUrl);

    const { userOperation: sponsoredSetAllowanceUserOp } = await paymaster.createSponsorPaymasterUserOperation(
        sourceSafeAccount, setAllowanceUserOp, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
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
    if (setAllowanceUserOpReceiptResult == null) {
        console.log("Receipt not found (timeout)")
    } else if (setAllowanceUserOpReceiptResult.success) {
        console.log("Spending Permissions is given to the Delegate. The transaction hash is : " + setAllowanceUserOpReceiptResult.receipt.transactionHash)
    } else {
        console.log("Useroperation execution failed")
    }

    /* The Delegate can now transfer the tokens on behaf of the Source Safe Account */

    const transferRecipient = delegateOwnerPublicAddress;
    const allowanceTransferMetaTransaction =
        allowanceModule.createAllowanceTransferMetaTransaction(
            sourceSafeAccount.accountAddress, // The safe address from which the allowance is being transferred
            allowanceToken,
            transferRecipient, // The recipient address of the allowance transfer.
            allowanceTransferAmount, // The amount of tokens to be transferred.
            delegateSafeAccount.accountAddress, // The delegate address managing the transfer.
        );

    let allowanceTransferUserOp = await delegateSafeAccount.createUserOperation([allowanceTransferMetaTransaction], nodeUrl, bundlerUrl);

    const { userOperation: sponsoredAllowanceTransferUserOp } = await paymaster.createSponsorPaymasterUserOperation(
        delegateSafeAccount, allowanceTransferUserOp, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    allowanceTransferUserOp = sponsoredAllowanceTransferUserOp;

    allowanceTransferUserOp.signature = sourceSafeAccount.signUserOperation(
        allowanceTransferUserOp,
        [delegateOwnerPrivateKey],
        chainId,
    )
    console.log(allowanceTransferUserOp)

    const sendAllowanceTransferUserOpResponse = await delegateSafeAccount.sendUserOperation(
        allowanceTransferUserOp, bundlerUrl
    );

    console.log("Useroperation sent. Waiting to be included ......")
    let allowanceTransferUserOpReceiptResult = await sendAllowanceTransferUserOpResponse.included()

    console.log("Useroperation receipt received.")
    console.log(allowanceTransferUserOpReceiptResult)
    if (allowanceTransferUserOpReceiptResult == null) {
        console.log("Receipt not found (timeout)")
    } else if (allowanceTransferUserOpReceiptResult.success) {
        console.log("Delegate transfered tokens from the source Safe Account. The transaction hash is : " + allowanceTransferUserOpReceiptResult.receipt.transactionHash)
    } else {
        console.log("Useroperation execution failed")
    }
}

main();
