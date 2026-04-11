/**
 * https://github.com/safe-global/safe-modules/blob/e907b6c26ba1a7678910610d5a40f3f4fa5603f6/modules/4337/test/utils/webauthn.ts
 * This module provides a minimal shim to emulate the Web Authentication API implemented in browsers. This allows us to
 * write tests where we create and authenticate WebAuthn credentials that are verified on-chain.
 *
 * This implementation is inspired by software authenticators found in the Awesome WebAuthn list [1].
 *
 * [1]: <https://github.com/herrjemand/awesome-webauthn#software-authenticators>
 */

import * as crypto from 'node:crypto'
import { keccak256, sha256, toHex, hexToBytes, toBytes, maxUint256, type Hex } from 'viem'
import * as CBOR from 'cbor'

export interface CredentialCreationOptions {
  publicKey: PublicKeyCredentialCreationOptions
}

export enum UserVerificationRequirement {
  'required',
  'preferred',
  'discouraged',
}

/**
 * Public key credetial creation options, restricted to a subset of options that this module supports.
 * See <https://w3c.github.io/webauthn/#dictionary-makecredentialoptions>.
 */
export interface PublicKeyCredentialCreationOptions {
  rp: { id: string; name: string }
  user: { id: Uint8Array; displayName: string; name: string }
  challenge: Uint8Array
  pubKeyCredParams: {
    type: 'public-key'
    alg: number
  }[]
  attestation?: 'none'
  userVerification?: Exclude<UserVerificationRequirement, UserVerificationRequirement.discouraged>
}

export interface CredentialRequestOptions {
  publicKey: PublicKeyCredentialRequestOptions
}

/**
 * Public key credetial request options, restricted to a subset of options that this module supports.
 * See <https://w3c.github.io/webauthn/#dictionary-assertion-options>.
 */
export interface PublicKeyCredentialRequestOptions {
  challenge: Uint8Array
  rpId: string
  allowCredentials: {
    type: 'public-key'
    id: Uint8Array
  }[]
  // we don't support discouraged user verification
  userVerification?: Exclude<UserVerificationRequirement, UserVerificationRequirement.discouraged>
  attestation?: 'none'
}

/**
 * A created public key credential. See <https://w3c.github.io/webauthn/#iface-pkcredential>.
 */
export interface PublicKeyCredential<AuthenticatorResponse> {
  type: 'public-key'
  id: string
  rawId: ArrayBuffer
  response: AuthenticatorResponse
}

/**
 * The authenticator's response to a client's request for the creation of a new public key credential.
 * See <https://w3c.github.io/webauthn/#iface-authenticatorattestationresponse>.
 */
export interface AuthenticatorAttestationResponse {
  clientDataJSON: ArrayBuffer
  attestationObject: ArrayBuffer
}

/**
 * The authenticator's response to a client's request generation of a new authentication assertion given the WebAuthn Relying Party's challenge.
 * See <https://w3c.github.io/webauthn/#iface-authenticatorassertionresponse>.
 */
export interface AuthenticatorAssertionResponse {
  clientDataJSON: ArrayBuffer
  authenticatorData: ArrayBuffer
  signature: ArrayBuffer
  userHandle: ArrayBuffer
}

class Credential {
  public id: Hex
  public privateKey: crypto.KeyObject
  private publicKeyUncompressed: Uint8Array // 65 bytes: 0x04 || x || y

  constructor(
    public rp: string,
    public user: Uint8Array,
    existingKey?: { x: bigint, y: bigint, privateKeyHex: string },
  ) {
    if (existingKey) {
      // Import existing key from components
      const xBuf = Buffer.from(existingKey.x.toString(16).padStart(64, '0'), 'hex')
      const yBuf = Buffer.from(existingKey.y.toString(16).padStart(64, '0'), 'hex')
      const dBuf = Buffer.from(existingKey.privateKeyHex.replace(/^0x/, '').padStart(64, '0'), 'hex')

      this.publicKeyUncompressed = new Uint8Array(Buffer.concat([Buffer.from([0x04]), xBuf, yBuf]))
      this.privateKey = crypto.createPrivateKey({
        key: { kty: 'EC', crv: 'P-256', x: xBuf.toString('base64url'), y: yBuf.toString('base64url'), d: dBuf.toString('base64url') },
        format: 'jwk',
      })
    } else {
      // Generate new key pair
      const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      this.privateKey = keyPair.privateKey

      const pubJwk = keyPair.publicKey.export({ format: 'jwk' })
      const x = Buffer.from(pubJwk.x!, 'base64url')
      const y = Buffer.from(pubJwk.y!, 'base64url')
      this.publicKeyUncompressed = new Uint8Array(Buffer.concat([Buffer.from([0x04]), x, y]))
    }

    // Credential ID = last 20 bytes of keccak256(pubkey without 0x04 prefix)
    const pubKeyHash = keccak256(toHex(this.publicKeyUncompressed.slice(1)))
    this.id = `0x${pubKeyHash.slice(26)}` as Hex // skip "0x" + 24 hex chars = 12 bytes
  }

