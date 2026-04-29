/**
 * Upgrade an EOA to Calibur (EIP-7702) and mint an NFT, using the
 * ExternalSigner API.
 *
 * Account class : Calibur7702Account
 * Signing method: signUserOperationWithSigner(op, signer, chainId)
 * Signer adapter: fromViem
 * Paymaster     : Erc7677Paymaster
 *
 * Idempotent rerun: isDelegatedToThisAccount() queries on-chain and
 * skips the EIP-7702 authorization if the EOA is already delegated to
 * Calibur. Running this example a second time will not try to
 * re-delegate.
 */

import {
    Calibur7702Account,
    Erc7677Paymaster,
    createAndSignEip7702DelegationAuthorization,
    createCallData,
    fromViem,
    getFunctionSelector,
} from 'abstractionkit'
import { privateKeyToAccount } from 'viem/accounts'

import { getOrCreateOwner, loadEnv } from '../../utils/env'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress, privateKey } = getOrCreateOwner()

    // 1. Build the ExternalSigner. We keep a reference to the underlying
    //    viem LocalAccount so we can reuse its .sign method below for the
    //    7702 delegation authorization, without handing the raw private
    //    key to abstractionkit.
    const localAccount = privateKeyToAccount(privateKey as `0x${string}`)
    const signer = fromViem(localAccount)
    console.log('EOA     :', publicAddress)

    // 2. Initialize the Calibur account and check existing delegation.
    const smartAccount = new Calibur7702Account(publicAddress)
    const alreadyDelegated = await smartAccount.isDelegatedToThisAccount(nodeUrl)
    if (alreadyDelegated) console.log('Status  : already delegated; skipping 7702 auth.')

    // 3. Build a MetaTransaction: mint an NFT to the EOA.
    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mintData = createCallData(
        getFunctionSelector('mint(address)'),
        ['address'],
        [publicAddress],
    )

    // 4. Assemble the UserOperation. Request an EIP-7702 auth only if
    //    the EOA isn't already delegated.
    let userOp = await smartAccount.createUserOperation(
        [{ to: nft, value: 0n, data: mintData }],
        nodeUrl, bundlerUrl,
        { eip7702Auth: alreadyDelegated ? undefined : { chainId } },
    )

    // 5. Sign the EIP-7702 delegation authorization via the external
    //    signer callback. createAndSignEip7702DelegationAuthorization
    //    accepts a callback (hash) => Promise<sig>; we delegate to the
    //    viem LocalAccount so the key never enters abstractionkit.
    if (userOp.eip7702Auth) {
        userOp.eip7702Auth = await createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            async (hash) => localAccount.sign({ hash: hash as `0x${string}` }),
        )
    }

    // 6. Sponsor gas via an ERC-7677 paymaster.
    const paymaster = new Erc7677Paymaster(paymasterUrl)
    const { userOperation: sponsoredOp } = await paymaster.createPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl,
        sponsorshipPolicyId ? { sponsorshipPolicyId } : undefined,
    )
    userOp = sponsoredOp

    // 7. Sign the UserOperation hash via the ExternalSigner.
    userOp.signature = await smartAccount.signUserOperationWithSigner(
        userOp, signer, chainId,
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
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
