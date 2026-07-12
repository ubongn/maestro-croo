/**
 * Vercel Serverless Function — /api/target-agents
 *
 * Returns the sub-agent registry. These are the real CROO store agents
 * Maestro is configured to hire.
 */

const TARGET_AGENTS = [
  {
    id: 'alphatrack',
    name: 'AlphaTrack',
    role: 'smart-money',
    agentId: 'e05abaea-a586-4954-bbcf-d5c93127a214',
    description: 'Smart-money flow tracking across DEXes — surfaces where informed capital is rotating.',
    glyph: '🐋',
  },
  {
    id: 'polymarket',
    name: 'Polymarket Smart Wallet Tracker',
    role: 'prediction-markets',
    agentId: 'b6c8cc34-0d3e-46dc-9b9d-816a3659dcad',
    description: 'Tracks profitable prediction-market wallets to gauge directional sentiment & conviction.',
    glyph: '🔮',
  },
  {
    id: 'hyperliquid',
    name: 'Hyperliquid Vault Strategy Intelligence',
    role: 'vault-performance',
    agentId: '25fa5511-272a-47b5-94cc-738da6752557',
    description: 'Risk-adjusted performance analytics on Hyperliquid vaults for capital deployment.',
    glyph: '🏦',
  },
  {
    id: 'swapgod',
    name: 'SwapGod',
    role: 'execution',
    agentId: '70b70042-7cdd-4e6b-bebf-7abd25a22d83',
    description: 'Optimal ERC-20 swap execution on Base — best routing & MEV protection for entries.',
    glyph: '⚡',
  },
];

export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
  res.status(200).json({
    configured: TARGET_AGENTS.map((a) => ({ ...a, configured: true })),
    unconfigured: [],
  });
}
