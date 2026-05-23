# VectoArena Server

VectoArena Server is the multiplayer and application backend for VectoArena. It exposes HTTP APIs for accounts, progression, cosmetics, wallet linking, deposits, and NFT ownership, while Colyseus rooms provide real-time authoritative match state for the Unity client.

## Features

- Account registration and login using bcrypt password hashing and JWT authentication.
- Authoritative multiplayer rooms for standard battle and Play to Airdrop modes.
- Server-side combat checks, item pickup validation, zone behavior, bot fill, reconnect handling, and match result recording.
- Player progression, cosmetic ownership, loadouts, balances, and currency transaction history.
- Wallet linking using a short-lived nonce and signed message verification.
- ERC-20 deposit verification and NFT skin ownership or purchase confirmation through blockchain RPC providers.
- PostgreSQL persistence through Prisma.

## Technology Stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js and TypeScript |
| HTTP API | Express 5 |
| Real-time networking | Colyseus 0.17 and WebSocket transport |
| Database | PostgreSQL |
| ORM and migrations | Prisma 7 |
| Authentication | JSON Web Tokens and bcrypt |
| Blockchain integration | ethers 6 |

## Prerequisites

- Node.js with npm.
- A PostgreSQL database accessible through a connection string.
- Blockchain RPC and contract details when enabling deposit or NFT functionality.

## Installation

1. Clone or download the repository and enter the server directory.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a local `.env` file and configure the environment variables described below.
4. Create or update the database schema and seed initial NFT mapping data:

   ```bash
   npm run db:setup
   ```

The `.env` file is ignored by Git and must not be committed.

## Environment Variables

Create `.env` at the project root. The following example documents the expected keys without real secrets:

```dotenv
PORT=2567
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/vectoarena
JWT_SECRET=replace-with-a-long-random-secret

SEPOLIA_RPC_URL=https://your-sepolia-rpc-endpoint
NFT_RPC_URL_11155111=https://your-sepolia-rpc-endpoint
TOKEN_CONTRACT_ADDRESS=0xYourVecTokenContractAddress
TREASURY_WALLET_ADDRESS=0xYourTreasuryWalletAddress

NFT_OWNERSHIP_SERVICE=ethers
NFT_ERC721_CHECK_METHOD=ownerOf
NFT_SYNC_MAX_ITEMS=100
```

| Variable | Required For | Description |
| --- | --- | --- |
| `PORT` | Optional | HTTP and WebSocket port. Defaults to `2567`. |
| `DATABASE_URL` | Server operation | PostgreSQL connection string used by Prisma and the runtime client. |
| `JWT_SECRET` | Authentication | Secret used to sign and verify access tokens. Set an explicit secure value outside local experiments. |
| `SEPOLIA_RPC_URL` | Deposits and Sepolia NFT calls | RPC URL used for VEC deposits and as the Sepolia NFT fallback. |
| `NFT_RPC_URL_<CHAIN_ID>` | NFT operations | Per-chain NFT ownership and purchase verification RPC URL. |
| `RPC_URL_BASE_SEPOLIA` | Base Sepolia NFT calls | Fallback RPC URL for chain ID `84532`, when configured. |
| `TOKEN_CONTRACT_ADDRESS` | Deposits | ERC-20 VEC token contract whose transfer events are verified. |
| `TREASURY_WALLET_ADDRESS` | Deposits | Wallet that must receive verified deposit transfers. |
| `NFT_OWNERSHIP_SERVICE` | NFT operations | Use `mock` for the seeded mock workflow; otherwise the RPC-backed service is used. |
| `NFT_ERC721_CHECK_METHOD` | NFT operations | ERC-721 ownership lookup strategy: `ownerOf` or `balanceOf`. |
| `NFT_SYNC_MAX_ITEMS` | NFT operations | Optional positive limit for active NFT mappings checked in one sync request. |
| `NODE_ENV` | Testing or deployment | Setting `test` selects the mock NFT ownership service. |

## Running the Server

Run in development with TypeScript execution:

```bash
npm run dev
```

Build and run compiled JavaScript:

```bash
npm run build
npm start
```

By default, the service listens on port `2567`, serving REST and Colyseus WebSocket connections from the same HTTP server.

## Database Setup

The Prisma schema is located at `prisma/schema.prisma`, and migrations are stored under `prisma/migrations`.

| Command | Purpose |
| --- | --- |
| `npm run db:migrate` | Apply development migrations through Prisma using the configured database. |
| `npm run db:generate` | Generate the Prisma client. |
| `npm run db:seed` | Upsert the provided mock NFT skin mappings. |
| `npm run db:setup` | Run migrate, generate, and seed in sequence. |

The persistence model includes users, sessions, loadouts, matches, participants, kill events, currency transactions, skin inventory, wallet nonces, NFT mapping cache, and NFT purchase history.

