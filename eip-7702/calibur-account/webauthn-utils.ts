/**
 * WebAuthn Simulator for Calibur7702Account
 *
 * Emulates the browser's Web Authentication API for demonstration purposes.
 * In a real browser application, use the native navigator.credentials API.
 *
 * Adapted for Calibur's WebAuthnSignatureData format which requires:
 * - authenticatorData (hex), clientDataJSON (string),
 * - challengeIndex, typeIndex, r, s
 *
 * Uses Node.js crypto for P-256 key operations (no extra dependencies).
 */

import * as crypto from 'crypto'
import * as CBOR from 'cbor'

// ─── Types ──────────────────────────────────────────────────────────────

export interface CredentialCreationOptions {
    publicKey: {
        rp: { id: string; name: string }
        user: { id: Uint8Array; displayName: string; name: string }
        challenge: Uint8Array
        pubKeyCredParams: { type: 'public-key'; alg: number }[]
    }
}

export interface CredentialRequestOptions {
    publicKey: {
        challenge: Uint8Array
        rpId: string
        allowCredentials: { type: 'public-key'; id: Uint8Array }[]
    }
}

export interface AuthenticatorAttestationResponse {
    clientDataJSON: ArrayBuffer
    attestationObject: ArrayBuffer
}

export interface AuthenticatorAssertionResponse {
    clientDataJSON: ArrayBuffer
    authenticatorData: ArrayBuffer
    signature: ArrayBuffer
    userHandle: Uint8Array
}

export interface PublicKeyCredential<T> {
    type: 'public-key'
    id: string
    rawId: ArrayBuffer
    response: T
}

// ─── Helpers ────────────────────────────────────────────────────────────

function base64UrlEncode(data: Uint8Array | ArrayBuffer): string {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    return Buffer.from(bytes).toString('base64url')
}

