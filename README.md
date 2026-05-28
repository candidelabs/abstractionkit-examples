# AbstractionKit Examples

## Quickstart Guide

Get AbstractionKit examples running in minutes:

1.  **Clone the Repo:**

    ```bash
    git clone git@github.com/candidelabs/abstractionkit-examples.git
    ```

2.  **Install Dependencies:**

    ```bash
    cd abstractionkit-examples
    npm install
    ```

3.  **Configure Environment Variables:**

    ```bash
    cp .env.example .env
    ```

    * **Default Network:** Examples run on Arbitrum Sepolia. Change your `.env` if you prefer another network.
    * **Default Account:** Examples use the Safe Unified Account (`SafeMultiChainSigAccountV1`) on EntryPoint v0.9 — the same account works single-chain and across chains. See [chain-abstraction](./chain-abstraction/) for the multichain flow.
    * **Endpoints:** `BUNDLER_URL` and `PAYMASTER_URL` use public endpoints. Get your own dedicated endpoints from the [Candide Dashboard](https://dashboard.candide.dev/).
    * **Gas Sponsorship (Optional):** Set `SPONSORSHIP_POLICY_ID` after creating a gas policy on the Dashboard.
    * **ERC-20 Payments:** See [supported ERC-20 tokens](https://docs.candide.dev/wallet/paymaster/tokens-supported/) for gas payments.
    * **Private Key:** Use any valid Ethereum private key. Use random test key.

4.  **Run a Script:**

    To run any of the provided examples: 
    ```bash
    npx ts-node path/to/script.ts
    ```

## Resources

Candide documentation can be found at [docs.candide.dev](https://docs.candide.dev).