# 🎼 Maestro — CROO DeFi Strategy Orchestrator

**An autonomous AI agent on the [CROO Network](https://croo.network) that *hires other agents* to compose complete DeFi allocation strategies.**

**🔗 Live Dashboard: [maestro-croo.vercel.app](https://maestro-croo.vercel.app/)**

**🎬 Demo Video: [youtu.be/XUdNkZwgzzA](https://youtu.be/XUdNkZwgzzA)**

Maestro is the only agent in the CROO ecosystem that acts as a **meta-agent / orchestrator**: it receives a high-level strategy request from a user, then autonomously discovers, hires, pays, and synthesizes the output of multiple specialist agents on-chain — proving the core CROO thesis that **agents can discover, employ, and pay each other without human intermediation**.

> Built for the **CROO Agent Hackathon** ($10,200). Chain: **Base L2** (gas sponsored by CROO). Payments: **USDC** in on-chain escrow.

---

## The flow in one breath

```
User ──(strategy request)──► Maestro (provider) ──accept──► user pays USDC
                                                            │
                                ┌───────────────────────────┘
                                ▼  on payment, Maestro becomes a consumer:
                  ┌─────────────┴──────────────┬─────────────┐
                  ▼                            ▼             ▼
            AlphaTrack              Polymarket Tracker   Hyperliquid Vault
          (smart money)              (sentiment)          (performance)
            pays each ◄── delivers intelligence ──► collects all
                                  │
                                  ▼  LLM synthesis
                          structured DeFi strategy
                                  │
                                  ▼  deliver on-chain (schema)
                              back to user
```

1. **Provider mode** — a user negotiates an order against Maestro's service; Maestro auto-accepts. On payment, escrow locks.
2. **Consumer mode** — Maestro places **3+ sub-orders** with specialist agents (smart-money tracking, prediction-market sentiment, vault performance, execution…), auto-pays each, and collects every delivery.
3. **Synthesis** — an LLM (OpenAI-compatible API) fuses all the raw intelligence into one coherent, structured allocation plan.
4. **Delivery** — Maestro delivers the strategy as a `Schema` deliverable back to the original requester on-chain. Settlement releases.

---

## Why it's novel

Most agents on CROO *provide* one capability. **Maestro consumes the capabilities of others** and adds an orchestration + synthesis layer on top. It demonstrates the full agent-to-agent economic loop end-to-end on Base:

- **Autonomous discovery** of relevant specialists (request-aware agent selection).
- **Autonomous hiring & payment** of peer agents in USDC escrow.
- **Fault-tolerant aggregation** — partial sub-agent failures still yield a complete (if partial) strategy, and the SLA deadline is always respected.
- **LLM-grade synthesis** into a single deliverable the user can act on.

---

## Tech stack

| Layer | Choice |
|------|--------|
| Runtime | Node.js 18+ / TypeScript (strict) |
| Agent protocol | `@croo-network/sdk` v0.2.1 (WebSocket events, escrow payments) |
| HTTP / dashboard | Fastify 5 + vanilla TS/HTML/CSS |
| LLM | Any OpenAI-compatible `/chat/completions` API |
| Chain | Base L2 (gas sponsored), USDC payments |
| Tests | `node:test` + `tsx` (pure-logic units, no network) |

---

## Getting started

### 1. Prerequisites
- Node.js 18+ (built & tested on Node 22)
- A registered **CROO agent** + its **SDK Key** (`croo_sk_…`) from [agent.croo.network](https://agent.croo.network)
- A small amount of **USDC on Base** in your agent's AA wallet (for paying sub-agents)
- An **OpenAI-compatible API key** for synthesis

### 2. Install
```bash
npm install
```

### 3. Configure
```bash
cp .env.example .env
```
Then edit `.env`:
- `CROO_SDK_KEY` — your agent SDK key
- `MAESTRO_SERVICE_ID` — the serviceId of the strategy service you register for Maestro on the dashboard
- `ALPHATRACK_SERVICE_ID`, `POLYMARKET_TRACKER_SERVICE_ID`, `HYPERLIQUID_VAULT_SERVICE_ID`, `SWAPGOD_SERVICE_ID` — serviceIds of the target agents (find them on the store once you have your key)
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` — synthesis model

> 💡 **Degraded mode:** if `CROO_SDK_KEY` is absent, Maestro still boots and serves the dashboard so you can verify the build. Live order flow activates the moment credentials are present.

### 4. Run
```bash
npm run dev      # hot-reload dev (tsx watch)
# or
npm run build && npm start   # production
```

Open **http://localhost:3000** for the dashboard.

### 5. Test
```bash
npm test         # 25 unit tests (pure logic: parsing, selection, normalization, event bus)
npm run typecheck
```

---

## Dashboard

A clean **light-theme** dashboard (Stripe / Linear / Vercel aesthetic) shows, live:

- **Wallet** — Maestro's AA wallet address + live USDC balance on Base.
- **Stats** — incoming orders, strategies delivered, agents hired, hire success rate, avg synthesis time.
- **Incoming requests** — user orders Maestro is fulfilling (provider side), with live phase (`awaiting payment → orchestrating → delivered`).
- **Agents hired** — each sub-order with status, cost, and outcome (consumer side).
- **Strategy output** — the synthesized allocation table (assets, weights, rationale), risk meter, action items, warnings, and a raw-JSON toggle.
- **Live feed** — a real-time ticker of every orchestration event.
- **Sub-agent registry** — candidate agents and their configuration status.

No dark mode, by design.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `CROO_API_URL` | no | `https://api.croo.network` |
| `CROO_WS_URL` | no | `wss://api.croo.network/ws` |
| `CROO_SDK_KEY` | **yes** | `croo_sk_…` from the dashboard |
| `BASE_RPC_URL` | no | Base RPC for balance checks |
| `MAESTRO_SERVICE_ID` | yes (live) | Maestro's own published service |
| `MAESTRO_PRICE_USDC` | no | Price Maestro charges users (default 5) |
| `ALPHATRACK_SERVICE_ID` | yes (≥1 sub) | Target agent serviceId |
| `POLYMARKET_TRACKER_SERVICE_ID` | yes (≥1 sub) | Target agent serviceId |
| `HYPERLIQUID_VAULT_SERVICE_ID` | yes (≥1 sub) | Target agent serviceId |
| `SWAPGOD_SERVICE_ID` | optional | Target agent serviceId |
| `LLM_API_KEY` | yes (polished) | OpenAI-compatible key |
| `LLM_BASE_URL` | no | Defaults to OpenAI |
| `LLM_MODEL` | no | Defaults to `gpt-4o-mini` |
| `LLM_TIMEOUT_MS` | no | Default 60000 |
| `ORCHESTRATION_TIMEOUT_MS` | no | Hard cap per orchestration (default 120000) |
| `MIN_SUB_AGENTS` | no | Min agents hired per request (default 3) |
| `PORT` | no | Dashboard/API port (default 3000) |

---

## Target sub-agents

Maestro ships configured for these candidates on the CROO store:

| Agent | Role | Agent ID |
|---|---|---|
| AlphaTrack | smart-money tracking | `e05abaea-a586-4954-bbcf-d5c93127a214` |
| Polymarket Smart Wallet Tracker | prediction-market sentiment | `b6c8cc34-0d3e-46dc-9b9d-816a3659dcad` |
| Hyperliquid Vault Strategy Intelligence | vault performance | `25fa5511-272a-47b5-94cc-738da6752557` |
| SwapGod | ERC-20 swap execution on Base | — |

Each is selected per-request based on relevance (chain, risk appetite, stated preferences). Agent selection is pure & unit-tested — see `src/agents-registry.ts`.

---

## How the dual-role routing works (the hard part)

Maestro is **both** a provider and a consumer on a **single** WebSocket. That means `OrderPaid` fires both when *a user pays Maestro* and when *Maestro pays a sub-agent*. Maestro routes every event correctly using:

1. **A shared outbound set** — every negotiationId Maestro originates as a consumer is recorded; the provider ignores those.
2. **State tracking** — orders Maestro accepted as provider are tracked separately.
3. **A race-safe event bus** (`src/event-bus.ts`) — a short TTL buffer + `waitFor(predicate)` so an event arriving in the gap between `negotiateOrder()` returning and a listener registering is never lost.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for full diagrams.

---

## Project structure

```
maestro-croo/
├── src/
│   ├── index.ts              # Entry point — boots runtime + dashboard
│   ├── provider.ts           # CROO provider — accept negotiations, fire on payment
│   ├── consumer.ts           # CROO consumer — hire/pay/collect sub-agents
│   ├── orchestrator.ts       # Brain — coordinate hire → synthesize → deliver
│   ├── synthesizer.ts        # LLM strategy synthesis + normalization
│   ├── agents-registry.ts    # Target agents + request-aware selection
│   ├── event-bus.ts          # Race-safe event routing (buffer + waitFor)
│   ├── request.ts            # Parse user requirements → typed request
│   ├── wallet.ts             # On-chain USDC/ETH balance (ethers)
│   ├── state.ts              # In-memory dashboard state store
│   ├── server.ts             # Fastify dashboard + JSON API
│   ├── config.ts             # Env config + constants
│   └── types.ts              # Shared types
├── public/                   # Dashboard (index.html, app.js, style.css)
├── test/                     # Unit tests (pure logic)
├── ARCHITECTURE.md           # Mermaid diagrams + design notes
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```

---

## Deploy

```bash
docker compose up --build        # builds + runs on PORT
```

The `Dockerfile` is multi-stage: build with Node, run the slim `dist/` output.

---

## License

MIT © Ubong
