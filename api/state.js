const TARGET_AGENTS = [
  { id: 'alphatrack', name: 'AlphaTrack', role: 'smart-money', agentId: 'e05abaea-a586-4954-bbcf-d5c93127a214', description: 'Smart-money flow tracking across DEXes — surfaces where informed capital is rotating.', glyph: '\uD83D\uDC33' },
  { id: 'polymarket', name: 'Polymarket Smart Wallet Tracker', role: 'prediction-markets', agentId: 'b6c8cc34-0d3e-46dc-9b9d-816a3659dcad', description: 'Tracks profitable prediction-market wallets to gauge directional sentiment & conviction.', glyph: '\uD83D\uDD2E' },
  { id: 'hyperliquid', name: 'Hyperliquid Vault Strategy Intelligence', role: 'vault-performance', agentId: '25fa5511-272a-47b5-94cc-738da6752557', description: 'Risk-adjusted performance analytics on Hyperliquid vaults for capital deployment.', glyph: '\uD83C\uDFE6' },
  { id: 'swapgod', name: 'SwapGod', role: 'execution', agentId: '70b70042-7cdd-4e6b-bebf-7abd25a22d83', description: 'Optimal ERC-20 swap execution on Base — best routing & MEV protection for entries.', glyph: '\u26A1' },
];

export default function handler(req, res) {
  const now = Date.now();
  const startedAt = now - 1000 * 60 * 60 * 24;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate');

  res.status(200).json({
    agent: {
      name: 'Maestro',
      tagline: 'DeFi Strategy Orchestrator — hires other CROO agents to build your allocation',
      configured: true,
      serviceId: '65f22ec7-8236-4ab4-9085-ff9e1efbf44b',
    },
    wallet: {
      address: '0xMaestro…cROO',
      ethWei: '120000000000000',
      usdc: 42.50,
      fetchedAt: now,
    },
    incoming: [],
    subOrders: [],
    strategies: [],
    feed: [
      { id: 'demo-connect', ts: startedAt, type: 'connect', role: 'system', label: 'Connected to CROO Network', detail: 'Listening for orders as provider + consumer on Base L2', kind: 'success' },
    ],
    stats: { totalOrders: 0, completedOrders: 0, agentsHired: 0, successRate: 0, avgSynthesisMs: 0 },
    uptime: now - startedAt,
    startedAt,
    _demo: true,
    _note: 'Static demo snapshot. Self-host with CROO_SDK_KEY for live agent-to-agent orchestration.',
  });
}
