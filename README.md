# Mito

**[mito.trade](https://mito.trade)** — Advanced trading dashboard for [Polymarket](https://polymarket.com) prediction markets.

## Overview

Mito is a real-time trading interface that provides professional-grade tools for analyzing and trading on Polymarket event contracts. It connects directly to the Polymarket CLOB (Central Limit Order Book) for order placement and market data.

## Features

- **Market Grid** — Multi-asset view with live bid/ask prices, Black-Scholes probability estimates, and VWAP indicators
- **Up/Down Markets** — Dedicated panel for binary up-or-down price prediction markets with timeframe progress and cheap-market highlighting
- **Live Orderbook** — Real-time WebSocket orderbook depth from Polymarket
- **Order Management** — Place, cancel, and replace orders with quick price adjustment buttons
- **Position Tracking** — Live portfolio value, P&L tracking, and position management
- **Signals & Arbitrage** — Automated signal detection and cross-market arbitrage opportunities
- **Black-Scholes Pricing** — Probability estimates using B-S model with configurable VWAP lookback and time offset (Time Machine)
- **Draggable Panels** — Customizable dashboard layout with resizable, repositionable panels

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** for build tooling
- **TailwindCSS** for styling
- **Zustand** for state management
- **wagmi** + **WalletConnect** for wallet integration
- **WebSocket** feeds for real-time Binance and Polymarket data
