/**
 * Multisig 2-of-2 Passkey + EOA Safe — Docs-example flow, with a
 * pre-existing sortSignatures bug that makes it fail intermittently.
 *
 * Implements the flow documented at
 *   https://docs.candide.dev/wallet/plugins/passkeys/#multisig
 *
 *   SafeAccount.initializeNewAccount(
 *     [webauthPublicKey, eoaPublicKey],
 *     { threshold: 2 },
 *   )
 *
 * Bug (pre-fix, abstractionkit < 0.3.3):
 *   `SafeAccount.getSignerLowerCaseAddress` — the sort key used by
 *   `sortSignatures` — returns a WebAuthn signer's per-owner
 *   deterministic verifier address regardless of `isInit`. But
 *   `buildSignaturesFromSingerSignaturePairs` packs the shared-signer
 *   address (`0xfD90…`) at `isInit=true`. For `(passkey, EOA)` pairs
 *   where `passkey_deterministic < EOA ≤ SHARED_SIGNER`, the sort key
 *   and pack key land on opposite sides of the EOA address, producing
 *   a packed signature that isn't strictly ascending by on-chain
 *   signer address. Safe's `checkNSignatures` then reverts with
 *   `GS026` ("signatures not sorted") during `validateUserOp`, which
 *   the bundler surfaces as "Invalid UserOp signature". Roughly
 *   25-30% of random pairs trigger it.
 *
 * Fix (abstractionkit ≥ 0.3.3):
 *   `getSignerLowerCaseAddress` now honors `overrides.isInit` and
 *   mirrors whatever `buildSignaturesFromSingerSignaturePairs` will
 *   emit. Sort key matches pack key at both `isInit=true` and
 *   `isInit=false`.
 *
 * What this script does
 *   1. Generates a fresh passkey + fresh EOA.
 *   2. Analyzes whether the pair will trigger the bug, prints the
 *      sort vs pack order so you can see exactly why.
 *   3. Initializes a Safe at threshold 2-of-2 with both owners
 *      (docs-recommended pattern) and submits a single sponsored op
 *      signed by both.
 *   4. Reports the outcome.
 *
 *   Run against abstractionkit < 0.3.3 → will fail on bug-triggering
 *   pairs. Re-run until one is produced (not guaranteed on first try).
 *   Run against abstractionkit ≥ 0.3.3 → all pairs succeed.
 *
 * Note: uses the simulated WebAuthn authenticator from ./webauthn.ts.
 * In a real browser app, use `navigator.credentials`.
 */

import { loadEnv } from '../utils/env'
import { hexToBytes, keccak256, toBytes, numberToBytes } from 'viem'
import { Wallet } from 'ethers'
import {
  SafeAccountV0_3_0 as SafeAccount,
  MetaTransaction,
  CandidePaymaster,
  getFunctionSelector,
  createCallData,
  WebauthnPublicKey,
  WebauthnSignatureData,
  SignerSignaturePair,
} from 'abstractionkit'

import {
  UserVerificationRequirement,
  WebAuthnCredentials,
  extractClientDataFields,
  extractPublicKey,
  extractSignature,
} from './webauthn'