function b2ab(buf: Uint8Array | Buffer): ArrayBuffer {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// ─── Credential ─────────────────────────────────────────────────────────

class Credential {
    public id: Buffer
    public keyPair: { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject }
    public x: bigint
    public y: bigint

    constructor(
        public rp: string,
        public user: Uint8Array,
    ) {
        const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
        this.keyPair = kp

        // Extract x, y from the public key
        const pubKeyDer = kp.publicKey.export({ type: 'spki', format: 'der' })
        const uncompressedKey = pubKeyDer.subarray(-64)
        this.x = BigInt('0x' + uncompressedKey.subarray(0, 32).toString('hex'))
        this.y = BigInt('0x' + uncompressedKey.subarray(32, 64).toString('hex'))

        // credential id = hash of public key coordinates
        const idHash = crypto.createHash('sha256').update(uncompressedKey).digest()
        this.id = idHash.subarray(0, 20)
    }

    public cosePublicKey(): Buffer {
        const pubKeyDer = this.keyPair.publicKey.export({ type: 'spki', format: 'der' })
        const uncompressedKey = pubKeyDer.subarray(-64)
        const x = uncompressedKey.subarray(0, 32)
        const y = uncompressedKey.subarray(32, 64)

        const key = new Map()
        key.set(-1, 1) // crv = P-256
        key.set(-2, b2ab(x))
        key.set(-3, b2ab(y))
        key.set(1, 2) // kty = EC2
        key.set(3, -7) // alg = ES256

        return Buffer.from(CBOR.encode(key))
    }
}

// ─── WebAuthn Credentials Simulator ─────────────────────────────────────

export class WebAuthnCredentials {
    private credentials: Credential[] = []

    /**
     * Simulates navigator.credentials.create()
     * Creates a new passkey credential.
     */
    public create(
        { publicKey }: CredentialCreationOptions
    ): PublicKeyCredential<AuthenticatorAttestationResponse> {
        if (!publicKey.pubKeyCredParams.some(({ alg }) => alg === -7)) {
            throw new Error('unsupported signature algorithm(s)')
        }

        const credential = new Credential(publicKey.rp.id, publicKey.user.id)
        this.credentials.push(credential)

        const clientData = {
            type: 'webauthn.create',
            challenge: base64UrlEncode(publicKey.challenge),
            origin: `https://${publicKey.rp.id}`,
        }

        // Build authenticator data with attested credential
        const rpIdHash = crypto.createHash('sha256').update(publicKey.rp.id).digest()
        const flags = Buffer.from([0x45]) // attested_data + user_present + user_verified
        const signCount = Buffer.alloc(4) // 0
        const aaguid = Buffer.alloc(16, 0x42)
        const credIdLen = Buffer.alloc(2)
        credIdLen.writeUInt16BE(credential.id.length)
        const coseKey = credential.cosePublicKey()

        const authData = Buffer.concat([
            rpIdHash, flags, signCount, aaguid, credIdLen,
            credential.id, coseKey,
        ])

        const attestationObject = CBOR.encode({
            authData,
            fmt: 'none',
            attStmt: {},
        })

        return {
            id: base64UrlEncode(credential.id),
            rawId: b2ab(credential.id),
            response: {
                clientDataJSON: b2ab(Buffer.from(JSON.stringify(clientData))),
                attestationObject: b2ab(Buffer.from(attestationObject)),
            },
            type: 'public-key',
        }
    }

    /**
     * Simulates navigator.credentials.get()
     * Signs a challenge with an existing passkey.
     */
    get(
        { publicKey }: CredentialRequestOptions
    ): PublicKeyCredential<AuthenticatorAssertionResponse> {
        const credential = publicKey.allowCredentials
            .flatMap(({ id }) =>
                this.credentials.filter(
                    (c) => c.rp === publicKey.rpId &&
                        c.id.toString('hex') === Buffer.from(id).toString('hex')
                )
            )
            .at(0)

        if (!credential) {
            throw new Error('credential not found')
        }

        const clientData = {
            type: 'webauthn.get',
            challenge: base64UrlEncode(publicKey.challenge),
            origin: `https://${publicKey.rpId}`,
        }

        const rpIdHash = crypto.createHash('sha256').update(publicKey.rpId).digest()
        const flags = Buffer.from([0x05]) // user_present + user_verified
        const signCount = Buffer.alloc(4) // 0

        const authenticatorData = Buffer.concat([rpIdHash, flags, signCount])
        const clientDataJSON = JSON.stringify(clientData)
        const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest()

        const signedData = Buffer.concat([authenticatorData, clientDataHash])

        // Sign with P-256 / SHA-256 (ES256)
        // DER encoding is the standard WebAuthn assertion signature format
        const signature = crypto.sign('sha256', signedData, {
            key: credential.keyPair.privateKey,
            dsaEncoding: 'der',
        })

        return {
            id: base64UrlEncode(credential.id),
            rawId: b2ab(credential.id),
            response: {
                clientDataJSON: b2ab(Buffer.from(clientDataJSON)),
                authenticatorData: b2ab(authenticatorData),
                signature: b2ab(signature),
                userHandle: credential.user,
            },
            type: 'public-key',
        }
    }
}

// ─── Extraction Helpers ─────────────────────────────────────────────────

/**
 * Extract x, y coordinates from a credential attestation response.
 */
export function extractPublicKey(
    response: AuthenticatorAttestationResponse
): { x: bigint; y: bigint } {
    const attestationObject = CBOR.decode(Buffer.from(response.attestationObject))
    // Copy authData into a fresh Buffer to avoid shared ArrayBuffer pool issues.
    // Without this, DataView offsets would be wrong because Node.js Buffers
    // share a single underlying ArrayBuffer.
    const authData = Uint8Array.from(attestationObject.authData)
    const authDataView = new DataView(authData.buffer, authData.byteOffset, authData.byteLength)
    const credentialIdLength = authDataView.getUint16(53)
    const cosePublicKey = authData.slice(55 + credentialIdLength)
    const key: Map<number, unknown> = CBOR.decode(Buffer.from(cosePublicKey))
    const bn = (bytes: Uint8Array) => BigInt('0x' + Buffer.from(bytes).toString('hex'))
    return {
        x: bn(key.get(-2) as Uint8Array),
        y: bn(key.get(-3) as Uint8Array),
    }
}

/**
 * Extract r, s signature components from a DER-encoded assertion signature.
 * Normalizes s to low-s form for secp256r1.
 */
export function extractSignature(
    response: AuthenticatorAssertionResponse
): { r: bigint; s: bigint } {
    const view = new DataView(response.signature)

    const readInt = (offset: number) => {
        if (view.getUint8(offset) !== 0x02) throw new Error('invalid signature encoding')
        const len = view.getUint8(offset + 1)
        const start = offset + 2
        const end = start + len
        const n = BigInt('0x' + Buffer.from(new Uint8Array(view.buffer.slice(start, end))).toString('hex'))
        return [n, end] as const
    }

    const [r, sOffset] = readInt(2)
    let [s] = readInt(sOffset)

    // Normalize to low-s (required by Calibur's on-chain verifier)
    const secp256r1Order = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n
    const halfOrder = secp256r1Order / 2n
    if (s > halfOrder) {
        s = secp256r1Order - s
    }

    return { r, s }
}
