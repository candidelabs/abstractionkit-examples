/**
 * Passkeys Example using Safe Passkeys v0.2.1
 *
 * This example demonstrates:
 * 1. Creating a Smart Account with passkey (WebAuthn) authentication
 * 2. Sending multiple UserOperations with the same passkey
 * 3. Using Safe Passkeys v0.2.1 contract overrides
 *
 * Key Difference from index.ts:
 * - This uses SPECIFIC v0.2.1 contract addresses (see below)
 * - index.ts uses AbstractionKit's default/built-in passkey contracts
 * - These overrides are required for EVERY operation (not just deployment)
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

// ========================================
// Safe Passkeys v0.2.1 Contract Addresses
// ========================================
// These are the deployed contracts for passkey-based signers on Arbitrum Sepolia.
// These overrides tell AbstractionKit to use v0.2.1 instead of the default version.
// They must be included in EVERY operation (not just deployment).
//
// - webAuthnSharedSigner: Validates WebAuthn signatures on-chain
// - webAuthnSignerFactory: Factory contract to deploy new passkey signer instances
// - webAuthnSignerSingleton: Implementation contract for passkey signers
// - eip7212WebAuthnContractVerifier: EIP-7212 compliant verifier for this chain
// - webAuthnSignerProxyCreationCode: Bytecode for deploying signer proxies

const webAuthnSharedSigner = "0x94a4F6affBd8975951142c3999aEAB7ecee555c2";
const webAuthnSignerFactory = "0x1d31F259eE307358a26dFb23EB365939E8641195";
const webAuthnSignerSingleton = "0x4E27b51350e6c2083EE19011120F50DAfEc5CA50";
const eip7212WebAuthnContractVerifier = "0xA86e0054C51E4894D88762a017ECc5E5235f5DBA";
const webAuthnSignerProxyCreationCode = "0x610100346100ad57601f6101b538819003918201601f19168301916001600160401b038311848410176100b2578084926080946040528339810103126100ad578051906001600160a01b03821682036100ad5760208101516040820151606090920151926001600160b01b03841684036100ad5760805260a05260c05260e05260405160ec90816100c98239608051816082015260a05181604d015260c051816027015260e0518160010152f35b600080fd5b634e487b7160e01b600052604160045260246000fdfe7f000000000000000000000000000000000000000000000000000000000000000060b63601527f000000000000000000000000000000000000000000000000000000000000000060a03601527f000000000000000000000000000000000000000000000000000000000000000036608001523660006080376000806056360160807f00000000000000000000000000000000000000000000000000000000000000005af43d600060803e60b1573d6080fd5b3d6080f3fea26469706673582212201660515548d15702d720bbc046b457ca85e941a4559ab9f9518488e4c82e5ee964736f6c634300081a0033"

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
    [webauthPublicKey],
    {
      webAuthnSharedSigner,
      eip7212WebAuthnContractVerifierForSharedSigner: eip7212WebAuthnContractVerifier,
    }
  )

  console.log("Account address:", smartAccount.accountAddress)

  // ========================================
  // Step 3: USER OPERATION - Mint NFT
  // ========================================

  // Construct the NFT mint transaction
  // You can use ethers.js/viem or AbstractionKit helpers to create calldata
  const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
  const mintFunctionSignature = 'mint(address)';
  const mintFunctionSelector = getFunctionSelector(mintFunctionSignature);
  const mintTransactionCallData = createCallData(
    mintFunctionSelector,
    ["address"],
    [smartAccount.accountAddress]
  );

  const transaction1: MetaTransaction = {
    to: nftContractAddress,
    value: 0n,
    data: mintTransactionCallData,
  }

  try {
    // Create UserOperation with v0.2.1 overrides
    let userOperation = await smartAccount.createUserOperation(
      [transaction1],
      nodeUrl,
      bundlerUrl,
      {
        expectedSigners: [webauthPublicKey],
        webAuthnSharedSigner,
        webAuthnSignerFactory,
        webAuthnSignerSingleton,
        eip7212WebAuthnContractVerifier,
        webAuthnSignerProxyCreationCode,
      }
    )

    // Request paymaster sponsorship
    let paymaster: CandidePaymaster = new CandidePaymaster(paymasterUrl)
    const { userOperation: paymasterUserOperation } = await paymaster.createSponsorPaymasterUserOperation(
      smartAccount,
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

    // Format signature with v0.2.1 overrides (required for every operation)
    userOperation.signature = SafeAccount.formatSignaturesToUseroperationSignature(
      [SignerSignaturePair],
      {
        isInit: userOperation.nonce == 0n,
        webAuthnSharedSigner,
        webAuthnSignerFactory,
        webAuthnSignerSingleton,
        eip7212WebAuthnContractVerifier,
        webAuthnSignerProxyCreationCode,
      }
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

    if (userOperationReceiptResult == null) {
      console.log("Receipt not found (timeout)")
      return;
    } else if (userOperationReceiptResult.success) {
      console.log("\nFirst NFT minted:", userOperationReceiptResult.receipt.transactionHash)
    } else {
      console.log("UserOperation failed")
      console.log(userOperationReceiptResult)
      return;
    }
  } catch (error: any) {
    console.error("Error in UserOperation:", error.message)
    if (error.message.includes("AA21")) {
      console.log("  → Account needs funding or paymaster sponsorship (AA21 error)")
    }
    throw error;
  }

  console.log("Completed: NFT minted successfully")
}

main()