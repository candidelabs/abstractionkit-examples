import { loadEnv, getOrCreateOwner } from '../utils/env'
import {
    SafeAccountV0_3_0,
    SafeMultiChainSigAccountV1,
    MetaTransaction,
    Erc7677Paymaster,
    getFunctionSelector,
    createCallData,
    sendJsonRpcRequest,
} from "abstractionkit"

// ─────────────────────────────────────────────────────────────────────────────
// Migrate a DEPLOYED Safe smart account from EntryPoint v0.7 to EntryPoint v0.9
// (the "0.3.0 module" Safe → the multi-chain-signature module), gas-sponsored.
// ─────────────────────────────────────────────────────────────────────────────
//
//   SafeAccountV0_3_0           → EntryPoint v0.7, Safe4337Module
//                                 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226
//   SafeMultiChainSigAccountV1  → EntryPoint v0.9, Safe4337MultiChainSignatureModule
//                                 0x22939E839e3c0F479B713eAF95e0df128554AEAd
//
// What "upgrading" a deployed Safe means here:
//   A Safe routes ERC-4337 validation through its FALLBACK HANDLER and executes
//   via an ENABLED MODULE. For both versions the 4337 module is BOTH the enabled
//   module AND the fallback handler. So moving a deployed Safe from one EntryPoint
//   to another is purely three self-calls on the Safe:
//     1. disableModule(oldModule)
//     2. enableModule(newModule)
//     3. setFallbackHandler(newModule)
//   After these land, the Safe validates/executes through the new module on the
//   new EntryPoint. The Safe singleton (master copy) does NOT change.
//
// STORAGE CLEARING — none required.
//   Both Safe4337Module (v0.7) and Safe4337MultiChainSignatureModule (v0.9) are
//   completely STATELESS: zero state variables, no mappings, no sstore, no
//   per-account nonce/cache (the nonce lives in the EntryPoint, not the module).
//   Every signature check is computed on the fly from the UserOperation fields.
//   So there is no stale module storage to wipe when swapping modules — the three
//   transactions above are the whole migration.
//
// The migration batch is validated and executed by the OLD (v0.7) module on the
// OLD EntryPoint. Disabling the module that is mid-execution is safe: validation
// has already completed and the EntryPoint will not re-enter the module for this
// op.
//
// This script is self-contained and runs three phases:
//   Phase 1 — deploy a fresh SafeAccountV0_3_0 (EP v0.7)          [sponsored]
//   Phase 2 — migrate it to the v0.9 multi-chain module (EP v0.9) [sponsored]
//   Phase 3 — prove the upgraded account works on EP v0.9 (mint)  [sponsored]
//
// (You could fuse Phase 1 + Phase 2 into a single deploy-and-migrate op — the
//  deploy initCode sets the v0.7 module, and that op's callData carries the
//  migration batch. Kept separate here so each state is observable onchain.)

const OLD_MODULE = SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS // EP v0.7 module
const NEW_MODULE = SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS // EP v0.9 module

// Safe stores its fallback handler at a fixed slot:
//   keccak256("fallback_manager.handler.address")
const FALLBACK_HANDLER_SLOT =
    "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5"

/**
 * Compose the three MetaTransactions that move a deployed Safe from the v0.7
 * module to the v0.9 multi-chain-signature module. No storage clearing step exists
 * because neither module keeps per-account storage.
 */
async function createMigrateToV09MetaTransactions(
    oldAccount: SafeAccountV0_3_0,
    nodeUrl: string,
): Promise<MetaTransaction[]> {
    // Fetches the previous module in the Safe's linked list automatically
    // (the 0x..01 sentinel for a Safe that only has the old 4337 module enabled).
    const disableOldModule = await oldAccount.createDisableModuleMetaTransaction(
        nodeUrl,
        OLD_MODULE,
        oldAccount.accountAddress,
    )

    const enableNewModule = SafeAccountV0_3_0.createEnableModuleMetaTransaction(
        NEW_MODULE,
        oldAccount.accountAddress,
    )

    const setFallbackHandler: MetaTransaction = {
        to: oldAccount.accountAddress,
        value: 0n,
        data: createCallData(
            "0xf08a0323", // setFallbackHandler(address)
            ["address"],
            [NEW_MODULE],
        ),
    }

    return [disableOldModule, enableNewModule, setFallbackHandler]
}

