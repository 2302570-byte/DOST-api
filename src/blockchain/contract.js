const { ethers } = require('ethers');
const abi = require('./PointsLedgerAbi.json');

const { RPC_URL, BACKEND_PRIVATE_KEY, POINTS_CONTRACT_ADDRESS } = process.env;

if (!RPC_URL || !BACKEND_PRIVATE_KEY || !POINTS_CONTRACT_ADDRESS) {
  console.warn(
    '[blockchain] Missing RPC_URL, BACKEND_PRIVATE_KEY, or POINTS_CONTRACT_ADDRESS ' +
    'in .env — blockchain calls will fail until these are set.'
  );
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);
const contract = new ethers.Contract(POINTS_CONTRACT_ADDRESS, abi, signer);

// Hedera's Hashio relay can under-estimate gas via eth_estimateGas.
// An explicit gasLimit avoids intermittent out-of-gas failures.
const GAS_LIMIT = 300_000;
const isHedera  = () => (RPC_URL || '').includes('hashio');

/** Hash an internal userId string into the bytes32 key the contract uses. */
function userIdToBytes32(userId) {
  return ethers.id(String(userId)); // keccak256(utf8Bytes(userId))
}

/**
 * Award ECO to a resident on-chain.
 * @param {string} userId     - UUID from the users table
 * @param {number} ecoAmount  - whole number of ECO tokens
 * @param {string} reason     - e.g. "Recyclables 2.5 kg"
 * @param {string} refId      - waste_submission UUID for cross-referencing
 */
async function awardEco(userId, ecoAmount, reason, refId) {
  const key       = userIdToBytes32(userId);
  const overrides = isHedera() ? { gasLimit: GAS_LIMIT } : {};
  const tx        = await contract.award(key, ecoAmount, reason, refId, overrides);
  const receipt   = await tx.wait();
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
}

/**
 * Redeem (burn) ECO when a resident claims a reward.
 * @param {string} userId    - UUID from the users table
 * @param {number} ecoAmount - ECO to burn
 * @param {string} rewardId  - eco_redemption UUID for cross-referencing
 */
async function redeemEco(userId, ecoAmount, rewardId) {
  const key       = userIdToBytes32(userId);
  const overrides = isHedera() ? { gasLimit: GAS_LIMIT } : {};
  const tx        = await contract.redeem(key, ecoAmount, rewardId, overrides);
  const receipt   = await tx.wait();
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
}

/**
 * Read the authoritative on-chain ECO balance for a user.
 * Prefer the cached user_eco_balances table for fast reads;
 * use this only for the /verify endpoint.
 */
async function getOnChainBalance(userId) {
  const key     = userIdToBytes32(userId);
  const balance = await contract.balanceOf(key);
  return Number(balance);
}

module.exports = { awardEco, redeemEco, getOnChainBalance, userIdToBytes32, provider, signer, contract };
