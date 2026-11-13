# EIP-7702 gasless revocation (early access)

> **Early access.** The gasless revocation API isn't publicly released yet and may change before it is.

Revokes an EOA's EIP-7702 delegation without the EOA holding gas. The EOA signs an
authorization to the zero address, and the relayer sends it in a type-4 transaction that it
pays for.

For the self-paid version, see [`eip-7702/simple-account/04-revoke-delegation.ts`](../../eip-7702/simple-account/04-revoke-delegation.ts).

## Run

Add to `.env`:

```env
RELAYER_URL=<relayer endpoint>
RELAYER_API_KEY=<your relayer API key>
# optional: defaults to Arbitrum Sepolia; the chain must be one the relayer supports
CHAIN_ID=421614
NODE_URL=https://sepolia-rollup.arbitrum.io/rpc
```

Then:

1. Delegate an EOA:
   ```bash
   npx ts-node eip-7702/simple-account/01-upgrade-eoa.ts   # or eip-7702/calibur-account/01-upgrade-eoa.ts
   ```
2. If `.env` has no `PUBLIC_ADDRESS`/`PRIVATE_KEY`, the upgrade generates a test account and
   prints both values. Add them to `.env`, so the revocation uses the same EOA.
3. Revoke the delegation:
   ```bash
   npx ts-node early-access/eip7702-gasless-revocation/gasless-revocation.ts
   ```

Use test keys only: never put a key that holds real funds in `.env`.

The example stops without sending anything if the EOA isn't delegated. The EOA doesn't need
any funds: the upgrade is sponsored and the relayer pays for the revocation.

## Relayer API

JSON-RPC 2.0 on `POST /`, with `Authorization: Bearer <key>`. All numbers are hex quantities.

| Method | Params | Returns |
|---|---|---|
| `relayer_supportedChains` | `[]` | `["0x1", "0xa", …]` |
| `relayer_revokeDelegation` | `[{ chainId, nonce, yParity, r, s, address? }]` | `{ delegationHash, chainId, status, reason }` |
| `relayer_getStatus` | `[delegationHash]` | status, `txHash`, `blockNumber`, gas cost (`gasUsed`, `effectiveGasPrice`, `l1Fee`, `totalCost`), `error` |
| `relayer_getAuthorizationHash` | `[chainId, address, nonce]` | the EIP-7702 hash to sign |

- One request carries one revocation for one chain. Sign one per chain, and never with `chainId: 0`.
- `address`, if sent, must be the zero address.
- Status moves `queued → submitted → confirmed | failed`. A revocation that can't apply right now is
  `skipped` with reason `NONCE_MISMATCH` or `AUTHORITY_IS_CONTRACT`.
- Sending the same revocation again returns the same `delegationHash`.
