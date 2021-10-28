# ThetaDrop NFT Marketplace Trading Engine

## Introduction

This repository contains the smart contract implementation of the ThetaDrop Marketplace NFT trading engine based on [Wyvern v3.1](https://github.com/wyvernprotocol/wyvern-v3), a marketplace engine also used by [OpenSea](https://opensea.io/). This [test case](https://github.com/thetatoken/tdrop-marketplace/blob/0aca94c6fe353c59c86088617edcd4005592eb00/test/10-theta-drop-marketplace-nft-purchases.js#L60) illustrates the flow of purchasing an NFT with TNT-20 tokens (e.g. stable coins). For purchasing an NFT with TFuel, please checkout this [test case](https://github.com/thetatoken/tdrop-marketplace/blob/0aca94c6fe353c59c86088617edcd4005592eb00/test/10-theta-drop-marketplace-nft-purchases.js#L142).

### NFT Liquidity Mining

One of the important features introduced by this trading engine is NFT Liquidity Mining, which is an incentivization mechanism to encourage NFT trading among users. New TDROP tokens will be mined each time a user makes a purchase using TFUEL on ThetaDrop NFT Marketplace or through a 3rd-party NFT DApp built on the NFT marketplace smart contract. It can be thought of as "mining" TDROP by providing liquidity to the Theta NFT Marketplace. It incentivizes early adopters of ThetaDrop to provide liquidity which enhances price discovery, improves trading volumes, and drives more user growth and adoption. ThetaDrop users who hold a balance of TDROP will earn VIP benefits including early or exclusive access to NFTs, limited edition packs, unique offline perks and more.

The NFT liquidity mining mechanism has been carefully designed. The main goals are to improve the marketplace liquidity and disincentivize wash trading. Our approach is
described in detail in Section "6. NFT Liquidity Mining Mechanism" of the [TDROP Whitepaper](https://s3.us-east-2.amazonaws.com/assets.thetatoken.org/Theta-Ecosystem-2022-and-TDROP-Whitepaper.pdf). At a high-level, the incentive structure motivates typical users to make purchases, which improves the liquidity of the NFT marketplace. Meanwhile, the design guarantees that over time the
cost of wash trading exceeds the mining reward, regardless of the ratio of TFUEL and TDROP and disincentivizes frequent transactions of the same NFT by implementing a "reward cool-down" mechanism.

[This function](https://github.com/thetatoken/tdrop-marketplace/blob/0aca94c6fe353c59c86088617edcd4005592eb00/contracts/ThetaDropMarketplace.sol#L394) `_performNFTLiquidityMining()` implements the NFT Liquidity mining. The contract also defines [a struct](https://github.com/thetatoken/tdrop-marketplace/blob/0aca94c6fe353c59c86088617edcd4005592eb00/contracts/ThetaDropMarketplace.sol#L106) `LiquidityMiningParameters`, which contains parameters that could affect the TDROP earning rate of liquidity mining. Theta Labs will set initial values for these paramaters. Later these paramters can be changed through [on-chain governance](https://github.com/thetatoken/tdrop-governance#governance). We have added [several test cases](https://github.com/thetatoken/tdrop-marketplace/blob/master/test/12-theta-drop-nft-liquidity-mining.js) which verify that TDROP NFT Liquidity mining behaves as expected.

## Development

### Setup

First install dependencies with the following command:

```bash
yarn
```

### Testing

#### Test against ganache

To test against ganache, first install ganache following the steps [here](https://www.trufflesuite.com/ganache). Then, start `ganache-cli` in a terminal with the following commond:

```bash
ganache-cli --defaultBalanceEther 1000000000 --networkId 366 --port 18888
```

Next, run the tests with

```bash
# run all tests
MODE=trace truffle test --network=ganache

# run an individual test
MODE=trace truffle test test/10-theta-drop-marketplace-nft-purchases.js --network=ganache --show-events
```

#### Test against the Theta local privatenet

We need to run the unit tests against the Theta local privatenet to make sure the smart contracts behave as expected on the Theta EVM. 

First, stop the `ganache` process. Then, setup the Theta local privatenet with the Theta/Ethereum RPC Adaptor [following this guide](https://docs.thetatoken.org/docs/setup-local-theta-ethereum-rpc-adaptor). The ETH RPC adaptor running at `http://localhost:18888/rpc` interacts with the ethers.js library by translating the Theta RPC interface into the ETH RPC interface.

Next, in a separate terminal, run the testuite:

```bash
# run all tests
MODE=trace truffle test --network=theta_privatenet

# run an individual test
MODE=trace truffle test test/10-theta-drop-marketplace-nft-purchases.js --network=theta_privatenet
```

Note: Test case `12-theta-drop-nft-liquidity-mining.js` is expect to fail when tested against `theta_privatent` since it calls `evm_mine`. Should only test it against `ganache`.

### Linting

Lint all Solidity files with:

```bash
yarn lint
```

### Static Analysis

Run static analysis tooling with:

```bash
yarn analyze
```

## Deployment

Run the following command to deploy the contracts

```bash
truffle deploy --network=[network]
```
