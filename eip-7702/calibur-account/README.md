# Calibur Smart Account Examples (EIP-7702)

## What is Calibur?

[Calibur](https://github.com/Uniswap/calibur) is a smart account implementation by Uniswap built for [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702). It turns any existing EOA into a full-featured smart account through delegation. Your address stays the same, but gains new capabilities:

- **Multi-key support** — Register multiple signing keys (EOA, passkey, raw P-256) with per-key settings
- **WebAuthn/Passkeys** — Native support for biometric authentication (Face ID, fingerprint, security keys)
- **Key expiration** — Set time-limited keys for session-based access
- **Per-key hooks** — Attach custom validation logic to individual keys
- **Transaction batching** — Execute multiple calls in a single UserOperation
- **Admin/non-admin separation** — Only admin keys can manage the account's key configuration; non-admin keys can only sign regular transactions

## EntryPoint Versions

`Calibur7702Account` runs on EntryPoint v0.8 and, since abstractionkit 1.0.0, delegates to Uniswap Calibur **v1.1.0** by default.

| Calibur | Singleton (`delegateeAddress`) | EntryPoint |
|---------|-----------|------------|
| v1.1.0 (default) | `0x000000005c84F8Fd50b21CAC312528A64437030e` | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` (v0.8) |
| v1.0.0 (legacy) | `0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00` | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` (v0.8) |

Since abstractionkit 1.0.0 the default delegatee is Calibur v1.1.0 (`CALIBUR_UNISWAP_V1_1_0_SINGLETON_ADDRESS`). It keeps the v1.0.0 storage layout, so registered keys survive re-delegation. The examples re-delegate an EOA still on v1.0.0 automatically; to keep using v1.0.0, pass `{ delegateeAddress: "0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00" }` to the constructor.

## Key Types

| Type | Enum | Description |
|------|------|-------------|
| `Secp256k1` | 2 | Standard Ethereum EOA keys |
| `WebAuthnP256` | 1 | Passkeys / biometric authentication |
| `P256` | 0 | Raw secp256r1 keys |

The root key (the EOA's own secp256k1 key) always has `keyHash = bytes32(0)` and is always admin. Keys registered via `createRegisterKeyMetaTransactions` are non-admin by default.

## Examples

| File | Description |
|------|-------------|
| `01-upgrade-eoa.ts` | Delegate an EOA to Calibur via EIP-7702, batch-mint 2 NFTs, sponsor gas with CandidePaymaster |
| `02-passkeys.ts` | Register a WebAuthn passkey, then sign and send a transaction with it |
| `03-manage-keys.ts` | List keys, register a secondary secp256k1 key, sign with it (keyHash override), update its expiration, revoke it |

All examples use `CandidePaymaster` for gas sponsorship with the default EntryPoint v0.8.

## Running

```bash
# From the repo root
npm install

# Set up .env (CHAIN_ID, NODE_URL, BUNDLER_URL, PAYMASTER_URL are required)
# PRIVATE_KEY is optional — a new keypair is generated if not set

# Run in order (01 must run first to delegate the EOA)
npx ts-node eip-7702/calibur-account/01-upgrade-eoa.ts
npx ts-node eip-7702/calibur-account/02-passkeys.ts
npx ts-node eip-7702/calibur-account/03-manage-keys.ts
```

## WebAuthn Note

The `webauthn-utils.ts` file provides a simulated WebAuthn authenticator for Node.js. In a real browser application, replace it with the native `navigator.credentials` API — the Calibur signing flow (key registration, `getUserOperationHash`, `formatWebAuthnSignature`) remains the same.
