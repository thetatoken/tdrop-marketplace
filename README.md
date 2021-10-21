# TDROP Marketplace based on Wyvern v3.1

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
ganache-cli --networkId 366 --port 18888
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