## Gameplay Configuration

Match balance is loaded from `config/gameplay/default.json`. The current configuration defines:

- Four combatants per room, with bot fill available after the configured wait time.
- Initial item spawning and weighted weapon or medical kit selection.
- Weapon damage, fire rate, and ammunition values.
- Movement, hit-distance, pickup-distance, healing, bot behavior, and reconnect timing settings.

`ConfigService` caches validated gameplay configuration briefly and falls back to built-in defaults if the JSON file cannot be loaded.

## REST API

Protected endpoints require the header `Authorization: Bearer <token>` returned by `POST /auth/login`.

| Method | Endpoint | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | No | Create a player account and default skin inventory. |
| `POST` | `/auth/login` | No | Authenticate and return a JWT access token. |
| `GET` | `/player/profile` | Yes | Return balances, progression, loadout, and cosmetic ownership. |
| `GET` | `/player/transactions` | Yes | Return paginated currency history with optional filters. |
| `POST` | `/player/buy-skin` | Yes | Purchase and equip a non-NFT player skin. |
| `POST` | `/player/equip-skin` | Yes | Equip an owned player skin. |
| `GET` | `/wallet/nonce` | Yes | Issue a time-limited message nonce for signing. |
| `POST` | `/wallet/verify` | Yes | Verify the signature and link a wallet to the account. |
| `POST` | `/web3/deposit` | Yes | Verify an ERC-20 deposit and credit unlocked VEC. |
| `POST` | `/web3/link-wallet` | Yes | Deprecated route that directs clients to nonce verification. |
| `POST` | `/nft/sync` | Yes | Read configured NFT ownership and refresh the user cache. |
| `POST` | `/nft/purchase/confirm` | Yes | Validate a purchase transaction and update NFT ownership cache. |

## Multiplayer Rooms

| Room Name | Mode | Access |
| --- | --- | --- |
| `battle` | Standard battle | Guests are accepted by room authentication, although authenticated play is required for persisted player progression. |
| `airdrop` | Play to Airdrop | Requires an authenticated user at level 5 or higher. |

Rooms accept the following client messages after a match begins:

| Message | Purpose |
| --- | --- |
| `move` | Submit player position and rotation updates. |
| `shoot` | Submit a ranged attack event after server validation. |
| `hit` | Submit a target hit for distance and accepted-shot validation. |
| `switch_weapon` | Select the melee or ranged weapon slot. |
| `melee_attack` | Submit a melee strike for range, angle, and cooldown validation. |
| `pickup_progress` | Synchronize an in-progress pickup interaction. |
| `pickup_item` | Collect a weapon, medical kit, or VEC pickup. |

The room broadcasts synchronized state and gameplay messages including `GAME_START`, `GAME_OVER`, `shoot`, `melee_attack`, `item_picked`, `kill_feed`, and `match_result`.

## Project Structure

| Path | Description |
| --- | --- |
| `src/index.ts` | Express and Colyseus server bootstrap |
| `src/rooms/BattleRoom.ts` | Match lifecycle and authoritative gameplay logic |
| `src/routes` | Authentication, profile, wallet, Web3, and NFT HTTP routes |
| `src/managers` | Gameplay configuration, bots, progression, skins, and Web3 services |
| `src/schema` | Colyseus synchronized state models |
| `src/database/prisma.ts` | Database client initialization |
| `config/gameplay/default.json` | Runtime gameplay balance configuration |
| `prisma/schema.prisma` | Database model definitions |
| `prisma/migrations` | Database migrations |
| `prisma/seed.ts` | Seed procedure for NFT mapping data |
| `docs` | Additional backend design documentation |

## Scripts

| Script | Command | Description |
| --- | --- | --- |
| Development server | `npm run dev` | Start from TypeScript source with `ts-node`. |
| Production build | `npm run build` | Compile TypeScript into `dist`. |
| Production server | `npm start` | Run compiled output from `dist/index.js`. |
| Tests | `npm test` | Placeholder command; automated tests are not currently configured. |

## Security Notes

- Replace the development JWT fallback by setting a strong `JWT_SECRET` in every deployed environment.
- Store RPC URLs, contract configuration, database credentials, and secrets outside source control.
- Serve production clients over HTTPS and secure WebSockets behind an appropriate reverse proxy.
- Treat the backend as authoritative for rewards, balances, wallet verification, NFT confirmation, and combat outcomes.

## Development Guidelines

- Run `npm run build` after TypeScript changes.
- Apply database migrations and update seed behavior deliberately when the persistence contract changes.
- Keep changes to REST responses and Colyseus messages synchronized with the Unity client.
- Add automated tests when extending authentication, currency, on-chain verification, or match reward behavior.
