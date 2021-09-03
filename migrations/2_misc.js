/* global artifacts:false */

const WyvernAtomicizer = artifacts.require('./WyvernAtomicizer.sol')
const WyvernStatic = artifacts.require('./WyvernStatic.sol')
const StaticMarket = artifacts.require('./StaticMarket.sol')
const TestERC20 = artifacts.require('./TestERC20.sol')
const TestERC721 = artifacts.require('./TestERC721.sol')
const TestERC1271 = artifacts.require('./TestERC1271.sol')
const TestERC1155 = artifacts.require('./TestERC1155.sol')
const MockTDropToken = artifacts.require('./MockTDropToken.sol')
const TestAuthenticatedProxy = artifacts.require('./TestAuthenticatedProxy.sol')

const { setConfig } = require('./config.js')

module.exports = async (deployer, network) => {
  await deployer.deploy(WyvernAtomicizer)
  await deployer.deploy(WyvernStatic, WyvernAtomicizer.address)
  await deployer.deploy(StaticMarket)

  if (network !== 'development'){
    setConfig('deployed.' + network + '.WyvernAtomicizer', WyvernAtomicizer.address)
    setConfig('deployed.' + network + '.WyvernStatic', WyvernStatic.address)
    setConfig('deployed.' + network + '.StaticMarket', StaticMarket.address)
  }

  if (network !== 'coverage' && network !== 'development' && network !== 'theta_privatenet' & network !== 'ganache')
    return

  await deployer.deploy(TestERC20)
  await deployer.deploy(TestERC721)
  await deployer.deploy(TestAuthenticatedProxy)
  await deployer.deploy(TestERC1271)
  await deployer.deploy(TestERC1155)
  await deployer.deploy(MockTDropToken)

  if (network !== 'development') {
    setConfig('deployed.' + network + '.TestERC20', TestERC20.address)
    setConfig('deployed.' + network + '.TestERC721', TestERC721.address)
    setConfig('deployed.' + network + '.TestAuthenticatedProxy', TestAuthenticatedProxy.address)
    setConfig('deployed.' + network + '.TestERC1271', TestERC1271.address)
    setConfig('deployed.' + network + '.TestERC1155', TestERC1155.address)
    setConfig('deployed.' + network + '.MockTDropToken', MockTDropToken.address)
  }
}