  /**
   * Computes the COSE encoded public key for this credential.
   * See <https://datatracker.ietf.org/doc/html/rfc8152>.
   */
  public cosePublicKey(): Buffer {
    const x = this.publicKeyUncompressed.subarray(1, 33)
    const y = this.publicKeyUncompressed.subarray(33, 65)

    const key = new Map()
    key.set(-1, 1) // crv = P-256
    key.set(-2, b2ab(x))
    key.set(-3, b2ab(y))
    key.set(1, 2) // kty = EC2
    key.set(3, -7) // alg = ES256
    return CBOR.encode(key)
  }
}

/**
 * Build authenticator data as a binary buffer.
 * See <https://w3c.github.io/webauthn/#sctn-authenticator-data>
 */
function buildAuthenticatorData(
  rpId: string,
  flags: number,
  signCount: number,
  attestedCredentialData?: Buffer,
): Buffer {
  const rpIdHash = Buffer.from(hexToBytes(sha256(toBytes(rpId))))
  const flagsBuf = Buffer.from([flags])
  const signCountBuf = Buffer.alloc(4)
  signCountBuf.writeUInt32BE(signCount)

  const parts = [rpIdHash, flagsBuf, signCountBuf]
  if (attestedCredentialData) {
    parts.push(attestedCredentialData)
  }
  return Buffer.concat(parts)
}

export class WebAuthnCredentials {
  #credentials: Credential[] = []

  /**
   * This is a shim for `navigator.credentials.create` method.
   * See <https://w3c.github.io/webappsec-credential-management/#dom-credentialscontainer-create>.
   */
  public create({ publicKey }: CredentialCreationOptions): PublicKeyCredential<AuthenticatorAttestationResponse> {
    if (!publicKey.pubKeyCredParams.some(({ alg }) => alg === -7)) {
      throw new Error('unsupported signature algorithm(s)')
    }

    const credential = new Credential(publicKey.rp.id, publicKey.user.id)
    this.#credentials.push(credential)

    const clientData = {
      type: 'webauthn.create',
      challenge: base64UrlEncode(publicKey.challenge).replace(/=*$/, ''),
      origin: `https://${publicKey.rp.id}`,
    }

    const userVerification = publicKey.userVerification ?? 'preferred'
    const uvFlag = userVerification === UserVerificationRequirement.required ? 0x04 : 0x00

    // Build attested credential data: aaguid (16) + credIdLen (2) + credId + coseKey
    const aaguid = Buffer.alloc(16, 0x42)
    const credIdBytes = Buffer.from(hexToBytes(credential.id))
    const credIdLen = Buffer.alloc(2)
    credIdLen.writeUInt16BE(credIdBytes.length)
    const attestedCredentialData = Buffer.concat([aaguid, credIdLen, credIdBytes, credential.cosePublicKey()])

    const authData = buildAuthenticatorData(
      publicKey.rp.id,
      0x41 | uvFlag, // flags = AT (0x40) + UP (0x01) + optionally UV (0x04)
      0,
      attestedCredentialData,
    )

    const attestationObject = { authData, fmt: 'none', attStmt: {} }

    return {
      id: base64UrlEncode(credential.id),
      rawId: b2ab(hexToBytes(credential.id)),
      response: {
        clientDataJSON: b2ab(Buffer.from(JSON.stringify(clientData))),
        attestationObject: b2ab(CBOR.encode(attestationObject)),
      },
      type: 'public-key',
    }
  }

