import * as dotenv from 'dotenv'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

dotenv.config()

// Public defaults for Arbitrum Sepolia — no signup required
const DEFAULTS: Record<string, string> = {
    CHAIN_ID: '421614',
    NODE_URL: 'https://sepolia-rollup.arbitrum.io/rpc',
    BUNDLER_URL: 'https://api.candide.dev/public/v3/421614',
    PAYMASTER_URL: 'https://api.candide.dev/public/v3/421614',
    // Chain abstraction defaults (Sepolia + OP Sepolia)
    CHAIN_ID1: '11155111',
    CHAIN_ID2: '11155420',
    BUNDLER_URL1: 'https://api.candide.dev/public/v3/11155111',
    BUNDLER_URL2: 'https://api.candide.dev/public/v3/11155420',
    NODE_URL1: 'https://ethereum-sepolia-rpc.publicnode.com',
    NODE_URL2: 'https://sepolia.optimism.io',
}

function get(key: string): string {
    return process.env[key] || DEFAULTS[key] || ''
}

/**
 * Get a required environment variable (with fallback to built-in defaults).
 */
export function requireEnv(key: string): string {
    const value = get(key)
    if (!value) {
        throw new Error(
            `Missing environment variable: ${key}. Add it to .env (see README.md for defaults).`
        )
    }
    return value
}

/**
 * Get or auto-generate an owner keypair.
 * If PUBLIC_ADDRESS and PRIVATE_KEY are in .env, uses those.
 * If neither is set, generates a fresh keypair for quick testing.
 * Throws if only one of the two is set.
 */
export function getOrCreateOwner(): { publicAddress: string; privateKey: string } {
    const address = process.env.PUBLIC_ADDRESS
    const key = process.env.PRIVATE_KEY

    if (address && key) return { publicAddress: address, privateKey: key }

    if (address || key) {
        throw new Error(
            'PUBLIC_ADDRESS and PRIVATE_KEY must both be set or both omitted in .env.'
        )
    }

    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)
    console.log('No PUBLIC_ADDRESS/PRIVATE_KEY in .env — auto-generated a keypair for this run.')
    console.log('Owner:', account.address, '\n')
    return { publicAddress: account.address, privateKey }
}

/**
 * Standard environment config for single-chain examples.
 */
export function loadEnv() {
    return {
        chainId: BigInt(requireEnv('CHAIN_ID')),
        bundlerUrl: requireEnv('BUNDLER_URL'),
        nodeUrl: requireEnv('NODE_URL'),
        paymasterUrl: requireEnv('PAYMASTER_URL'),
        sponsorshipPolicyId: get('SPONSORSHIP_POLICY_ID'),
    }
}

/**
 * Environment config for chain-abstraction (multi-chain) examples.
 */
export function loadMultiChainEnv() {
    return {
        chainId1: BigInt(requireEnv('CHAIN_ID1')),
        chainId2: BigInt(requireEnv('CHAIN_ID2')),
        bundlerUrl1: requireEnv('BUNDLER_URL1'),
        bundlerUrl2: requireEnv('BUNDLER_URL2'),
        nodeUrl1: requireEnv('NODE_URL1'),
        nodeUrl2: requireEnv('NODE_URL2'),
    }
}
