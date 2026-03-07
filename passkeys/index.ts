/**
 * Passkeys Example (Default Version)
 *
 * This example demonstrates passkey authentication using AbstractionKit's
 * built-in/default passkey contracts (no version overrides).
 *
 * For using specific Safe Passkeys v0.2.1 contracts, see: passkeys-v0.2.1.ts
 *
 * Note: This example uses simulated WebAuthn for demonstration purposes.
 * In a real browser application, use the native navigator.credentials API.
 */

import * as dotenv from 'dotenv'
import { hexToBytes, keccak256, toBytes, numberToBytes } from 'viem'
import {
  SafeAccountV0_3_0 as SafeAccount,
  MetaTransaction,
  CandidePaymaster,
  getFunctionSelector,
  createCallData,
  WebauthnPublicKey,
  WebauthnSignatureData,
  SignerSignaturePair,
} from "abstractionkit";

import {
  UserVerificationRequirement,
  WebAuthnCredentials,
  extractClientDataFields,
  extractPublicKey,
  extractSignature
} from './webauthn';

async function main(): Promise<void> {
  // Load environment variables
  dotenv.config()

  // Validate required environment variables
  const requiredEnvVars = ['CHAIN_ID', 'BUNDLER_URL', 'NODE_URL', 'PAYMASTER_URL'];
  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }

  const chainId = BigInt(process.env.CHAIN_ID as string)
  const bundlerUrl = process.env.BUNDLER_URL as string
  const nodeUrl = process.env.NODE_URL as string
  const paymasterUrl = process.env.PAYMASTER_URL as string;
  const sponsorshipPolicyId = process.env.SPONSORSHIP_POLICY_ID as string;

  // Simulated WebAuthn navigator for demonstration
  // In a real browser, you would use: window.navigator.credentials
  const navigator = {
    credentials: new WebAuthnCredentials(),
  }

  // ========================================
  // Step 1: Create Passkey Credential
  // ========================================
  // This simulates the browser's WebAuthn credential creation.
  // In production, this would prompt the user for biometric authentication.

  const credential = navigator.credentials.create({
    publicKey: {
      rp: {
        name: 'Safe',
        id: 'safe.global',
      },
      user: {
        id: hexToBytes(keccak256(toBytes('chucknorris'))),
        name: 'chucknorris',
        displayName: 'Chuck Norris',
      },
      challenge: numberToBytes(Date.now()),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    },
  })

  // Extract the public key from the credential
  const publicKey = extractPublicKey(credential.response)

  const webauthPublicKey: WebauthnPublicKey = {
    x: publicKey.x,
    y: publicKey.y,
  }

  // ========================================
  // Step 2: Initialize Smart Account
  // ========================================
  // initializeNewAccount is only needed when the smart account has not been
  // deployed yet (for its first UserOperation).
  //
  // For subsequent operations, you can use: new SafeAccount(accountAddress)

  let smartAccount = SafeAccount.initializeNewAccount(
    [webauthPublicKey]
  )

  console.log("Account address:", smartAccount.accountAddress)

  // ========================================
  // Step 3: Create UserOperation
  // ========================================

  // Construct the NFT mint transaction
  // You can use ethers.js or AbstractionKit helpers to create calldata
  const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
  const mintFunctionSignature = 'mint(address)';
  const mintFunctionSelector = getFunctionSelector(mintFunctionSignature);
  const mintTransactionCallData = createCallData(
    mintFunctionSelector,
    ["address"],
    [smartAccount.accountAddress]
  );

  const transaction: MetaTransaction = {
    to: nftContractAddress,
    value: 0n,
    data: mintTransactionCallData,
  }

  try {
    // createUserOperation determines the nonce, fetches gas prices, and estimates gas limits
    // You can batch multiple transactions in the array: [transaction1, transaction2]
    let userOperation = await smartAccount.createUserOperation(
      [transaction],
      nodeUrl,
      bundlerUrl,
      {
        expectedSigners: [webauthPublicKey],
      }
    )

    // Request paymaster sponsorship
    let paymaster: CandidePaymaster = new CandidePaymaster(paymasterUrl)
    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
      userOperation,
      bundlerUrl,
      sponsorshipPolicyId,
    )
    userOperation = paymasterUserOperation;

    // Sign the UserOperation with the passkey
    const safeInitOpHash = SafeAccount.getUserOperationEip712Hash(
      userOperation,
      chainId,
    )

    // Simulate passkey authentication (biometric prompt in real browser)
    const assertion = navigator.credentials.get({
      publicKey: {
        challenge: hexToBytes(safeInitOpHash as `0x${string}`),
        rpId: 'safe.global',
        allowCredentials: [{ type: 'public-key', id: new Uint8Array(credential.rawId) }],
        userVerification: UserVerificationRequirement.required,
      },
    })

    const webauthSignatureData: WebauthnSignatureData = {
      authenticatorData: assertion.response.authenticatorData,
      clientDataFields: extractClientDataFields(assertion.response),
      rs: extractSignature(assertion.response),
    }

    const webauthSignature: string = SafeAccount.createWebAuthnSignature(
      webauthSignatureData
    )

    const SignerSignaturePair: SignerSignaturePair = {
      signer: webauthPublicKey,
      signature: webauthSignature,
    }

    // Format the signature
    userOperation.signature = SafeAccount.formatSignaturesToUseroperationSignature(
      [SignerSignaturePair],
      { isInit: userOperation.nonce == 0n }
    )

    // Display the complete UserOperation (with signature and paymaster data)
    console.log("\nUserOperation (ready to send):")
    console.log(userOperation)

    // Send UserOperation and wait for inclusion
    console.log("\nSending UserOperation...")
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
      userOperation, bundlerUrl
    )

    console.log("UserOperation sent. Waiting for inclusion...")
    let userOperationReceiptResult = await sendUserOperationResponse.included()

    if (userOperationReceiptResult.success) {
      console.log("\nNFT minted:", userOperationReceiptResult.receipt.transactionHash)
    } else {
      console.log("UserOperation failed")
      console.log(userOperationReceiptResult)
    }
  } catch (error: any) {
    console.error("Error:", error.message)
    if (error.message.includes("AA21")) {
      console.log("  → Account needs funding or paymaster sponsorship (AA21 error)")
    } else if (error.message.includes("AA25")) {
      console.log("  → Invalid nonce - previous transaction may not be confirmed (AA25 error)")
    }
    throw error;
  }
}

main()