async function main(): Promise<void> {
  const { chainId, bundlerUrl, nodeUrl, paymasterUrl, sponsorshipPolicyId } = loadEnv()

  // Simulated WebAuthn authenticator — browsers replace with navigator.credentials
  const navigator = { credentials: new WebAuthnCredentials() }

  // ─── Step 1: generate passkey + EOA ──────────────────────────────────
  const credential = navigator.credentials.create({
    publicKey: {
      rp: { name: 'Safe', id: 'safe.global' },
      user: {
        id: hexToBytes(keccak256(toBytes('multisig-demo'))),
        name: 'multisig-demo',
        displayName: 'Multisig Demo',
      },
      challenge: numberToBytes(Date.now()),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    },
  })
  const passkeyPubkeyRaw = extractPublicKey(credential.response)
  const passkeyPubkey: WebauthnPublicKey = {
    x: passkeyPubkeyRaw.x,
    y: passkeyPubkeyRaw.y,
  }

  const eoa = Wallet.createRandom()
  const eoaAddress = eoa.address
  const eoaPrivateKey = eoa.privateKey

  // ─── Step 2: analyze whether this pair triggers the bug ──────────────
  const detVerifier = SafeAccount.createWebAuthnSignerVerifierAddress(
    passkeyPubkey.x,
    passkeyPubkey.y,
  ).toLowerCase()
  const sharedSigner = SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER.toLowerCase()
  const eoaLower = eoaAddress.toLowerCase()

  // At isInit=true, abstractionkit < 0.3.3 sorts by deterministic
  // verifier, but packs the shared signer. These addresses can sort on
  // opposite sides of the EOA.
  const sortKeyOrder = detVerifier < eoaLower ? 'passkey < EOA' : 'EOA < passkey'
  const packKeyOrder = sharedSigner < eoaLower ? 'passkey < EOA' : 'EOA < passkey'
  const bugTriggering = sortKeyOrder !== packKeyOrder

  console.log('─────────────────────────────────────────────')
  console.log('passkey deterministic verifier:', detVerifier)
  console.log('shared signer address         :', sharedSigner)
  console.log('EOA address                   :', eoaLower)
  console.log('sort key order (pre-fix)      :', sortKeyOrder)
  console.log('pack key order                :', packKeyOrder)
  console.log(
    'bug-triggering pair           :',
    bugTriggering
      ? '★ YES — pre-fix abstractionkit will reject this with "Invalid UserOp signature"'
      : 'no (lucky pair — re-run until a bug-triggering pair is produced)',
  )
  console.log('─────────────────────────────────────────────\n')

  // ─── Step 3: build the 2-of-2 Safe ───────────────────────────────────
  // Passkey must be listed first (abstractionkit requires the WebAuthn
  // owner as the first entry when a Safe is initialized with a mix).
  const smartAccount = SafeAccount.initializeNewAccount(
    [passkeyPubkey, eoaAddress],
    { threshold: 2 },
  )
  console.log('Safe address (2-of-2):', smartAccount.accountAddress)

  // ─── Step 4: build a UserOp (mint an NFT during deploy) ──────────────
  const nftContractAddress = '0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336'
  const mintCallData = createCallData(
    getFunctionSelector('mint(address)'),
    ['address'],
    [smartAccount.accountAddress],
  )
  const transaction: MetaTransaction = {
    to: nftContractAddress,
    value: 0n,
    data: mintCallData,
  }

  try {
    let userOperation = await smartAccount.createUserOperation(
      [transaction],
      nodeUrl,
      bundlerUrl,
      { expectedSigners: [passkeyPubkey, eoaAddress] },
    )

    const paymaster = new CandidePaymaster(paymasterUrl)
    const { userOperation: sponsoredOp } = await paymaster.createSponsorPaymasterUserOperation(
      smartAccount,
      userOperation,
      bundlerUrl,
      sponsorshipPolicyId,
    )
    userOperation = sponsoredOp

    // ─── Step 5: sign with both owners ────────────────────────────────
    const safeOpHash = SafeAccount.getUserOperationEip712Hash(userOperation, chainId)

    // Passkey signature
    const assertion = navigator.credentials.get({
      publicKey: {
        challenge: hexToBytes(safeOpHash as `0x${string}`),
        rpId: 'safe.global',
        allowCredentials: [{ type: 'public-key', id: new Uint8Array(credential.rawId) }],
        userVerification: UserVerificationRequirement.required,
      },
    })
    const webauthnSigData: WebauthnSignatureData = {
      authenticatorData: assertion.response.authenticatorData,
      clientDataFields: extractClientDataFields(assertion.response),
      rs: extractSignature(assertion.response),
    }
    const passkeyPair: SignerSignaturePair = {
      signer: passkeyPubkey,
      signature: SafeAccount.createWebAuthnSignature(webauthnSigData),
    }

    // EOA signature
    const eoaSignature = new Wallet(eoaPrivateKey).signingKey.sign(safeOpHash).serialized
    const eoaPair: SignerSignaturePair = {
      signer: eoaAddress,
      signature: eoaSignature,
    }

    userOperation.signature = SafeAccount.formatSignaturesToUseroperationSignature(
      [passkeyPair, eoaPair],
      { isInit: userOperation.nonce === 0n },
    )

    // ─── Step 6: submit ───────────────────────────────────────────────
    console.log('\nSending UserOperation...')
    const response = await smartAccount.sendUserOperation(userOperation, bundlerUrl)
    console.log('Waiting for inclusion...')
    const receipt = await response.included()

    if (receipt == null) {
      console.log('❌ Receipt not found (timeout)')
      process.exit(1)
    }
    if (!receipt.success) {
      console.log('❌ UserOperation failed on-chain')
      console.log(receipt)
      process.exit(1)
    }
    console.log(`✅ Minted: ${receipt.receipt.transactionHash}`)
    if (bugTriggering) {
      console.log(
        '(abstractionkit ≥ 0.3.3 — sort fix applied; pre-fix this pair would have failed)',
      )
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (bugTriggering) {
      console.error(
        '\nThis pair was bug-triggering. The expected pre-fix failure looks like:',
      )
      console.error('  AbstractionKitError: Invalid UserOp signature or paymaster signature')
      console.error('                       (code: INVALID_SIGNATURE, errno: -32507)')
      console.error('\nThe bundler-reported "Invalid UserOp signature" surfaces Safe')
      console.error('reverting internally with GS026 ("signatures not sorted") because')
      console.error('the packed signature entries are not in strictly ascending order')
      console.error('by on-chain signer address. Upgrade abstractionkit to ≥ 0.3.3.')
    }
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
