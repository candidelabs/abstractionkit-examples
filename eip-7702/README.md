# EIP-7702 Examples

These examples demonstrate how to upgrade an EOA to a Smart Account with EIP-7702 and ERC-4337 User Operations.

## Folder Structure

```text
eip-7702/
├── simple-account/       # Simple7702Account examples
│   ├── 01-upgrade-eoa.ts                 # Upgrade EOA + batch mint NFTs (sponsored gas)
│   ├── 02-upgrade-eoa-external-signer.ts # Upgrade EOA with external signer (viem Account)
│   ├── 03-upgrade-eoa-erc20-gas.ts       # Upgrade EOA with ERC-20 token gas payment
│   ├── 04-upgrade-eoa-ep-v09.ts          # Upgrade EOA using EntryPoint v0.9
│   └── 05-revoke-delegation.ts           # Revoke EIP-7702 delegation
└── calibur-account/      # Calibur7702Account examples (passkeys, key management)
    ├── 01-upgrade-eoa.ts
    ├── 02-passkeys.ts
    └── 03-manage-keys.ts
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

With an external signer (callback pattern):

```ts
userOperation.eip7702Auth = await createAndSignEip7702DelegationAuthorization(
    BigInt(userOperation.eip7702Auth.chainId),
    userOperation.eip7702Auth.address,
    BigInt(userOperation.eip7702Auth.nonce),
    async (hash: string) => {
        // Raw hash signing — any signer (hardware wallet, WalletConnect, etc.)
        // Important: use account.sign(), NOT signMessage() (which adds EIP-191 prefix)
        return await account.sign({ hash: hash as `0x${string}` });
    }
)
```

See `simple-account/02-upgrade-eoa-external-signer.ts` for the full example.

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
const [sponsorUserOp, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation( userOperation, bundlerUrl)

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
