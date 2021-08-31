const WyvernAtomicizer = artifacts.require('WyvernAtomicizer')
const WyvernExchange = artifacts.require('WyvernExchange')
const StaticMarket = artifacts.require('StaticMarket')
const WyvernRegistry = artifacts.require('WyvernRegistry')
const TestERC20 = artifacts.require('TestERC20')
const TestERC721 = artifacts.require('TestERC721')

const Web3 = require('web3')
const provider = new Web3.providers.HttpProvider('http://localhost:18888')
const web3 = new Web3(provider)
const {wrap,ZERO_BYTES32,CHAIN_ID} = require('./aux')

contract('WyvernExchange-NFT-Purchase', (accounts) => {

    let deployCoreContracts = async () => {
        registry = await WyvernRegistry.new()
        atomicizer = await WyvernAtomicizer.new()
        exchange = await WyvernExchange.new(CHAIN_ID,[registry.address],'0x')
        statici = await StaticMarket.new()

        await registry.grantInitialAuthentication(exchange.address)
        return {registry,exchange:wrap(exchange),atomicizer,statici}
    }

    let deploy = async contracts => Promise.all(contracts.map(contract => contract.new()))

    it('purchase ERC721 NFT with ERC20 tokens', async () => {
        let erc20MintAmount = 1000;        
        let nftTokenID      = 7777;
        let sellingPrice    = 99;
        let buyingPrice     = 99;
        let nftSeller       = accounts[6];
        let nftBuyer        = accounts[0];

        let {exchange, registry, statici} = await deployCoreContracts()
        let [erc721] = await deploy([TestERC721])
        let [erc20] = await deploy([TestERC20])

        await erc721.mint(nftSeller, nftTokenID)
        await erc20.mint(nftBuyer, erc20MintAmount)

        // -------------- Account registration and setup -------------- //

        // NFT Seller
        await registry.registerProxy({from: nftSeller})
        let sellerProxy = await registry.proxies(nftSeller)
        assert.equal(true, sellerProxy.length > 0, 'no proxy address for the NFT seller')
        await erc721.setApprovalForAll(sellerProxy, true, {from: nftSeller})

        // NFT Buyer
        await registry.registerProxy({from: nftBuyer})
        let buyerProxy = await registry.proxies(nftBuyer)
        assert.equal(true, buyerProxy.length > 0, 'no proxy address for the NFT buyer')
        let maxERC20Spending = 1000;
        await erc20.approve(buyerProxy, maxERC20Spending, {from: nftBuyer})

        // -------------- Prepare for the NFT Trade -------------- //

        const erc721c = new web3.eth.Contract(erc721.abi, erc721.address)
        const erc20c = new web3.eth.Contract(erc20.abi, erc20.address)

        // NFT Seller
        const selectorOne = web3.eth.abi.encodeFunctionSignature('ERC721ForERC20(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
        const paramsOne = web3.eth.abi.encodeParameters(['address[2]', 'uint256[2]'], [[erc721.address, erc20.address], [nftTokenID, sellingPrice]]) 
        const one = {registry: registry.address, maker: nftSeller, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: paramsOne, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '11'}
        const firstData = erc721c.methods.transferFrom(nftSeller, nftBuyer, nftTokenID).encodeABI()
        const firstCall = {target: erc721.address, howToCall: 0, data: firstData}
        let sigOne = await exchange.sign(one, nftSeller)

        // NFT Buyer
        const selectorTwo = web3.eth.abi.encodeFunctionSignature('ERC20ForERC721(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
        const paramsTwo = web3.eth.abi.encodeParameters(['address[2]', 'uint256[2]'], [[erc20.address, erc721.address], [nftTokenID, buyingPrice]])
        const two = {registry: registry.address, maker: nftBuyer, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: paramsTwo, maximumFill: buyingPrice, listingTime: '0', expirationTime: '10000000000', salt: '12'}
        const secondData = erc20c.methods.transferFrom(nftBuyer, nftSeller, buyingPrice).encodeABI()
        const secondCall = {target: erc20.address, howToCall: 0, data: secondData}
        let sigTwo = await exchange.sign(two, nftBuyer)

        // -------------- Execute the NFT Trade -------------- //

        await exchange.atomicMatchWith(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftSeller})

        // -------------- Verify the NFT Trade -------------- //

        let nftSellerErc20Balance = await erc20.balanceOf(nftSeller)
        let tokenOwner = await erc721.ownerOf(nftTokenID)
        assert.equal(nftSellerErc20Balance.toNumber(), sellingPrice,'Incorrect ERC20 balance')
        assert.equal(tokenOwner, nftBuyer,'Incorrect token owner')
    })

})
