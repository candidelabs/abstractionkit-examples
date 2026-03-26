import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    createUserOperationHash,
    CandidePaymaster,
} from "abstractionkit"
import { privateKeyToAccount } from "viem/accounts"

// Same as 01-upgrade-eoa.ts, but signing uses abstractionkit's callback
// pattern with a viem Account instead of passing private keys directly.
// The Account can be swapped for any viem adapter (hardware wallet,
// WalletConnect, browser extension, custom signer via toAccount()).

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaDelegatorPublicAddress, privateKey: eoaDelegatorPrivateKey } = getOrCreateOwner()

    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Create a viem Account (the external signer)
    // ──────────────────────────────────────────────────────────────────────
    // Replace privateKeyToAccount with any viem account adapter:
    //   - toAccount() for custom signers
    //   - JSON-RPC account for browser wallets
    //   - Hardware wallet adapter
    const account = privateKeyToAccount(eoaDelegatorPrivateKey as `0x${string}`)

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Initialize smart account and build transactions
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
    // Step 3: Create UserOperation with EIP-7702 authorization
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
    // Step 4: Sign delegation with signer callback
    // ──────────────────────────────────────────────────────────────────────
    // The callback receives the raw authorization hash and returns a signature.
    // Use account.sign() for raw signing — NOT signMessage(), which adds an
    // EIP-191 prefix and produces a different recovered address.
    userOperation.eip7702Auth = await createAndSignEip7702DelegationAuthorization(
        BigInt(userOperation.eip7702Auth.chainId),
        userOperation.eip7702Auth.address,
        BigInt(userOperation.eip7702Auth.nonce),
        async (hash: string) => {
            return await account.sign({ hash: hash as `0x${string}` })
        }
    )

    // ──────────────────────────────────────────────────────────────────────
    // Step 5: Sponsor gas with paymaster
    // ──────────────────────────────────────────────────────────────────────
    const paymaster = new CandidePaymaster(paymasterUrl)
    let [paymasterUserOperation] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl, sponsorshipPolicyId)
    userOperation = paymasterUserOperation

    // ──────────────────────────────────────────────────────────────────────
    // Step 6: Sign UserOperation with external signer
    // ──────────────────────────────────────────────────────────────────────
    // createUserOperationHash produces the hash, then sign it raw.
    const userOperationHash = createUserOperationHash(
        userOperation,
        smartAccount.entrypointAddress,
        chainId,
    )

    userOperation.signature = await account.sign({ hash: userOperationHash as `0x${string}` })

    // ──────────────────────────────────────────────────────────────────────
    // Step 7: Send and wait for inclusion
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