/** Last 20 bytes of a 32-byte storage word, as a checksummable lowercase address. */
function slotToAddress(word: string): string {
    return "0x" + word.slice(-40).toLowerCase()
}

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: ownerPublicAddress, privateKey: ownerPrivateKey } = getOrCreateOwner()

    const paymaster = new Erc7677Paymaster(paymasterUrl)
    // Candide and Pimlico read `sponsorshipPolicyId`; Alchemy reads `policyId`.
    // Send both so the same context is portable across providers; empty = public gas policies.
    const context = sponsorshipPolicyId ? { sponsorshipPolicyId, policyId: sponsorshipPolicyId } : {}

    // No-op self-call: Phase 1 only needs to DEPLOY the Safe; it does nothing else.
    const noOp: MetaTransaction = { to: ownerPublicAddress, value: 0n, data: "0x" }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 1 — Deploy a fresh Safe on EntryPoint v0.7 (the "old" account)
    // ═════════════════════════════════════════════════════════════════════════
    // A Safe's address is deterministic in (owners, salt). Use a unique salt per
    // run so the demo always starts from a fresh, undeployed account and can be
    // re-run with the same owner key. In production you'd pin/store this address.
    const oldAccount = SafeAccountV0_3_0.initializeNewAccount([ownerPublicAddress], {
        c2Nonce: BigInt(Date.now()),
    })
    const accountAddress = oldAccount.accountAddress
    console.log("──────────────────────────────────────────────")
    console.log(`Safe account address: ${accountAddress}`)
    console.log(`Phase 1: deploying Safe on EntryPoint v0.7 (module ${OLD_MODULE})`)

    let deployOp = await oldAccount.createUserOperation([noOp], nodeUrl, bundlerUrl)

    // Single ERC-7677 sponsorship call — works on every EntryPoint, v0.7 included.
    deployOp = (
        await paymaster.createPaymasterUserOperation(
            oldAccount, deployOp, bundlerUrl, context
        )
    ).userOperation

    deployOp.signature = oldAccount.signUserOperation(deployOp, [ownerPrivateKey], chainId)

    const deployReceipt = await (await oldAccount.sendUserOperation(deployOp, bundlerUrl)).included()
    if (deployReceipt == null || !deployReceipt.success) {
        throw new Error("Phase 1 failed — Safe deployment UserOperation was not included successfully.")
    }
    console.log(`Phase 1 included: ${deployReceipt.receipt.transactionHash}`)

    // Sanity check: the v0.7 module is the active module on the fresh Safe.
    if (!(await oldAccount.isModuleEnabled(nodeUrl, OLD_MODULE))) {
        throw new Error("v0.7 module is not enabled after deployment — unexpected state.")
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 2 — Migrate to the v0.9 multi-chain module (validated by v0.7 module)
    // ═════════════════════════════════════════════════════════════════════════
    console.log(`Phase 2: migrating to EntryPoint v0.9 (module ${NEW_MODULE})`)

    const migrationBatch = await createMigrateToV09MetaTransactions(oldAccount, nodeUrl)

    let migrateOp = await oldAccount.createUserOperation(migrationBatch, nodeUrl, bundlerUrl)

    migrateOp = (
        await paymaster.createPaymasterUserOperation(
            oldAccount, migrateOp, bundlerUrl, context
        )
    ).userOperation

    migrateOp.signature = oldAccount.signUserOperation(migrateOp, [ownerPrivateKey], chainId)

    const migrateReceipt = await (await oldAccount.sendUserOperation(migrateOp, bundlerUrl)).included()
    if (migrateReceipt == null || !migrateReceipt.success) {
        throw new Error("Phase 2 failed — migration UserOperation was not included successfully.")
    }
    console.log(`Phase 2 included: ${migrateReceipt.receipt.transactionHash}`)

    // ── Verify the on-chain upgrade (independent of "the tx didn't revert") ──
    const newModuleEnabled = await oldAccount.isModuleEnabled(nodeUrl, NEW_MODULE)
    const oldModuleEnabled = await oldAccount.isModuleEnabled(nodeUrl, OLD_MODULE)
    const fallbackHandler = slotToAddress(
        await sendJsonRpcRequest(nodeUrl, "eth_getStorageAt", [accountAddress, FALLBACK_HANDLER_SLOT, "latest"]) as string,
    )

    console.log("Upgrade verification:")
    console.log(`  new module (v0.9) enabled:  ${newModuleEnabled}`)
    console.log(`  old module (v0.7) enabled:  ${oldModuleEnabled}`)
    console.log(`  fallback handler is:        ${fallbackHandler}`)

    if (!newModuleEnabled || oldModuleEnabled || fallbackHandler !== NEW_MODULE.toLowerCase()) {
        throw new Error("Upgrade verification failed — account is not cleanly on the v0.9 module.")
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 3 — Prove the upgraded account works on EntryPoint v0.9
    // ═════════════════════════════════════════════════════════════════════════
    // Attach the SAME deployed address to the v0.9 account class. nonce > 0 means
    // no initCode; validation now routes through the v0.9 module via the fallback
    // handler we just set. A successful mint is end-to-end proof of the upgrade.
    console.log("Phase 3: sending a sponsored mint through the upgraded v0.9 account")
    const newAccount = new SafeMultiChainSigAccountV1(accountAddress)

    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"
    const mintCallData = createCallData(
        getFunctionSelector("mint(address)"),
        ["address"],
        [accountAddress],
    )
    const mintTx: MetaTransaction = { to: nftContractAddress, value: 0n, data: mintCallData }

    let mintOp = await newAccount.createUserOperation([mintTx], nodeUrl, bundlerUrl)

    mintOp = (
        await paymaster.createPaymasterUserOperation(
            newAccount, mintOp, bundlerUrl, context
        )
    ).userOperation

    mintOp.signature = newAccount.signUserOperation(mintOp, [ownerPrivateKey], chainId)

    const mintReceipt = await (await newAccount.sendUserOperation(mintOp, bundlerUrl)).included()
    if (mintReceipt == null || !mintReceipt.success) {
        throw new Error("Phase 3 failed — the upgraded v0.9 account could not execute a UserOperation.")
    }
    console.log(`Phase 3 included: ${mintReceipt.receipt.transactionHash}`)

    console.log("──────────────────────────────────────────────")
    console.log("Migration complete: Safe upgraded from EntryPoint v0.7 to v0.9, fully sponsored.")
    console.log(`  Account: ${accountAddress}`)
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
})
