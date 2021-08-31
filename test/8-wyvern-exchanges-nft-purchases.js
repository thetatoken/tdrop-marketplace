/* global artifacts:false, it:false, contract:false, assert:false */

const WyvernAtomicizer = artifacts.require('WyvernAtomicizer')
const WyvernExchange = artifacts.require('WyvernExchange')
const WyvernStatic = artifacts.require('WyvernStatic')
const WyvernRegistry = artifacts.require('WyvernRegistry')
const TestERC20 = artifacts.require('TestERC20')
const TestERC721 = artifacts.require('TestERC721')
const TestERC1271 = artifacts.require('TestERC1271')

const Web3 = require('web3')
const provider = new Web3.providers.HttpProvider('http://localhost:18888')
const web3 = new Web3(provider)

const { wrap,hashOrder,ZERO_BYTES32,randomUint,NULL_SIG,assertIsRejected} = require('./aux')

contract('WyvernExchange-NFT-Purchase', (accounts) => {
  const deploy = async contracts => Promise.all(contracts.map(contract => contract.deployed()))

  const withContracts = async () =>
    {
    let [exchange,statici,registry,atomicizer,erc20,erc721,erc1271] = await deploy(
      [WyvernExchange,WyvernStatic,WyvernRegistry,WyvernAtomicizer,TestERC20,TestERC721,TestERC1271])
    return {exchange:wrap(exchange),statici,registry,atomicizer,erc20,erc721,erc1271}
    }

  const withSomeTokens = async () => {
    let {erc20, erc721} = await withContracts()
    const amount = randomUint() + 2
    await erc20.mint(accounts[0],amount)
    return {tokens: amount, nfts: [1, 2, 3], erc20, erc721}
  }

  it('setup',async () => {
    let {registry,erc20,erc721} = await withContracts()

    await registry.registerProxy({from: accounts[0]})
    let proxy0 = await registry.proxies(accounts[0])
    assert.isOk(await erc20.approve(proxy0, 100000))
    assert.isOk(await erc721.setApprovalForAll(proxy0, true))

    await registry.registerProxy({from: accounts[6]})
    let proxy6 = await registry.proxies(accounts[6])
    assert.isOk(await erc20.approve(proxy6, 100000, {from: accounts[6]}))
    assert.isOk(await erc721.setApprovalForAll(proxy6, true, {from: accounts[6]}))
  })

  it('purchase ERC721 NFT with ERC20 tokens',async () => {
    let {atomicizer, exchange, registry, statici, erc20, erc721} = await withContracts()
    let {tokens, nfts} = await withSomeTokens()


    // Setup account initial balances
    let faucet    = accounts[0];
    let nftSeller = accounts[6];
    let nftBuyer  = accounts[0];

    await erc721.transferFrom(faucet, nftSeller, nfts[0], {from: faucet})
    assert.equal(await erc20.balanceOf(nftSeller), 0, 'Incorrect initial ERC20 balance')
    assert.equal(await erc721.ownerOf(nfts[0]), nftSeller, 'Incorrect initial ERC721 NFT owner')

    const abi = [{'constant': false, 'inputs': [{'name': 'addrs', 'type': 'address[]'}, {'name': 'values', 'type': 'uint256[]'}, {'name': 'calldataLengths', 'type': 'uint256[]'}, {'name': 'calldatas', 'type': 'bytes'}], 'name': 'atomicize', 'outputs': [], 'payable': false, 'stateMutability': 'nonpayable', 'type': 'function'}]
    const atomicizerc = new web3.eth.Contract(abi, atomicizer.address)
    const erc20c = new web3.eth.Contract(erc20.abi, erc20.address)
    const erc721c = new web3.eth.Contract(erc721.abi, erc721.address)
    
    // NFT Seller
    const selectorOne = web3.eth.abi.encodeFunctionSignature('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const extradataOne = '0x'
    const one = {registry: registry.address, maker: nftSeller, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: extradataOne, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3352'}
    const firstERC721Call = erc721c.methods.transferFrom(nftSeller, nftBuyer, nfts[0]).encodeABI()
    const firstData = atomicizerc.methods.atomicize(
      [erc721.address],
      [0],
      [(firstERC721Call.length - 2) / 2],
      firstERC721Call
    ).encodeABI()
    const firstCall = {target: atomicizer.address, howToCall: 1, data: firstData}
    let oneSig = await exchange.sign(one, nftSeller)

    // NFT Buyer (purchasing with ERC20 tokens)
    const selectorTwo = web3.eth.abi.encodeFunctionSignature('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
    const extradataTwo = '0x'
    const two = {registry: registry.address, maker: nftBuyer, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: extradataTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3335'}
    const secondERC20Call = erc20c.methods.transferFrom(nftBuyer, nftSeller, 2).encodeABI()
    const secondData = atomicizerc.methods.atomicize(
      [erc20.address],
      [0],
      [(secondERC20Call.length - 2) / 2],
      secondERC20Call
    ).encodeABI()
    const secondCall = {target: atomicizer.address, howToCall: 1, data: secondData}
    let twoSig = await exchange.sign(two, nftBuyer)
    
    // Order matching
    await exchange.atomicMatch(one, oneSig, firstCall, two, twoSig, secondCall, ZERO_BYTES32, {from: nftSeller})
    assert.equal(await erc20.balanceOf(nftSeller), 2, 'Incorrect ERC20 balance after trade')
    assert.equal(await erc721.ownerOf(nfts[0]), nftBuyer, 'Incorrect ERC721 NFT owner after trade')
  })

//   it('purchase ERC721 NFT with ERC20 tokens',async () => {
//     let {atomicizer, exchange, registry, statici, erc20, erc721} = await withContracts()
//     let {tokens, nfts} = await withSomeTokens()

//     await erc721.transferFrom(accounts[0], accounts[6], nfts[0], {from: accounts[0]})
//     assert.equal(await erc20.balanceOf(accounts[6]), 0, 'Incorrect initial ERC20 balance')
//     assert.equal(await erc721.ownerOf(nfts[0]), accounts[6], 'Incorrect initial ERC721 NFT owner')

//     const abi = [{'constant': false, 'inputs': [{'name': 'addrs', 'type': 'address[]'}, {'name': 'values', 'type': 'uint256[]'}, {'name': 'calldataLengths', 'type': 'uint256[]'}, {'name': 'calldatas', 'type': 'bytes'}], 'name': 'atomicize', 'outputs': [], 'payable': false, 'stateMutability': 'nonpayable', 'type': 'function'}]
//     const atomicizerc = new web3.eth.Contract(abi, atomicizer.address)
//     const erc20c = new web3.eth.Contract(erc20.abi, erc20.address)
//     const erc721c = new web3.eth.Contract(erc721.abi, erc721.address)
    
//     const selectorOne = web3.eth.abi.encodeFunctionSignature('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
//     const extradataOne = '0x'
//     const one = {registry: registry.address, maker: accounts[0], staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: extradataOne, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3352'}

//     const selectorTwo = web3.eth.abi.encodeFunctionSignature('any(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
//     const extradataTwo = '0x'
//     const two = {registry: registry.address, maker: accounts[6], staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: extradataTwo, maximumFill: '1', listingTime: '0', expirationTime: '10000000000', salt: '3335'}
        
//     const firstERC20Call = erc20c.methods.transferFrom(accounts[0], accounts[6], 2).encodeABI()
//     const firstData = atomicizerc.methods.atomicize(
//       [erc20.address],
//       [0],
//       [(firstERC20Call.length - 2) / 2],
//       firstERC20Call
//     ).encodeABI()
    
//     const secondERC721Call = erc721c.methods.transferFrom(accounts[6], accounts[0], nfts[0]).encodeABI()
//     const secondData = atomicizerc.methods.atomicize(
//       [erc721.address],
//       [0],
//       [(secondERC721Call.length - 2) / 2],
//       secondERC721Call
//     ).encodeABI()
    
//     const firstCall = {target: atomicizer.address, howToCall: 1, data: firstData}
//     const secondCall = {target: atomicizer.address, howToCall: 1, data: secondData}
    
//     const oneSig = NULL_SIG

//     let twoSig = await exchange.sign(two, accounts[6])
//     await exchange.atomicMatch(one, oneSig, firstCall, two, twoSig, secondCall, ZERO_BYTES32)
//     assert.equal(await erc20.balanceOf(accounts[6]), 2, 'Incorrect ERC20 balance after trade')
//     assert.equal(await erc721.ownerOf(nfts[0]), accounts[0], 'Incorrect ERC721 NFT owner after trade')
//   })

})
