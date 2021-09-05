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
        const two = {registry: registry.address, maker: nftBuyer, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: paramsTwo, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '12'}
        const secondData = erc20c.methods.transferFrom(nftBuyer, nftSeller, buyingPrice).encodeABI()
        const secondCall = {target: erc20.address, howToCall: 0, data: secondData}
        let sigTwo = await exchange.sign(two, nftBuyer)

        // -------------- Execute the NFT Trade -------------- //

        anyAccount = accounts[3]
        await exchange.atomicMatchWith(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: anyAccount}) // anyone can trigger the trade

        // -------------- Verify the NFT Trade -------------- //

        let nftSellerErc20Balance = await erc20.balanceOf(nftSeller)
        let tokenOwner = await erc721.ownerOf(nftTokenID)
        assert.equal(nftSellerErc20Balance.toNumber(), buyingPrice, 'Incorrect ERC20 balance')
        assert.equal(tokenOwner, nftBuyer, 'Incorrect token owner')
    })
  
    it('purchase ERC721 NFT with TFuel', async () => {
        // NOTE: the (msgValue == price) check in StaticMarket.ETHForERC721() and StaticMarket.ERC721ForETH()
        //       require that (msg.value == sellingPrice && msg.value == buyingPrice) for NFT/TFuel trade.
        //       i.e. for NFT/TFuel trandes, sellingPrice and buyingPrice need to be identical, otherwise the 
        //       atomicMatch() will fail
        let nftTokenID      = 7777;
        let sellingPrice    = 99;
        let buyingPrice     = 99;
        let nftSeller       = accounts[6];
        let nftBuyer        = accounts[0];

        let {exchange, registry, statici} = await deployCoreContracts()
        let [erc721] = await deploy([TestERC721])

        await erc721.mint(nftSeller, nftTokenID)

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

        let buyerInitialEthBalance = await web3.eth.getBalance(nftBuyer)
        let sellerInitialEthBalance = await web3.eth.getBalance(nftSeller)
        // console.log("buyerInitialEthBalance: ", buyerInitialEthBalance)
        // console.log("sellerInitialEthBalance:", sellerInitialEthBalance)

        // -------------- Prepare for the NFT Trade -------------- //

        const erc721c = new web3.eth.Contract(erc721.abi, erc721.address)

        // NFT Seller
        const selectorOne = web3.eth.abi.encodeFunctionSignature('ERC721ForETH(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
        const paramsOne = web3.eth.abi.encodeParameters(['address[2]', 'uint256[2]'], [[erc721.address, "0x0000000000000000000000000000000000000000"], [nftTokenID, sellingPrice]]) 
        const one = {registry: registry.address, maker: nftSeller, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: paramsOne, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '11'}
        const firstData = erc721c.methods.transferFrom(nftSeller, nftBuyer, nftTokenID).encodeABI()
        const firstCall = {target: erc721.address, howToCall: 0, data: firstData}
        let sigOne = await exchange.sign(one, nftSeller)
        
        // NFT Buyer, target: "0x0000000000000000000000000000000000000000" indicates buying with TFuel
        const selectorTwo = web3.eth.abi.encodeFunctionSignature('ETHForERC721(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
        const paramsTwo = web3.eth.abi.encodeParameters(['address[2]', 'uint256[2]'], [["0x0000000000000000000000000000000000000000", erc721.address], [nftTokenID, buyingPrice]])
        const two = {registry: registry.address, maker: nftBuyer, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: paramsTwo, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '12'}
        const secondCall = {target: "0x0000000000000000000000000000000000000000", howToCall: 0, data: "0x"}
        let sigTwo = await exchange.sign(two, nftBuyer)

        // -------------- Execute the NFT Trade -------------- //

        // atomicMatchWith needs to be called by the nftBuyer since the buyer needs to pay the TFuel
        await exchange.atomicMatchWith(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftBuyer, value: sellingPrice})

        // -------------- Verify the NFT Trade -------------- //

        let tokenOwner = await erc721.ownerOf(nftTokenID)
        assert.equal(tokenOwner, nftBuyer, 'Incorrect token owner')

        let buyerFinalEthBalance = await web3.eth.getBalance(nftBuyer)
        let sellerFinalEthBalance = await web3.eth.getBalance(nftSeller)
        // console.log("buyerFinalEthBalance:   ", buyerFinalEthBalance)
        // console.log("sellerFinalEthBalance:  ", sellerFinalEthBalance)

        let sellerFinalEthBalanceBN = web3.utils.toBN(sellerFinalEthBalance)
        let sellerInitialEthBalanceBN = web3.utils.toBN(sellerInitialEthBalance)
        assert.equal(sellerFinalEthBalanceBN.sub(sellerInitialEthBalanceBN), buyingPrice, 'Incorrect amount of TFuel transferred')
    })
})
