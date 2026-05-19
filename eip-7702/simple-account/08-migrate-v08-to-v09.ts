import { loadEnv, getOrCreateOwner } from '../../utils/env'
import {
    Simple7702Account,
    Simple7702AccountV09,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
} from "abstractionkit"

// ─────────────────────────────────────────────────────────────────────────────
// Migrate a delegated Simple7702 EOA from EntryPoint v0.8 to v0.9 — gas-sponsored
// ─────────────────────────────────────────────────────────────────────────────
//
// Key concept:
//   v0.8 and v0.9 are SEPARATE implementation contracts, each behind its own
//   EntryPoint:
//     v0.8 impl: Simple7702Account.DEFAULT_DELEGATEE_ADDRESS
//     v0.9 impl: Simple7702AccountV09.DEFAULT_DELEGATEE_ADDRESS
//
//   "Migrating" is NOT an EntryPoint upgrade, and NOT a revoke. It is simply a
//   NEW EIP-7702 authorization that re-points the EOA at the v0.9 implementation.
//   That authorization rides inside a sponsored UserOperation on the v0.9
//   EntryPoint, so it overwrites the old v0.8 delegation in a single op and the
//   user pays no gas. A revoke (04-revoke-delegation.ts) would cost the EOA gas
//   and is unnecessary here.
//
// This script is self-contained. It runs two phases:
//   Phase 1 — delegate the EOA to v0.8        (sponsored, single-phase paymaster)
//   Phase 2 — migrate the EOA to v0.9         (sponsored, commit/finalize paymaster)
// Each phase mints an NFT to prove the account executes at that EntryPoint.

const NFT_CONTRACT = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336"

async function main(): Promise<void> {
    const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()
    const { publicAddress: eoaAddress, privateKey } = getOrCreateOwner()

    const paymaster = new CandidePaymaster(paymasterUrl)

    // Shared demo action: mint one NFT to the EOA.
    const mintNft = {
        to: NFT_CONTRACT,
        value: 0n,
        data: createCallData(getFunctionSelector('mint(address)'), ["address"], [eoaAddress]),
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 1 — Delegate the EOA to the v0.8 implementation (sponsored)
    // ═════════════════════════════════════════════════════════════════════════
    const v08 = new Simple7702Account(eoaAddress)
    console.log(`Phase 1: delegating EOA to v0.8 impl ${v08.delegateeAddress}`)

    let v08Op = await v08.createUserOperation(
        [mintNft],
        nodeUrl,
        bundlerUrl,
        { eip7702Auth: { chainId } },
    )

    // eip7702Auth is null if the EOA is already delegated to this impl.
    if (v08Op.eip7702Auth) {
        v08Op.eip7702Auth = createAndSignEip7702DelegationAuthorization(
            BigInt(v08Op.eip7702Auth.chainId),
            v08Op.eip7702Auth.address,
            BigInt(v08Op.eip7702Auth.nonce),
            privateKey,
        )
    }

    // v0.8 EntryPoint: single-phase paymaster sponsorship (see 01-upgrade-eoa.ts).
    const v08Sponsored = await paymaster.createSponsorPaymasterUserOperation(
        v08, v08Op, bundlerUrl, sponsorshipPolicyId,
    )
    v08Op = v08Sponsored.userOperation

    v08Op.signature = v08.signUserOperation(v08Op, privateKey, chainId)

    const v08Receipt = await (await v08.sendUserOperation(v08Op, bundlerUrl)).included()
    if (v08Receipt == null || !v08Receipt.success) {
        console.log("Phase 1 failed — could not establish v0.8 delegation. Aborting.")
        return
    }
    console.log(`Phase 1 included: ${v08Receipt.receipt.transactionHash}`)

    if (!(await v08.isDelegatedToThisAccount(nodeUrl))) {
        console.log("EOA is not delegated to the v0.8 impl. Aborting migration.")
        return
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 2 — Migrate the EOA to the v0.9 implementation (sponsored, no revoke)
    // ═════════════════════════════════════════════════════════════════════════
    const v09 = new Simple7702AccountV09(eoaAddress)
    console.log(`Phase 2: migrating EOA to v0.9 impl ${v09.delegateeAddress}`)

    let v09Op = await v09.createUserOperation(
        [mintNft],
        nodeUrl,
        bundlerUrl,
        { eip7702Auth: { chainId } },
    )

    // The EOA is on the v0.8 impl, not v0.9, so eip7702Auth is returned: sign a
    // fresh authorization re-pointing the EOA at the v0.9 impl. Submitting it
    // overwrites the v0.8 delegation — no separate revoke transaction needed.
    if (!v09Op.eip7702Auth) {
        console.log("No eip7702Auth returned — EOA already on v0.9. Nothing to migrate.")
        return
    }
    v09Op.eip7702Auth = createAndSignEip7702DelegationAuthorization(
        BigInt(v09Op.eip7702Auth.chainId),
        v09Op.eip7702Auth.address,
        BigInt(v09Op.eip7702Auth.nonce),
        privateKey,
    )

    // v0.9 EntryPoint: commit/finalize paymaster flow (see 03-upgrade-eoa-ep-v09.ts).
    // The paymaster reads the v0.9 EntryPoint from the account — no entrypoint override.
    console.log("Paymaster commit: estimating gas...")
    const v09Commit = await paymaster.createSponsorPaymasterUserOperation(
        v09, v09Op, bundlerUrl, sponsorshipPolicyId, { signingPhase: "commit" },
    )
    v09Op = v09Commit.userOperation

    v09Op.signature = v09.signUserOperation(v09Op, privateKey, chainId)

    console.log("Paymaster finalize: getting final paymasterData...")
    const v09Finalize = await paymaster.createSponsorPaymasterUserOperation(
        v09, v09Op, bundlerUrl, sponsorshipPolicyId, { signingPhase: "finalize" },
    )
    v09Op = v09Finalize.userOperation

    const v09Receipt = await (await v09.sendUserOperation(v09Op, bundlerUrl)).included()
    if (v09Receipt == null || !v09Receipt.success) {
        console.log("Phase 2 failed — migration UserOperation was not included successfully.")
        return
    }
    console.log(`Phase 2 included: ${v09Receipt.receipt.transactionHash}`)

    // ═════════════════════════════════════════════════════════════════════════
    // Verify the final delegation state
    // ═════════════════════════════════════════════════════════════════════════
    const onV09 = await v09.isDelegatedToThisAccount(nodeUrl)
    const stillOnV08 = await v08.isDelegatedToThisAccount(nodeUrl)

    console.log("──────────────────────────────────────────────")
    console.log("Migration summary")
    console.log(`  v0.8 impl:               ${v08.delegateeAddress}`)
    console.log(`  v0.9 impl:               ${v09.delegateeAddress}`)
    console.log(`  Delegated to v0.9 now:   ${onV09}`)
    console.log(`  Still delegated to v0.8: ${stillOnV08}`)

    if (onV09 && !stillOnV08) {
        console.log("Migration complete: EOA moved from EntryPoint v0.8 to v0.9, fully sponsored.")
    } else {
        console.log("Migration did not produce the expected delegation state.")
    }
}

main()
