# EIP-7702 Examples

These examples demonstrate how to upgrade an EOA to a Smart Account with EIP-7702 and ERC-4337 User Operations.

## Folder Structure

```text
eip-7702/
├── simple-account/       # Simple7702Account examples
│   ├── 01-upgrade-eoa.ts            # Upgrade EOA + batch mint NFTs (sponsored gas)
│   ├── 03-upgrade-eoa-erc20-gas.ts  # Upgrade EOA with ERC-20 token gas payment
│   ├── 04-upgrade-eoa-ep-v09.ts     # Upgrade EOA using EntryPoint v0.9
│   ├── 05-revoke-delegation.ts      # Revoke EIP-7702 delegation
│   ├── 06-external-signer.ts        # Upgrade EOA with the v0.3.2 ExternalSigner API
│   └── 07-external-signer-v09.ts    # Same, EntryPoint v0.9 (two-phase paymaster)
└── calibur-account/      # Calibur7702Account examples (passkeys, key management)
    ├── 01-upgrade-eoa.ts
    ├── 02-passkeys.ts
    ├── 03-manage-keys.ts
    └── 04-external-signer.ts        # Calibur with the v0.3.2 ExternalSigner API
```

## Simple7702Account

[Simple7702Account](https://docs.candide.dev/wallet/abstractionkit/simple-7702-account/) is a fully audited minimalist smart contract account that can be safely authorized by any EOA. It adds full support for major smart account features like batching and gas sponsorship.

### Initialization

```ts
import { Simple7702Account } from "abstractionkit";

const eoaDelegatorPublicAddress = "0xBdbc5FBC9cA8C3F514D073eC3de840Ac84FC6D31";

const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress);
```

### UserOperation Creation

```ts
let userOperation = await smartAccount.createUserOperation(
    [metaTransaction],
    nodeUrl,
    bundlerUrl,
    {
        eip7702Auth: { chainId }
    }
);
```

### Signing the Delegation Authorization

With a private key:

```ts
userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
    BigInt(userOperation.eip7702Auth.chainId),
    userOperation.eip7702Auth.address,
    BigInt(userOperation.eip7702Auth.nonce),
    eoaDelegatorPrivateKey
)
```

### UserOperation Signing with an External Signer

Starting in abstractionkit v0.3.2, `signUserOperationWithSigner` accepts any
`ExternalSigner` so you don't have to pass a raw private key into the SDK.
Simple7702 and Calibur validate via raw hash signing, so the signer must
implement `signHash`. Use one of the hash-capable adapters (`fromViem`,
`fromEthersWallet`, `fromPrivateKey`) or supply an inline object with
`signHash`. `fromViemWalletClient` exposes only `signTypedData` and is
rejected offline on this path.

```ts
import { fromViem } from "abstractionkit"
import { privateKeyToAccount } from "viem/accounts"

const signer = fromViem(privateKeyToAccount(privateKey))
userOp.signature = await smartAccount.signUserOperationWithSigner(
  userOp, signer, chainId,
)
```

See `simple-account/06-external-signer.ts` for the end-to-end Simple7702 flow,
`simple-account/07-external-signer-v09.ts` for the EntryPoint v0.9 variant, and
`calibur-account/04-external-signer.ts` for Calibur. The `signer/` folder at the
repo root contains one self-contained example per adapter.

Note: the **delegation authorization** (`createAndSignEip7702DelegationAuthorization`)
still takes the raw private key. It is a separate signature from the UserOperation
signature and is required by the EIP-7702 transaction type itself.

### Revoking Delegation

To revoke the EIP-7702 delegation (return the EOA to a regular account):

```ts
const signedTransaction = await smartAccount.createRevokeDelegationTransaction(
    eoaDelegatorPrivateKey,
    nodeUrl,
);
```

This creates a signed transaction that delegates to address zero, effectively removing the smart account code from the EOA. See `simple-account/05-revoke-delegation.ts` for the full example.

## Gas Sponsorship with Paymaster

Reference for [Candide's Paymaster](https://docs.candide.dev/wallet/abstractionkit/paymaster/).

```ts
import { CandidePaymaster } from "abstractionkit";

const paymaster = new CandidePaymaster(paymasterUrl);
```

### Sponsorship using Policies

```ts
const [sponsorUserOp, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(smartAccount, userOperation, bundlerUrl)

userOperation = sponsorUserOp
```

### Gas Payments in ERC-20

```ts
userOperation = await paymaster.createTokenPaymasterUserOperation(
    smartAccount,
    userOperation,
    tokenAddress,
    bundlerUrl,
)
```
