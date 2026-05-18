/**
 * Drive `signTypedData` yourself using `getUserOperationEip712Data` —
 * the lower-level path for integrators who already have a
 * `signTypedData(domain, types, message)` primitive and don't want to
 * wrap it in an ExternalSigner.
 *
 * Account class : Simple7702Account
 * Signing API   : Simple7702Account.getUserOperationEip712Data(op, chainId)
 *                 + your own signTypedData
 * Paymaster     : Erc7677Paymaster (sponsored)
 *
 * When to reach for this instead of 05-external-signer.ts:
 *  - You're building an SDK that exposes `signTypedData(domain, types,
 *    message)` to its callers, and want to feed it the UserOperation's
 *    typed data directly.
 *  - You already have a typed-data signing function (a browser wallet
 *    via WalletConnect/wagmi, an MPC service, an HSM, etc.) and would
 *    rather call it directly than wrap it in an ExternalSigner adapter.
 *  - You want to inspect / log / customize the {domain, types, message}
 *    payload before it goes to the wallet UI.
 *
 * Why this works: EntryPoint v0.8 / v0.9's userOpHash IS the EIP-712
 * digest of `PackedUserOperation` under the EntryPoint's domain. So a
 * signTypedData result over those fields validates against the same
 * userOpHash as a raw ECDSA signature over the hash. The two paths are
 * interchangeable; the choice is purely about which signing primitive
 * you already have.
 *
 * This example uses ethers' `Wallet.signTypedData` to demonstrate the
 * API boundary — replace with viem, wagmi's `signTypedDataAsync`, an
 * HSM RPC call, or any signTypedData implementation. The EIP-7702
 * delegation authorization is a SEPARATE signature (see header in
 * 05-external-signer.ts) and is signed via the callback overload of
 * `createAndSignEip7702DelegationAuthorization` so the key never leaves
 * ethers.
 */

import {
    AbstractionKitError,
    Erc7677Paymaster,
    Simple7702Account,
    createAndSignEip7702DelegationAuthorization,
    createCallData,
    getFunctionSelector,
} from 'abstractionkit'
import { Signature, Wallet } from 'ethers'

import { getOrCreateOwner, loadEnv } from '../../utils/env'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    // 1. Your `signTypedData` primitive. Stand-in for an SDK method, a
    //    browser-wallet RPC call, an HSM, etc. — anything that exposes
    //    signTypedData(domain, types, message).
    const wallet = new Wallet(privateKey)
    console.log('EOA     :', publicAddress)

    // 2. Initialize the Simple7702 account.
    const smartAccount = new Simple7702Account(publicAddress)

    // 3. Build a MetaTransaction: mint an NFT to the EOA.
    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintData = createCallData(
        getFunctionSelector('mint(address)'),
        ['address'],
        [publicAddress],
    )

    // 4. Assemble the UserOperation with an unsigned EIP-7702 authorization.
    let userOp = await smartAccount.createUserOperation(
        [{ to: nft, value: 0n, data: mintData }],
        nodeUrl, bundlerUrl,
        { eip7702Auth: { chainId } },
    )

    // 5. Sign the EIP-7702 delegation authorization. 
    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = await createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            async (hash) => Signature.from(wallet.signingKey.sign(hash)).serialized,
        )
    }

    // 6. Sponsor gas via an ERC-7677 paymaster. The paymaster fields are
    //    written before signing; the typed data we sign in step 7 reflects
    //    the final UserOperation shape.
    const paymaster = new Erc7677Paymaster(paymasterUrl)
    const { userOperation: sponsoredOp } = await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOp,
        bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )
    userOp = sponsoredOp

    // 7. Build the typed data and drive signTypedData yourself. The shape
    //    is { domain, types, primaryType: 'PackedUserOperation', message }
    //    — ready for any signTypedData implementation. ethers v6 infers
    //    `EIP712Domain` automatically; viem / wallet RPCs accept the same
    //    structure as-is.
    const typedData = Simple7702Account.getUserOperationEip712Data(userOp, chainId)
    userOp.signature = await wallet.signTypedData(
        typedData.domain,
        typedData.types,
        typedData.message,
    )

    // 8. Send and wait for on-chain inclusion.
    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    console.log('UserOp  :', response.userOperationHash)
    const receipt = await response.included()
    if (!receipt) throw new Error('timeout waiting for inclusion')
    console.log('Tx      :', receipt.receipt.transactionHash)
    console.log('Success :', receipt.success)
    if (!receipt.success) throw new Error('reverted on-chain')
}

main().catch((err: unknown) => {
    if (err instanceof AbstractionKitError) {
        console.error('FAILED :', err.code, '-', err.message)
        if (err.context) console.error('Context:', err.context)
        if (err.cause) console.error('Cause  :', err.cause)
    } else {
        console.error(err)
    }
    process.exit(1)
})