  /**
   * This is a shim for `navigator.credentials.get` method.
   * See <https://w3c.github.io/webappsec-credential-management/#dom-credentialscontainer-get>.
   */
  get({ publicKey }: CredentialRequestOptions): PublicKeyCredential<AuthenticatorAssertionResponse> {
    const credential = publicKey.allowCredentials
      .flatMap(({ id }) => this.#credentials.filter((c) => c.rp === publicKey.rpId && c.id === toHex(id)))
      .at(0)
    if (credential === undefined) {
      throw new Error('credential not found')
    }

    const clientData = {
      type: 'webauthn.get',
      challenge: base64UrlEncode(publicKey.challenge).replace(/=*$/, ''),
      origin: `https://${publicKey.rpId}`,
    }

    const userVerification = publicKey.userVerification ?? 'preferred'
    const uvFlag = userVerification === UserVerificationRequirement.required ? 0x04 : 0x00

    const authenticatorData = buildAuthenticatorData(publicKey.rpId, 0x01 | uvFlag, 0)

    // Sign: authenticatorData || sha256(clientDataJSON)
    const clientDataHash = Buffer.from(hexToBytes(sha256(toBytes(JSON.stringify(clientData)))))
    const dataToSign = Buffer.concat([authenticatorData, clientDataHash])
    const derSignature = crypto.sign('sha256', dataToSign, credential.privateKey)

    return {
      id: base64UrlEncode(credential.id),
      rawId: b2ab(hexToBytes(credential.id)),
      response: {
        clientDataJSON: b2ab(Buffer.from(JSON.stringify(clientData))),
        authenticatorData: b2ab(authenticatorData),
        signature: b2ab(derSignature),
        userHandle: credential.user,
      },
      type: 'public-key',
    }
  }

  /**
   * Import an existing credential from its key components, so it can be used for signing via get().
   * The credential ID is deterministically derived from (x, y), so it does not need to be provided.
   */
  public importCredential(options: {
    rpId: string,
    userId: Uint8Array,
    x: bigint,
    y: bigint,
    privateKeyHex: string,
  }): { id: string, rawId: ArrayBuffer } {
    const credential = new Credential(options.rpId, options.userId, {
      x: options.x,
      y: options.y,
      privateKeyHex: options.privateKeyHex,
    })
    this.#credentials.push(credential)
    return {
      id: base64UrlEncode(credential.id),
      rawId: b2ab(hexToBytes(credential.id)),
    }
  }

  /**
   * Export the private key scalar (d) of the most recently created credential as a hex string.
   * Useful for persisting the credential to environment variables.
   */
  public exportCredentialPrivateKey(): string {
    const cred = this.#credentials[this.#credentials.length - 1]
    if (!cred) throw new Error('no credentials to export')
    const privJwk = cred.privateKey.export({ format: 'jwk' })
    return '0x' + Buffer.from(privJwk.d!, 'base64url').toString('hex')
  }
}

/**
 * Encode bytes using the Base64 URL encoding.
 * See <https://www.rfc-editor.org/rfc/rfc4648#section-5>
 */
export function base64UrlEncode(data: Hex | Uint8Array | ArrayBufferLike): string {
  if (typeof data === 'string') {
    return Buffer.from(hexToBytes(data)).toString('base64url')
  }
  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString('base64url')
  }
  return Buffer.from(new Uint8Array(data)).toString('base64url')
}

function b2ab(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/**
 * Extract the x and y coordinates of the public key from a created public key credential.
 * Inspired from <https://webauthn.guide/#registration>.
 */
export function extractPublicKey(response: AuthenticatorAttestationResponse): { x: bigint; y: bigint } {
  const attestationObject = CBOR.decode(response.attestationObject)
  const authData: Buffer = attestationObject.authData
  const authDataView = new DataView(authData.buffer, authData.byteOffset, authData.byteLength)
  const credentialIdLength = authDataView.getUint16(53)
  const cosePublicKey = authData.subarray(55 + credentialIdLength)
  const key: Map<number, unknown> = CBOR.decode(cosePublicKey)
  const bn = (bytes: Uint8Array) => BigInt(toHex(bytes))
  return {
    x: bn(key.get(-2) as Uint8Array),
    y: bn(key.get(-3) as Uint8Array),
  }
}

/**
 * Compute the additional client data JSON fields. This is the fields other than `type` and
 * `challenge` (including `origin` and any other additional client data fields that may be
 * added by the authenticator).
 *
 * See <https://w3c.github.io/webauthn/#clientdatajson-serialization>
 */
export function extractClientDataFields(response: AuthenticatorAssertionResponse): string {
  const clientDataJSON = new TextDecoder('utf-8').decode(response.clientDataJSON)
  const match = clientDataJSON.match(/^\{"type":"webauthn.get","challenge":"[A-Za-z0-9\-_]{43}",(.*)\}$/)

  if (!match) {
    throw new Error('challenge not found in client data JSON')
  }

  const [, fields] = match
  return toHex(toBytes(fields))
}

/**
 * Extracts the signature into R and S values from the authenticator response.
 *
 * See:
 * - <https://datatracker.ietf.org/doc/html/rfc3279#section-2.2.3>
 * - <https://en.wikipedia.org/wiki/X.690#BER_encoding>
 */
export function extractSignature(response: AuthenticatorAssertionResponse): [bigint, bigint] {
  const check = (x: boolean) => {
    if (!x) {
      throw new Error('invalid signature encoding')
    }
  }

  // Decode the DER signature. Note that we assume that all lengths fit into 8-bit integers,
  // which is true for the kinds of signatures we are decoding but generally false. I.e. this
  // code should not be used in any serious application.
  const view = new DataView(response.signature)

  // check that the sequence header is valid
  check(view.getUint8(0) === 0x30)
  check(view.getUint8(1) === view.byteLength - 2)

  // read r and s
  const readInt = (offset: number) => {
    check(view.getUint8(offset) === 0x02)
    const len = view.getUint8(offset + 1)
    const start = offset + 2
    const end = start + len
    const n = BigInt(toHex(new Uint8Array(view.buffer.slice(start, end))))
    check(n < maxUint256)
    return [n, end] as const
  }
  const [r, sOffset] = readInt(2)
  const [s] = readInt(sOffset)

  return [r, s]
}
