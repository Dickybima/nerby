# Giving AI a way on-chain: introducing Nerby Protocol

[Cover image: nerby-article-cover.png]

AI assistants have become very good at explaining things. Ask one how a token works, what a transaction does or how to write a smart contract, and you get a clear answer.

But there is a catch. An AI model cannot see a blockchain. It does not know a wallet's balance, it cannot tell whether a transaction went through, and it has no idea what a contract holds right now. So it guesses, and in crypto a confident guess can cost real money.

Nerby Protocol fixes that.

## 1. The idea: one endpoint between AI and every chain

[Image: nerby-article-1.png]

Nerby Protocol is a gateway that connects AI apps to blockchains. It speaks MCP, the open standard that Claude, ChatGPT, Cursor, VS Code and other AI apps use to call tools.

You add one URL to your AI app:

https://www.nerbyprotocol.xyz/mcp

From that moment your assistant can ask the chain directly, in plain words, and get answers that come from the network itself instead of from memory.

No account. No API key. Nothing to install. Setup guides for each app are here: https://www.nerbyprotocol.xyz/clients.html

## 2. What it does: read, check, deploy

[Image: nerby-article-2.png]

Nerby Protocol gives your AI 16 tools across 11 networks, with Robinhood Chain first in line, followed by Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea, Scroll and Gnosis.

**Read the chain.** Balances and tokens of any wallet, blocks, transactions, event logs, storage, any read-only contract function, and verified contract source code.

**Check before you sign.** Your AI can dry-run a transaction against the chain as it is right now. Will it succeed? If not, why not? What will it cost? You see the answer before anything happens.

**Deploy from a prompt.** Describe a token or paste your own Solidity. Nerby Protocol compiles it, estimates the fee, and gives you a link to the deploy page, where you review the exact source and sign with your own wallet.

**Know what a token can do.** A safety check looks for admin powers that could affect holders: minting more tokens, pausing transfers, blocking wallets, changing fees or replacing the code. It also checks whether ownership was renounced and whether the source is verified.

**Market data.** Price, liquidity, volume and price change for tokens with a DEX pool.

## 3. No AI app? Use the website

[Image: nerby-article-3.png]

Everything above also works straight from the website, with no wallet and no sign-up.

- **Explore** (https://www.nerbyprotocol.xyz/explore.html): paste any wallet, token, contract or transaction and get a full read-out, including the safety check.
- **Status** (https://www.nerbyprotocol.xyz/status.html): a live check of all 11 networks, showing the latest block and how fast each one answers.
- **Deploy** (https://www.nerbyprotocol.xyz/deploy.html): create a token or deploy your own contract, signed in your own wallet.

## 4. Safety: see it first, sign it yourself

[Image: nerby-article-4.png]

Nerby Protocol is built around one rule: it never touches your keys.

- There is no private key on our server, and no code that signs anything.
- None of the tools sends a transaction for you. When you want to act, you get a preview and an unsigned transaction to review.
- Signing happens in your own wallet, on your own device.
- There is no account and no API key, and nothing is stored about you.

We are also open about the limits. The service has not been audited, AI models can still misread numbers, and a simulation is a snapshot of the chain at one moment, not a promise. Check amounts and addresses in your wallet before you confirm. The full list is here: https://www.nerbyprotocol.xyz/security.html

## 5. $NERBY: bought back, burned for good

[Image: nerby-article-5.png]

$NERBY is the token of Nerby Protocol on Robinhood Chain.

Official contract address:
0xd17d0eabf76f2b3144da726efd341761f4697113

Other tokens named NERBY exist on other chains. If an address does not match this one, it is not $NERBY.

$NERBY has its own page: https://www.nerbyprotocol.xyz/token.html

Everything on it is live. Nothing is typed in by hand.

- **Market.** Price, 1h/6h/24h change, market cap, FDV, liquidity, 24h volume and a price chart from the $NERBY / WETH pool.
- **Buyback and burn.** The buyback wallet buys $NERBY from the pool and sends it to the burn address, where no one can ever move it again. The page lists every buyback and every burn with its transaction, plus the total bought back, the ETH spent and the total burned.
- **Supply and holders.** How the one billion tokens are split between the burn address, the liquidity pool and holders, plus the top holders with the pool and burn address labelled.
- **Safety.** The same automatic contract check that works for any token in Explore.

To be clear about what $NERBY is today: it does not unlock any feature of Nerby Protocol yet, and the product is free for everyone. Nothing here is financial advice.

## 6. What is next

[Image: nerby-article-6.png]

These are planned, not shipped:

- **Agent wallets with spend caps**, so autonomous agents can act within hard limits: allow-listed contracts, a maximum spend and an expiry.
- **Source verification after deploy**, so contracts deployed through Nerby Protocol show as verified on explorers.
- **More contract templates** alongside the token template.

We post when things ship, not before. The build page always shows what is live and what is still planned: https://www.nerbyprotocol.xyz/build.html

## Try it

- Website: https://www.nerbyprotocol.xyz
- Connect your AI: https://www.nerbyprotocol.xyz/mcp
- $NERBY: https://www.nerbyprotocol.xyz/token.html
- Follow: @nerbyprotocol

Don't trust, verify. Every number on our site links back to the chain.
