import { loadEnv, getOrCreateOwner, requireEnv } from '../utils/env'
import {
    SafeAccountV0_3_0 as SafeAccount,
    MetaTransaction,
    Erc7677Paymaster,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";

/**
 * Pay gas in an ERC-20 token via any ERC-7677 paymaster.
 *
 * Passing `{ token }` in the context triggers the token-gas flow. For
 * Candide and Pimlico, the provider is auto-detected from the paymaster
 * URL, the exchange rate is fetched from the provider's RPC, and the
 * ERC-20 approval is prepended to callData automatically.
 *
 * Requirement: fund the smart account with enough of the ERC-20 token
 * BEFORE running this script, otherwise the paymaster rejects the op.
 *
 * See ../pay-gas-in-erc20/pay-gas-in-erc20.ts for the Candide-specific
 * variant (token-cost estimation via `calculateUserOperationErc20TokenMaxGasCost`).
 */

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl } = loadEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()
    const tokenAddress = requireEnv('TOKEN_ADDRESS')

    // 1. Initialize a new smart account.
    //    (Fund it with the ERC-20 token before running — see header.)
    const smartAccount = SafeAccount.initializeNewAccount([ownerPublicAddress])
    console.log("Smart account:", smartAccount.accountAddress)

    // 2. Build a transaction (mint an NFT).
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const transaction: MetaTransaction = {
        to: nftContractAddress,
        value: 0n,
        data: createCallData(
            getFunctionSelector("mint(address)"),
            ["address"],
            [smartAccount.accountAddress],
        ),
    }

    // 3. Create the UserOperation.
    let userOperation = await smartAccount.createUserOperation(
        [transaction],
        nodeUrl,
        bundlerUrl,
    )

    // 4. Pay gas in ERC-20 via the ERC-7677 paymaster.
    const paymaster = new Erc7677Paymaster(paymasterUrl)
    userOperation = await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOperation,
        bundlerUrl,
        { token: tokenAddress },
    )

    // 5. Sign and send.
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [ownerPrivateKey],
        chainId,
    )
    const response = await smartAccount.sendUserOperation(userOperation, bundlerUrl)
    console.log("UserOperation sent. Waiting to be included...")

    const receipt = await response.included()
    if (receipt == null) {
        console.log("Receipt not found (timeout)")
    } else if (receipt.success) {
        console.log("NFT minted. Tx hash:", receipt.receipt.transactionHash)
    } else {
        console.log("UserOperation execution failed")
    }
}

main()
