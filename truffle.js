const HDWalletProvider = require('@truffle/hdwallet-provider');
 
module.exports = {
  mocha: {
    enableTimeouts: false,
    before_timeout: 480000
  },

  compilers: {
    solc: {
      version: "0.7.5",
      settings: {
        optimizer: {
        enabled: true,
        runs: 750
        }
      }
    }
  },
 
  networks: {
    ganache: {
      host: "localhost",
      port: 18888,
      network_id: 366,
    },
    
    theta_privatenet: {
      provider: () => {
        var privateKeyTest01 = '1111111111111111111111111111111111111111111111111111111111111111'; 
        var privateKeyTest02 = '2222222222222222222222222222222222222222222222222222222222222222';
        var privateKeyTest03 = '3333333333333333333333333333333333333333333333333333333333333333';
        var privateKeyTest04 = '4444444444444444444444444444444444444444444444444444444444444444';
        var privateKeyTest05 = '5555555555555555555555555555555555555555555555555555555555555555';
        var privateKeyTest06 = '6666666666666666666666666666666666666666666666666666666666666666';
        var privateKeyTest07 = '7777777777777777777777777777777777777777777777777777777777777777';
        var privateKeyTest08 = '8888888888888888888888888888888888888888888888888888888888888888';
        var privateKeyTest09 = '9999999999999999999999999999999999999999999999999999999999999999';
        var privateKeyTest10 = '1000000000000000000000000000000000000000000000000000000000000000';
 
        return new HDWalletProvider({
          privateKeys: [privateKeyTest01, privateKeyTest02, privateKeyTest03, privateKeyTest04, privateKeyTest05, privateKeyTest06, privateKeyTest07, privateKeyTest08, privateKeyTest09, privateKeyTest10],
          providerOrUrl: 'http://localhost:18888/rpc',
        });
      },
      network_id: 366,
      gasPrice: 4000000000000,
    },
 
    theta_testnet: {
      provider: () => {
 
        // Replace the private key below with the private key of the deployer wallet. 
        // Make sure the deployer wallet has a sufficient amount of TFuel, e.g. 100 TFuel
        var deployerPrivateKey = '12345';
 
        return new HDWalletProvider({
          privateKeys: [deployerPrivateKey],
          providerOrUrl: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
        });
      },
      network_id: 365,
      gasPrice: 4000000000000,
    },

    theta_mainnet: {
      provider: () => {
 
        // Replace the private key below with the private key of the deployer wallet. 
        // Make sure the deployer wallet has a sufficient amount of TFuel, e.g. 100 TFuel
        var deployerPrivateKey = '12345';
 
        return new HDWalletProvider({
          privateKeys: [deployerPrivateKey],
          providerOrUrl: 'https://eth-rpc-api.thetatoken.org/rpc',
        });
      },
      network_id: 361,
      gasPrice: 4000000000000,
    }
  }
};