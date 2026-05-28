import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702AccountV09 as Simple7702Account,
    MetaTransaction,
    UserOperationV9,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    Erc7677Paymaster,
} from "abstractionkit"

// Upgrades an EOA to a Simple7702 smart account (EntryPoint v0.9) with gas
// sponsorship, then mints two NFTs across two separate UserOperations (one
// after the other) so we exercise both the "first userOp (with 7702 auth)"
// path and the "subsequent userOp (already delegated)" path.

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaAddress, privateKey } = getOrCreateOwner()

    const smartAccount = new Simple7702Account(eoaAddress)
    const paymaster = new Erc7677Paymaster(paymasterUrl)

    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintCallData = createCallData(
        getFunctionSelector('mint(address)'),
        ["address"],
        [eoaAddress],
    )
    const mintTx: MetaTransaction = { to: nftContractAddress, value: 0n, data: mintCallData }

    async function sendOneMint(label: string): Promise<void> {
        console.log(`\n========== ${label} ==========`)

        let userOperation: UserOperationV9 = await smartAccount.createUserOperation(
            [mintTx],
            nodeUrl,
            bundlerUrl,
            { eip7702Auth: { chainId } },
        )

        if (userOperation.eip7702Auth) {
            console.log("EOA not yet delegated — signing EIP-7702 authorization")
            userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
                BigInt(userOperation.eip7702Auth.chainId),
                userOperation.eip7702Auth.address,
                BigInt(userOperation.eip7702Auth.nonce),
                privateKey,
            )
        } else {
            console.log("EOA already delegated — skipping EIP-7702 authorization")
        }

        const { userOperation: sponsored } = await paymaster.createPaymasterUserOperation(
            smartAccount, userOperation, bundlerUrl, sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
        )
        userOperation = sponsored

        userOperation.signature = smartAccount.signUserOperation(
            userOperation, privateKey, chainId,
        )

        const response = await smartAccount.sendUserOperation(userOperation, bundlerUrl)
        console.log(`UserOp sent (hash: ${response.userOperationHash}). Waiting for inclusion...`)
        const receipt = await response.included()

        if (receipt == null) {
            console.log("Receipt not found (timeout)")
            throw new Error(`${label}: receipt timeout`)
        }
        if (!receipt.success) {
            console.log("UserOperation execution failed")
            console.log(receipt)
            throw new Error(`${label}: userOp execution failed`)
        }
        console.log(`${label} success — tx ${receipt.receipt.transactionHash} actualGasUsed=${receipt.actualGasUsed}`)
    }

    await sendOneMint("UserOp #1 — first mint (upgrades EOA via EIP-7702)")
    await sendOneMint("UserOp #2 — second mint (EOA already delegated)")

    console.log("\nBoth UserOperations included on EntryPoint v0.9.")
}

main()
