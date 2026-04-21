/**
 * On-chain tracking — attribute active users and userOperations to your project.
 *
 * Pass `onChainIdentifierParams` when initializing the Safe account. The SDK
 * then appends a 32-byte marker to every userOperation's `callData`. Your
 * indexer can filter the EntryPoint's `UserOperationEvent` (or the bundler's
 * `handleOps` tx input) for that marker to attribute traffic to your project.
 *
 * Marker layout (32 bytes):
 *
 *     5afe │ 00 │ project(20) │ platform(3) │ tool(3) │ toolVersion(3)
 *     └─prefix  │
 *        version
 *
 * Each variable-content field is `keccak256(value)` truncated to its width.
 *
 * Register your identifier with the Safe team: https://forms.gle/NYkorYebc6Fz1fMW6
 *
 * Run:
 *     npx ts-node onchain-identifier/onchain-identifier.ts
 */
import { loadEnv, getOrCreateOwner } from '../utils/env'
import {
    SafeAccountV0_3_0 as SafeAccount,
    MetaTransaction,
    CandidePaymaster,
    getFunctionSelector,
    createCallData,
    sendJsonRpcRequest,
} from 'abstractionkit'

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: owner, privateKey: ownerKey } = getOrCreateOwner()

    // ─── 1. Tag the account with your project identifier ──────────────────
    // Only `project` is required. `platform`, `tool`, `toolVersion` refine
    // attribution (Web vs Mobile, which SDK, which version). Use the same
    // values everywhere — your analytics key off this exact string.
    const smartAccount = SafeAccount.initializeNewAccount([owner], {
        onChainIdentifierParams: {
            project: 'AbstractionKit Examples',
            platform: 'Web',
            tool: 'abstractionkit',
            toolVersion: '0.3.2',
        },
    })

    // For already-deployed accounts, pass the same `onChainIdentifierParams`
    // to the constructor; new userOps will carry the marker from that point on.
    // Historical userOps are not retroactively tagged.

    const identifier = smartAccount.onChainIdentifier as string
    console.log('Sender     :', smartAccount.accountAddress)
    console.log('Identifier : 0x' + identifier)

    // ─── 2. Build a sample userOperation (mint an NFT) ────────────────────
    const nft = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
    const mint: MetaTransaction = {
        to: nft,
        value: 0n,
        data: createCallData(
            getFunctionSelector('mint(address)'),
            ['address'],
            [smartAccount.accountAddress],
        ),
    }

    let userOp = await smartAccount.createUserOperation([mint], nodeUrl, bundlerUrl)

    // The marker sits at the tail of `userOp.callData`. This is the field
    // your indexer should match — it's exact, per-userOp, 32 bytes.
    const tagged = userOp.callData.toLowerCase().endsWith(identifier.toLowerCase())
    console.log('Tag in userOp.callData :', tagged)

    // ─── 3. Sponsor, sign, send ───────────────────────────────────────────
    const paymaster = new CandidePaymaster(paymasterUrl)
    ;[userOp] = await paymaster.createSponsorPaymasterUserOperation(
        smartAccount, userOp, bundlerUrl, sponsorshipPolicyId,
    )
    userOp.signature = smartAccount.signUserOperation(userOp, [ownerKey], chainId)

    console.log('Sending userOp ...')
    const response = await smartAccount.sendUserOperation(userOp, bundlerUrl)
    const receipt = await response.included()

    if (!receipt || !receipt.success) {
        console.log('UserOp did not land.')
        return
    }
    console.log('Included   :', receipt.receipt.transactionHash)

    // ─── 4. Verify the marker on-chain ────────────────────────────────────
    // The bundler wraps your userOp in `EntryPoint.handleOps(ops[], beneficiary)`.
    // The marker lives *inside* the tx input (inside the encoded userOp
    // callData), not at the tail — so use a substring check for tx input.
    // For exact attribution, decode `UserOperationEvent` logs instead.
    const tx = (await sendJsonRpcRequest(
        nodeUrl, 'eth_getTransactionByHash', [receipt.receipt.transactionHash],
    )) as { input: string } | null
    if (tx) {
        console.log('Tag in tx.input        :', tx.input.toLowerCase().includes(identifier.toLowerCase()))
    }

    // ─── 5. How to aggregate in your indexer ──────────────────────────────
    // - Subscribe to `UserOperationEvent` on the EntryPoint contract.
    // - For each event, check whether the userOp's `callData` ends with your
    //   32-byte identifier.
    // - Unique `sender` values = active users. Total matches = userOp volume.
    console.log(
        '\nAttribute userOps by matching this 32-byte suffix on userOp.callData:\n  0x' + identifier,
    )
}

main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err))
    process.exit(1)
})
