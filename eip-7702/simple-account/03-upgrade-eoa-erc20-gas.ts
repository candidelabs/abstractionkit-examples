import { loadEnv, getOrCreateOwner, requireEnv } from '../../utils/env'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
} from "abstractionkit"

// Same as 01-upgrade-eoa.ts, but gas is paid with an ERC-20 token
// instead of being sponsored by a paymaster policy.

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl } = loadEnv()
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()
    const tokenAddress = requireEnv('TOKEN_ADDRESS')

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
    // Step 4: Pay gas with ERC-20 token via token paymaster
    // ──────────────────────────────────────────────────────────────────────
    // Requires a Candide Paymaster URL from https://dashboard.candide.dev/
    // and a TOKEN_ADDRESS in .env. Visit Discord for test CTT tokens.
    const paymaster = new CandidePaymaster(paymasterUrl)

    const tokensSupported = await paymaster.fetchSupportedERC20TokensAndPaymasterMetadata(smartAccount.entrypointAddress)
    const tokenSelected = tokensSupported.tokens.find(
        token => token.address.toLowerCase() === tokenAddress.toLowerCase()
    )

    if (!tokenSelected) {
        console.log("Token " + tokenAddress + " is not supported by this paymaster.")
        return
    }

    userOperation = await paymaster.createTokenPaymasterUserOperation(
        smartAccount,
        userOperation,
        tokenSelected.address,
        bundlerUrl,
    )

    const cost = await paymaster.calculateUserOperationErc20TokenMaxGasCost(
        userOperation,
        tokenSelected.address,
    )
    console.log("Estimated gas cost: " + cost + " wei in " + tokenSelected.symbol)
    console.log("Sender account: " + userOperation.sender)

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
