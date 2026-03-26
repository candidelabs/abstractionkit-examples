import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
} from "abstractionkit"

// Upgrades an EOA to a Simple7702 smart account with gas sponsorship,
// then batch-mints two NFTs in a single UserOperation.

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Initialize smart account and build transactions
    // ──────────────────────────────────────────────────────────────────────
    // We'll batch-mint two NFTs in a single UserOperation to demonstrate
    // the smart account's batching capability.
    const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress)

    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintFunctionSelector = getFunctionSelector('mint(address)')
    const mintCallData = createCallData(
        mintFunctionSelector,
        ["address"],
        [eoaDelegatorPublicAddress],
    )

    const mintNft1 = { to: nftContractAddress, value: 0n, data: mintCallData }
    const mintNft2 = { to: nftContractAddress, value: 0n, data: mintCallData }

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Create UserOperation with EIP-7702 authorization
    // ──────────────────────────────────────────────────────────────────────
    let userOperation = await smartAccount.createUserOperation(
        [mintNft1, mintNft2],
        nodeUrl,
        bundlerUrl,
        {
            eip7702Auth: {
                chainId: chainId,
            }
        }
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 3: Sign EIP-7702 delegation authorization
    // ──────────────────────────────────────────────────────────────────────
    // If the EOA is already delegated, eip7702Auth is null — skip signing.
    if (userOperation.eip7702Auth) {
        userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            eoaDelegatorPrivateKey
        )
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 4: Sponsor gas with paymaster
    // ──────────────────────────────────────────────────────────────────────
    const paymaster = new CandidePaymaster(paymasterUrl)
    let [paymasterUserOperation] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl, sponsorshipPolicyId)
    userOperation = paymasterUserOperation

    // ──────────────────────────────────────────────────────────────────────
    // Step 5: Sign UserOperation
    // ──────────────────────────────────────────────────────────────────────
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        eoaDelegatorPrivateKey,
        chainId,
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 6: Send and wait for inclusion
    // ──────────────────────────────────────────────────────────────────────
    console.log("UserOperation:", userOperation)

    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
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
