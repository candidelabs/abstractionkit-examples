"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireEnv = requireEnv;
exports.getOrCreateOwner = getOrCreateOwner;
exports.loadEnv = loadEnv;
exports.loadMultiChainEnv = loadMultiChainEnv;
const dotenv = __importStar(require("dotenv"));
const accounts_1 = require("viem/accounts");
dotenv.config();
// Public defaults for Arbitrum Sepolia — no signup required
const DEFAULTS = {
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
    PAYMASTER_URL1: 'https://api.candide.dev/public/v3/11155111',
    PAYMASTER_URL2: 'https://api.candide.dev/public/v3/11155420',
};
function get(key) {
    return process.env[key] || DEFAULTS[key] || '';
}
/**
 * Get a required environment variable (with fallback to built-in defaults).
 */
function requireEnv(key) {
    const value = get(key);
    if (!value) {
        throw new Error(`Missing environment variable: ${key}. Add it to .env (see README.md for defaults).`);
    }
    return value;
}
/**
 * Get or auto-generate an owner keypair.
 * If PUBLIC_ADDRESS and PRIVATE_KEY are in .env, uses those.
 * If neither is set, generates a fresh keypair for quick testing.
 * Throws if only one of the two is set.
 */
function getOrCreateOwner() {
    const address = process.env.PUBLIC_ADDRESS;
    const rawKey = process.env.PRIVATE_KEY;
    const key = rawKey && !rawKey.startsWith('0x') ? `0x${rawKey}` : rawKey;
    if (address && key)
        return { publicAddress: address, privateKey: key };
    if (address || key) {
        throw new Error('PUBLIC_ADDRESS and PRIVATE_KEY must both be set or both omitted in .env.');
    }
    const privateKey = (0, accounts_1.generatePrivateKey)();
    const account = (0, accounts_1.privateKeyToAccount)(privateKey);
    console.log('No PUBLIC_ADDRESS/PRIVATE_KEY in .env — auto-generated a keypair for this run.');
    console.log('Owner:', account.address, '\n');
    return { publicAddress: account.address, privateKey };
}
/**
 * Standard environment config for single-chain examples.
 */
function loadEnv() {
    return {
        chainId: BigInt(requireEnv('CHAIN_ID')),
        bundlerUrl: requireEnv('BUNDLER_URL'),
        nodeUrl: requireEnv('NODE_URL'),
        paymasterUrl: requireEnv('PAYMASTER_URL'),
        sponsorshipPolicyId: get('SPONSORSHIP_POLICY_ID') || undefined,
    };
}
/**
 * Environment config for chain-abstraction (multi-chain) examples.
 */
function loadMultiChainEnv() {
    return {
        chainId1: BigInt(requireEnv('CHAIN_ID1')),
        chainId2: BigInt(requireEnv('CHAIN_ID2')),
        bundlerUrl1: requireEnv('BUNDLER_URL1'),
        bundlerUrl2: requireEnv('BUNDLER_URL2'),
        nodeUrl1: requireEnv('NODE_URL1'),
        nodeUrl2: requireEnv('NODE_URL2'),
        paymasterUrl1: requireEnv('PAYMASTER_URL1'),
        paymasterUrl2: requireEnv('PAYMASTER_URL2'),
        sponsorshipPolicyId1: get('SPONSORSHIP_POLICY_ID1') || undefined,
        sponsorshipPolicyId2: get('SPONSORSHIP_POLICY_ID2') || undefined,
    };
}
