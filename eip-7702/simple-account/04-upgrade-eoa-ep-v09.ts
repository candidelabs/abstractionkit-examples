import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702AccountV09 as Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    ExperimentalAllowAllParallelPaymaster,
} from "abstractionkit"

// Same as 01-upgrade-eoa.ts, but uses EntryPoint v0.9 with
// Simple7702AccountV09 and the experimental parallel paymaster.

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl } = loadEnv()
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Initialize smart account and build transactions
    // ──────────────────────────────────────────────────────────────────────
    const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress)

    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintFunctionSelector = getFunctionSelector('mint(address)')
    const mintCallData = createCallData(
        mintFunctionSelector,
        ["address"],
        [eoaDelegatorPublicAddress],
    )

    const mintNft = { to: nftContractAddress, value: 0n, data: mintCallData }

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Fetch parallel paymaster init values
    // ──────────────────────────────────────────────────────────────────────
    const paymaster = new ExperimentalAllowAllParallelPaymaster()
    const paymasterInitFields = await paymaster.getPaymasterFieldsInitValues(chainId)

    // ──────────────────────────────────────────────────────────────────────
    // Step 3: Create UserOperation with EIP-7702 auth + paymaster
    // ──────────────────────────────────────────────────────────────────────
    const userOperation = await smartAccount.createUserOperation(
        [mintNft, mintNft],
        nodeUrl,
        bundlerUrl,
        {
            parallelPaymasterInitValues: paymasterInitFields,
            eip7702Auth: {
                chainId: chainId,
            },
        },
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 4: Sign EIP-7702 delegation authorization
    // ──────────────────────────────────────────────────────────────────────
    // If the EOA is already delegated, eip7702Auth is null — skip signing.
    if (userOperation.eip7702Auth) {
        userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            eoaDelegatorPrivateKey,
        )
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 5: Sign UserOperation and fetch paymaster data in parallel
    // ──────────────────────────────────────────────────────────────────────
    const [signature, paymasterData] = await Promise.all([
        smartAccount.signUserOperation(
            userOperation,
            eoaDelegatorPrivateKey,
            chainId,
        ),
        paymaster.getApprovedPaymasterData(userOperation),
    ])

    userOperation.signature = signature
    userOperation.paymasterData = paymasterData

    // ──────────────────────────────────────────────────────────────────────
    // Step 6: Send and wait for inclusion
    // ──────────────────────────────────────────────────────────────────────
    console.log("UserOperation:", userOperation)

    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl,
    )

    console.log("UserOp sent! Waiting for inclusion...")
    console.log("UserOp hash:", sendUserOperationResponse.userOperationHash)

    const receipt = await sendUserOperationResponse.included()

    console.log("UserOperation receipt received.")
    console.log(receipt)
    if (receipt.success) {
        console.log("EOA upgraded to a Smart Account and minted two NFTs! Transaction hash: " + receipt.receipt.transactionHash)
    } else {
        console.log("UserOperation execution failed")
    }
}

main()
