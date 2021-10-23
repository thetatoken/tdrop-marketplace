const WyvernAtomicizer = artifacts.require('WyvernAtomicizer')
const TokenSwapAgent = artifacts.require('TokenSwapAgent')
const ThetaDropMarketplace = artifacts.require('ThetaDropMarketplace')
const ThetaDropDataWarehouse = artifacts.require('ThetaDropDataWarehouse')
const StaticMarket = artifacts.require('StaticMarket')
const WyvernRegistry = artifacts.require('WyvernRegistry')
const TestERC20 = artifacts.require('TestERC20')
const TestERC721 = artifacts.require('TestERC721')
const MockTDropToken = artifacts.require('MockTDropToken')

const Web3 = require('web3')
const provider = new Web3.providers.HttpProvider('http://localhost:18888')
const web3 = new Web3(provider)
const {wrap,ZERO_BYTES32, CHAIN_ID} = require('./aux')
const BN = web3.utils.BN

const platformFeeSplitBasisPoints = 1000
const epsilon = new BN('1000000000000000000') // 1 * 10**18, 1 TDrops
const alpha = new BN('1000000000000000000')
const gamma = new BN('10000000000000').sub(new BN(1))
const omega = new BN('100000');
const priceThreshold = new BN('1500000000000000000') // 1.5*10**18, 1.5 TFuel
const maxRewardPerTrade = new BN('1000000000000000000000') // 1000 * 10**18, 1000 TDrop

//
// Note: This test case only works with Gananche since it calls `evm_mine`
//
contract('ThetaDrop-NFT-Liquidity-Mining', (accounts) => {

    const dec18 = new BN('1000000000000000000')

    let deploy = async contracts => Promise.all(contracts.map(contract => contract.new()))

    let deployCoreContracts = async () => {
        superAdmin = accounts[9]
        admin = accounts[8]
        platformFeeRecipient = accounts[7]

        tdropToken = await MockTDropToken.new()
        registry = await WyvernRegistry.new()
        atomicizer = await WyvernAtomicizer.new()
        marketplace = await ThetaDropMarketplace.new(CHAIN_ID, '0x', superAdmin, admin, platformFeeRecipient)
        tokenSwapAgent = await TokenSwapAgent.new(superAdmin, admin)
        dataWarehouse = await ThetaDropDataWarehouse.new(superAdmin, admin)
        statici = await StaticMarket.new()

        await marketplace.setTDropToken(tdropToken.address, {from: admin})
        await marketplace.setPrimaryMarketPlatformFeeSplitBasisPoints(platformFeeSplitBasisPoints, {from: admin})
        await marketplace.setSecondaryMarketPlatformFeeSplitBasisPoints(platformFeeSplitBasisPoints, {from: admin})
        await marketplace.setTokenSwapAgent(tokenSwapAgent.address, {from: admin})
        await marketplace.setDataWarehouse(dataWarehouse.address, {from: admin})
        await marketplace.enableNFTLiqudityMining(true, {from: admin})
        await marketplace.updateLiquidityMiningParams(epsilon, alpha, gamma, omega, priceThreshold, maxRewardPerTrade, {from: admin})
        await marketplace.enableLiqudityMiningOnlyForWhitelistedNFTs(false, {from: admin})

        await tokenSwapAgent.setMarketplace(marketplace.address, {from: admin})
        await dataWarehouse.setMarketplace(marketplace.address, {from: admin})
        await registry.grantInitialAuthentication(marketplace.address)

        return {registry, marketplace:wrap(marketplace), tokenSwapAgent, dataWarehouse, atomicizer, statici, tdropToken}
    }
    
    let mineBlocks = async (numBlocks)  => {
        for (let i = 0; i < numBlocks+1; i ++) {
            await web3.currentProvider.send({
                jsonrpc: "2.0",
                method: "evm_mine",
                id: 12345
              }, function(err, result) {});
        }
    }

    let getBlockHeight = async (print) => {
        currentBlockHeight = await web3.eth.getBlockNumber()
        if (print) {
            console.log("current block height:", currentBlockHeight)
        }
        return currentBlockHeight
    }

    let calculateExpectedTDropMined = (currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight) => {
        let numBlocksElapsed = (new BN(currentTradeBlockHeight)).sub(new BN(lastTradeBlockHeight))
        assert.isTrue(numBlocksElapsed.gte(new BN(0)))

        if (currentTradePrice.lte(priceThreshold)) {
            return new BN(0)
        }

        let priceIncrease = (new BN(currentTradePrice)).sub(new BN(highestSellingPriceInThePast))
        if (priceIncrease.lt(new BN(0))) {
            return epsilon
        } 
        
        let normalizedPriceIncrease = priceIncrease.div(gamma.add(new BN(1)))

        // f = ceil(log2(normalizedPriceIncrease + 1))
        let f = new BN(Math.ceil(Math.log(normalizedPriceIncrease.add(new BN(1))) / Math.log(2)))

        // g = 1 - 1000000 / (omega * numBlocksElapsed + 1000000) = omega * numBlocksElapsed / (omega * numBlocksElapsed + 1000000)
        let gNumer = omega.mul(new BN(numBlocksElapsed))
        let gDenom = omega.mul(new BN(numBlocksElapsed)).add(new BN(1000000))

        // tdropMined = alpha * f * g + epsilon = alpha * f * gNumer / gDenom + epsilon
        let tdropMined = alpha.mul(f).mul(gNumer).div(gDenom)
        tdropMined = tdropMined.add(epsilon)

        if (tdropMined.gt(maxRewardPerTrade)) {
            tdropMined = maxRewardPerTrade
        }

        return tdropMined
    }

    let prepareForNFTTrade = async (marketplace, erc721, nftSeller, nftSellerSalt, nftBuyer, nftBuyerSalt, nftTokenID, price) => {
        const erc721c = new web3.eth.Contract(erc721.abi, erc721.address)

        // NFT Seller
        // Important note: should use different salt strings for different trades
        const selectorOne = web3.eth.abi.encodeFunctionSignature('ERC721ForETH(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
        const paramsOne = web3.eth.abi.encodeParameters(['address[2]', 'uint256[2]'], [[erc721.address, "0x0000000000000000000000000000000000000000"], [nftTokenID, price.toString()]]) 
        const one = {registry: registry.address, maker: nftSeller, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: paramsOne, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: nftSellerSalt}
        const firstData = erc721c.methods.transferFrom(nftSeller, nftBuyer, nftTokenID).encodeABI()
        const firstCall = {target: erc721.address, howToCall: 0, data: firstData}
        let sigOne = await marketplace.sign(one, nftSeller) // in an actual implementation, this should be signed by the seller

        // NFT Buyer, target: "0x0000000000000000000000000000000000000000" indicates buying with TFuel
        // Important note: should use different salt strings for different trades
        const selectorTwo = web3.eth.abi.encodeFunctionSignature('ETHForERC721(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
        const paramsTwo = web3.eth.abi.encodeParameters(['address[2]', 'uint256[2]'], [["0x0000000000000000000000000000000000000000", erc721.address], [nftTokenID, price.toString()]])
        const two = {registry: registry.address, maker: nftBuyer, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: paramsTwo, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: nftBuyerSalt}
        const secondCall = {target: "0x0000000000000000000000000000000000000000", howToCall: 0, data: "0x"}
        let sigTwo = await marketplace.sign(two, nftBuyer) // in an actual implementation, this should be signed by the buyer

        return {one, sigOne, firstCall, two, sigTwo, secondCall}
    }

    let verifyTradeOutcome = async (erc721, nftSeller, nftBuyer, nftTokenID, currentTradePrice, sellerEthBalanceB4Trade, buyerEthBalanceB4Trade, platformFeeRecipientEthBalanceB4Trade, print) => {
        let tokenOwner = await erc721.ownerOf(nftTokenID)
        assert.equal(tokenOwner, nftBuyer, 'Incorrect token owner')

        let buyerEthBalance = await web3.eth.getBalance(nftBuyer)
        let sellerEthBalance = await web3.eth.getBalance(nftSeller)
        let platformFeeRecipientEthBalance = await web3.eth.getBalance(platformFeeRecipient)

        let currentTradePriceBN = web3.utils.toBN(currentTradePrice) 
        let expectedPlatformFeeBN = currentTradePriceBN.mul(new BN(platformFeeSplitBasisPoints)).div(new BN(10000))
        let expectedNFTSellerEarningBN = currentTradePriceBN.sub(expectedPlatformFeeBN)

        let sellerEthBalanceB4TradeBN = web3.utils.toBN(sellerEthBalanceB4Trade)
        let sellerEthBalanceBN = web3.utils.toBN(sellerEthBalance)

        let buyerEthBalanceB4TradeBN = web3.utils.toBN(buyerEthBalanceB4Trade)
        let buyerEthBalanceBN = web3.utils.toBN(buyerEthBalance)

        let platformFeeRecipientEthBalanceBN = web3.utils.toBN(platformFeeRecipientEthBalance)
        let platformFeeRecipientEthBalanceB4TradeBN = web3.utils.toBN(platformFeeRecipientEthBalanceB4Trade)

        let sellerEthBalanceIncreaseBN = sellerEthBalanceBN.sub(sellerEthBalanceB4TradeBN)
        let buyerEthBalanceDecreaseBN = buyerEthBalanceB4TradeBN.sub(buyerEthBalanceBN)
        let platformFeeRecipientEthBalanceIncreaseBN = platformFeeRecipientEthBalanceBN.sub(platformFeeRecipientEthBalanceB4TradeBN)

        if (print) {
            console.log('sellerEthBalanceIncreaseBN:', sellerEthBalanceIncreaseBN.toString())
            console.log('expectedNFTSellerEarningBN:', expectedNFTSellerEarningBN.toString())
    
            console.log('buyerEthBalanceDecreaseBN :', buyerEthBalanceDecreaseBN.toString())
            console.log('currentTradePriceBN       :', currentTradePriceBN.toString())
    
            console.log('platformFeeRecipientEthBalanceIncreaseBN:', platformFeeRecipientEthBalanceIncreaseBN.toString())
            console.log('expectedPlatformFeeBN                   :', expectedPlatformFeeBN.toString())
        }

        assert.equal(sellerEthBalanceIncreaseBN.toString(), expectedNFTSellerEarningBN.toString(), 'Incorrect amount of TFuel transferred')
        assert.isTrue(buyerEthBalanceDecreaseBN.gt(currentTradePriceBN), 'Incorrect amount of TFuel deducted from the buyer') // The buyer also needs to pay for the gas fee
        assert.equal(platformFeeRecipientEthBalanceIncreaseBN.toString(), expectedPlatformFeeBN.toString(), 'Incorrect platform fee transferred')
    }

    let verifyLiquidityMiningResults = async (nftSeller, nftBuyer, sellerTDropBalanceB4Trade, buyerTDropBalanceB4Trade, currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight, maxDiff, print) => {
        let sellerTDropBalance = await tdropToken.balanceOf(nftSeller)
        let buyerTDropBalance = await tdropToken.balanceOf(nftBuyer)
        let buyerTDropIncrease = buyerTDropBalance.sub(new BN(buyerTDropBalanceB4Trade))

        assert.isTrue(sellerTDropBalance.sub(sellerTDropBalanceB4Trade).cmp(new BN('0')) == 0) // seller's TDrop balance should not change

        let expectedTDropMinedInWei = calculateExpectedTDropMined(currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight)

        if (print) {
            console.log("buyerTDropIncrease:", buyerTDropIncrease.toString(), "TDropWei")
            console.log("expectedTDropMined:", expectedTDropMinedInWei.toString(), "TDropWei")

            expectedTDropMined = expectedTDropMinedInWei.mul(new BN(100000000)).div(dec18).toNumber() / 100000000
            console.log("expectedTDropMined:", expectedTDropMined.toString(), "TDrop")
        }

        let diffInTDropWei = buyerTDropIncrease.sub(expectedTDropMinedInWei)
        let diffInTDrop = diffInTDropWei.mul(new BN(100000000)).div(dec18).toNumber() / 100000000
        
        if (print) {
            console.log("diffInTDropWei    :", diffInTDropWei.toString(), "TDropWei")
            console.log("diffInTDrop       :", diffInTDrop, "TDrop")
        }

        // expectedTDropMined - maxDiff < buyerTDropIncrease < expectedTDropMined + maxDiff
        assert.isTrue(buyerTDropIncrease.gt(expectedTDropMinedInWei.sub(maxDiff)))
        assert.isTrue(buyerTDropIncrease.lt(expectedTDropMinedInWei.add(maxDiff)))
    }

    let getSalt = () => {
        let epochTimeMilli = (new Date())/1
        return epochTimeMilli.toString()
    }
  
    it('NFT Liquidity Mining Basic Test', async () => {
        let nftTokenID           = 9912879027088
        let currentTradePrice    = (new BN(122)).mul(dec18)
        let highestSellingPriceInThePast = new BN(0)
        let nftSeller            = accounts[5]
        let nftBuyer             = accounts[6]
        let platformFeeRecipient = accounts[7]

        let {registry, marketplace, tokenSwapAgent, dataWarehouse, atomicizer, statici, tdropToken} = await deployCoreContracts()
        let tokenSwapAgentAddr = tokenSwapAgent.address
        let [erc721] = await deploy([TestERC721])

        await erc721.mint(nftSeller, nftTokenID)

        // The seller puts the NFT on sale
        await erc721.setApprovalForAll(tokenSwapAgentAddr, true, {from: nftSeller})

        // The NFT trade
        let lastTradeBlockHeight = new BN(0)
        await mineBlocks(10) // advance a few blocks
        let currentTradeBlockHeight = await getBlockHeight(true)

        let buyerEthBalanceB4Trade = await web3.eth.getBalance(nftBuyer)
        let sellerEthBalanceB4Trade = await web3.eth.getBalance(nftSeller)
        let platformFeeRecipientEthBalanceB4Trade = await web3.eth.getBalance(platformFeeRecipient)
        let sellerTDropBalanceB4Trade = await tdropToken.balanceOf(nftSeller)
        let buyerTDropBalanceB4Trade = await tdropToken.balanceOf(nftBuyer)

        let nftSellerSalt = getSalt()
        let nftBuyerSalt  = getSalt()
        let {one, sigOne, firstCall, two, sigTwo, secondCall} = await prepareForNFTTrade(marketplace, erc721, nftSeller, nftSellerSalt, nftBuyer, nftBuyerSalt, nftTokenID, currentTradePrice)        
        await marketplace.tradeNFT(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftBuyer, value: currentTradePrice})

        await verifyTradeOutcome(erc721, nftSeller, nftBuyer, nftTokenID, currentTradePrice, sellerEthBalanceB4Trade, buyerEthBalanceB4Trade, platformFeeRecipientEthBalanceB4Trade, true)
        let maxDiff = new BN('100000000000000000') // 10^17 TDropWei = 0.1 TDrop
        await verifyLiquidityMiningResults(nftSeller, nftBuyer, sellerTDropBalanceB4Trade, buyerTDropBalanceB4Trade, currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight, maxDiff, true)
    })

    it('NFT Liquidity Mining Multiple Trades', async () => {
        let nftTokenID = 9912879027088

        let tradePrice1 = (new BN(2)).mul(dec18)
        let tradePrice2 = (new BN(300)).mul(dec18)     // price increases
        let tradePrice3 = (new BN(103)).mul(dec18)     // price decreases
        let tradePrice4 = (new BN(288)).mul(dec18)     // price increases, but less than the highest traded price in history
        let tradePrice5 = (new BN(1999999)).mul(dec18) // price increases, and surpasses the highest traded price in history
        let tradePrice6 = (new BN(1)).mul(dec18)       // not eligible to receive TDrop since it is lower than the priceThreshold

        let user1 = accounts[1]
        let user2 = accounts[2]
        let user3 = accounts[3]
        let user4 = accounts[4]

        let platformFeeRecipient = accounts[7]

        let {registry, marketplace, tokenSwapAgent, dataWarehouse, atomicizer, statici, tdropToken} = await deployCoreContracts()
        let tokenSwapAgentAddr = tokenSwapAgent.address
        let [erc721] = await deploy([TestERC721])

        await erc721.mint(user1, nftTokenID)

        await erc721.setApprovalForAll(tokenSwapAgentAddr, true, {from: user1})
        await erc721.setApprovalForAll(tokenSwapAgentAddr, true, {from: user2})
        await erc721.setApprovalForAll(tokenSwapAgentAddr, true, {from: user3})
        await erc721.setApprovalForAll(tokenSwapAgentAddr, true, {from: user4})

        //
        // The First Trade
        //

        console.log("-------------------------------------------------------------")
        console.log("NFT Trade")
        console.log("")


        nftSeller = user1
        nftBuyer  = user2
        currentTradePrice = tradePrice1
        highestSellingPriceInThePast = new BN(0)
        lastTradeBlockHeight = new BN(0)
        await mineBlocks(100) // advance a few blocks
        currentTradeBlockHeight = await getBlockHeight(true)
        console.log("lastTradeBlockHeight:", lastTradeBlockHeight.toString(), "currentTradeBlockHeight:", currentTradeBlockHeight.toString())

        buyerEthBalanceB4Trade = await web3.eth.getBalance(nftBuyer)
        sellerEthBalanceB4Trade = await web3.eth.getBalance(nftSeller)
        platformFeeRecipientEthBalanceB4Trade = await web3.eth.getBalance(platformFeeRecipient)
        sellerTDropBalanceB4Trade = await tdropToken.balanceOf(nftSeller)
        buyerTDropBalanceB4Trade = await tdropToken.balanceOf(nftBuyer)

        nftSellerSalt = getSalt()
        nftBuyerSalt  = getSalt()
        {
            let {one, sigOne, firstCall, two, sigTwo, secondCall} = await prepareForNFTTrade(marketplace, erc721, nftSeller, nftSellerSalt, nftBuyer, nftBuyerSalt, nftTokenID, currentTradePrice)        
            await marketplace.tradeNFT(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftBuyer, value: currentTradePrice})
        }
        await verifyTradeOutcome(erc721, nftSeller, nftBuyer, nftTokenID, currentTradePrice, sellerEthBalanceB4Trade, buyerEthBalanceB4Trade, platformFeeRecipientEthBalanceB4Trade, true)

        maxDiff = new BN('100000000000000000') // 10^17 TDropWei = 0.1 TDrop
        await verifyLiquidityMiningResults(nftSeller, nftBuyer, sellerTDropBalanceB4Trade, buyerTDropBalanceB4Trade, currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight, maxDiff, true)
          
        console.log("-------------------------------------------------------------")
        console.log("")

        //
        // The Second Trade
        //

        console.log("-------------------------------------------------------------")
        console.log("NFT Trade")
        console.log("")

        nftSeller = user2
        nftBuyer  = user3
        currentTradePrice = tradePrice2
        highestSellingPriceInThePast = tradePrice1
        lastTradeBlockHeight = currentTradeBlockHeight
        await mineBlocks(5) // advance a few blocks
        currentTradeBlockHeight = await getBlockHeight(true)
        console.log("lastTradeBlockHeight:", lastTradeBlockHeight.toString(), "currentTradeBlockHeight:", currentTradeBlockHeight.toString())

        buyerEthBalanceB4Trade = await web3.eth.getBalance(nftBuyer)
        sellerEthBalanceB4Trade = await web3.eth.getBalance(nftSeller)
        platformFeeRecipientEthBalanceB4Trade = await web3.eth.getBalance(platformFeeRecipient)
        sellerTDropBalanceB4Trade = await tdropToken.balanceOf(nftSeller)
        buyerTDropBalanceB4Trade = await tdropToken.balanceOf(nftBuyer)

        nftSellerSalt = getSalt()
        nftBuyerSalt  = getSalt()
        {
            let {one, sigOne, firstCall, two, sigTwo, secondCall} = await prepareForNFTTrade(marketplace, erc721, nftSeller, nftSellerSalt, nftBuyer, nftBuyerSalt, nftTokenID, currentTradePrice)        
            await marketplace.tradeNFT(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftBuyer, value: currentTradePrice})
        }
        await verifyTradeOutcome(erc721, nftSeller, nftBuyer, nftTokenID, currentTradePrice, sellerEthBalanceB4Trade, buyerEthBalanceB4Trade, platformFeeRecipientEthBalanceB4Trade, true)
        
        maxDiff = new BN('2000000000000000000') // 2 TDrop, small block gaps between the two trades, smart contract and JS reading on the block gap might different. So larger maxDiff
        await verifyLiquidityMiningResults(nftSeller, nftBuyer, sellerTDropBalanceB4Trade, buyerTDropBalanceB4Trade, currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight, maxDiff, true)
         
        console.log("-------------------------------------------------------------")
        console.log("")

        //
        // The Third Trade
        //

        console.log("-------------------------------------------------------------")
        console.log("NFT Trade")
        console.log("")

        nftSeller = user3
        nftBuyer  = user4
        currentTradePrice = tradePrice3
        highestSellingPriceInThePast = tradePrice2
        lastTradeBlockHeight = currentTradeBlockHeight
        await mineBlocks(300) // advance a few blocks
        currentTradeBlockHeight = await getBlockHeight(true)
        console.log("lastTradeBlockHeight:", lastTradeBlockHeight.toString(), "currentTradeBlockHeight:", currentTradeBlockHeight.toString())

        buyerEthBalanceB4Trade = await web3.eth.getBalance(nftBuyer)
        sellerEthBalanceB4Trade = await web3.eth.getBalance(nftSeller)
        platformFeeRecipientEthBalanceB4Trade = await web3.eth.getBalance(platformFeeRecipient)
        sellerTDropBalanceB4Trade = await tdropToken.balanceOf(nftSeller)
        buyerTDropBalanceB4Trade = await tdropToken.balanceOf(nftBuyer)

        nftSellerSalt = getSalt()
        nftBuyerSalt  = getSalt()
        {
            let {one, sigOne, firstCall, two, sigTwo, secondCall} = await prepareForNFTTrade(marketplace, erc721, nftSeller, nftSellerSalt, nftBuyer, nftBuyerSalt, nftTokenID, currentTradePrice)        
            await marketplace.tradeNFT(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftBuyer, value: currentTradePrice})
        }
        await verifyTradeOutcome(erc721, nftSeller, nftBuyer, nftTokenID, currentTradePrice, sellerEthBalanceB4Trade, buyerEthBalanceB4Trade, platformFeeRecipientEthBalanceB4Trade, true)
        
        maxDiff = new BN('1') // 1 TDropWei, very small error tolerance since this trade is expected to mine exactly epsilon amount of TDrop since the current trade price doesn't exceed the historical height
        await verifyLiquidityMiningResults(nftSeller, nftBuyer, sellerTDropBalanceB4Trade, buyerTDropBalanceB4Trade, currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight, maxDiff, true)
         
        console.log("-------------------------------------------------------------")
        console.log("")

        //
        // The Fourth Trade
        //

        console.log("-------------------------------------------------------------")
        console.log("NFT Trade")
        console.log("")

        nftSeller = user4
        nftBuyer  = user1
        currentTradePrice = tradePrice4
        highestSellingPriceInThePast = tradePrice2
        lastTradeBlockHeight = currentTradeBlockHeight
        await mineBlocks(15) // advance a few blocks
        currentTradeBlockHeight = await getBlockHeight(true)
        console.log("lastTradeBlockHeight:", lastTradeBlockHeight.toString(), "currentTradeBlockHeight:", currentTradeBlockHeight.toString())

        buyerEthBalanceB4Trade = await web3.eth.getBalance(nftBuyer)
        sellerEthBalanceB4Trade = await web3.eth.getBalance(nftSeller)
        platformFeeRecipientEthBalanceB4Trade = await web3.eth.getBalance(platformFeeRecipient)
        sellerTDropBalanceB4Trade = await tdropToken.balanceOf(nftSeller)
        buyerTDropBalanceB4Trade = await tdropToken.balanceOf(nftBuyer)

        nftSellerSalt = getSalt()
        nftBuyerSalt  = getSalt()
        {
            let {one, sigOne, firstCall, two, sigTwo, secondCall} = await prepareForNFTTrade(marketplace, erc721, nftSeller, nftSellerSalt, nftBuyer, nftBuyerSalt, nftTokenID, currentTradePrice)        
            await marketplace.tradeNFT(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftBuyer, value: currentTradePrice})
        }
        await verifyTradeOutcome(erc721, nftSeller, nftBuyer, nftTokenID, currentTradePrice, sellerEthBalanceB4Trade, buyerEthBalanceB4Trade, platformFeeRecipientEthBalanceB4Trade, true)
        
        maxDiff = new BN('1') // 1 TDropWei, very small error tolerance since this trade is expected to mine exactly epsilon amount of TDrop since the current trade price doesn't exceed the historical height
        await verifyLiquidityMiningResults(nftSeller, nftBuyer, sellerTDropBalanceB4Trade, buyerTDropBalanceB4Trade, currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight, maxDiff, true)
         
        console.log("-------------------------------------------------------------")
        console.log("")

        //
        // The Fifth Trade
        //

        console.log("-------------------------------------------------------------")
        console.log("NFT Trade")
        console.log("")

        nftSeller = user1
        nftBuyer  = user3
        currentTradePrice = tradePrice5
        highestSellingPriceInThePast = tradePrice2
        lastTradeBlockHeight = currentTradeBlockHeight
        await mineBlocks(23) // advance a few blocks
        currentTradeBlockHeight = await getBlockHeight(true)
        console.log("lastTradeBlockHeight:", lastTradeBlockHeight.toString(), "currentTradeBlockHeight:", currentTradeBlockHeight.toString())

        buyerEthBalanceB4Trade = await web3.eth.getBalance(nftBuyer)
        sellerEthBalanceB4Trade = await web3.eth.getBalance(nftSeller)
        platformFeeRecipientEthBalanceB4Trade = await web3.eth.getBalance(platformFeeRecipient)
        sellerTDropBalanceB4Trade = await tdropToken.balanceOf(nftSeller)
        buyerTDropBalanceB4Trade = await tdropToken.balanceOf(nftBuyer)

        nftSellerSalt = getSalt()
        nftBuyerSalt  = getSalt()
        {
            let {one, sigOne, firstCall, two, sigTwo, secondCall} = await prepareForNFTTrade(marketplace, erc721, nftSeller, nftSellerSalt, nftBuyer, nftBuyerSalt, nftTokenID, currentTradePrice)        
            await marketplace.tradeNFT(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftBuyer, value: currentTradePrice})
        }
        await verifyTradeOutcome(erc721, nftSeller, nftBuyer, nftTokenID, currentTradePrice, sellerEthBalanceB4Trade, buyerEthBalanceB4Trade, platformFeeRecipientEthBalanceB4Trade, true)
        
        maxDiff = new BN('100000000000000000') // 10^17 TDropWei = 0.1 TDrop
        await verifyLiquidityMiningResults(nftSeller, nftBuyer, sellerTDropBalanceB4Trade, buyerTDropBalanceB4Trade, currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight, maxDiff, true)
         
        console.log("-------------------------------------------------------------")
        console.log("")

        //
        // The Sixth Trade
        //

        console.log("-------------------------------------------------------------")
        console.log("NFT Trade")
        console.log("")

        nftSeller = user3
        nftBuyer  = user1
        currentTradePrice = tradePrice6
        highestSellingPriceInThePast = tradePrice5
        lastTradeBlockHeight = currentTradeBlockHeight
        await mineBlocks(10) // advance a few blocks
        currentTradeBlockHeight = await getBlockHeight(true)
        console.log("lastTradeBlockHeight:", lastTradeBlockHeight.toString(), "currentTradeBlockHeight:", currentTradeBlockHeight.toString())

        buyerEthBalanceB4Trade = await web3.eth.getBalance(nftBuyer)
        sellerEthBalanceB4Trade = await web3.eth.getBalance(nftSeller)
        platformFeeRecipientEthBalanceB4Trade = await web3.eth.getBalance(platformFeeRecipient)
        sellerTDropBalanceB4Trade = await tdropToken.balanceOf(nftSeller)
        buyerTDropBalanceB4Trade = await tdropToken.balanceOf(nftBuyer)

        nftSellerSalt = getSalt()
        nftBuyerSalt  = getSalt()
        {
            let {one, sigOne, firstCall, two, sigTwo, secondCall} = await prepareForNFTTrade(marketplace, erc721, nftSeller, nftSellerSalt, nftBuyer, nftBuyerSalt, nftTokenID, currentTradePrice)        
            await marketplace.tradeNFT(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftBuyer, value: currentTradePrice})
        }
        await verifyTradeOutcome(erc721, nftSeller, nftBuyer, nftTokenID, currentTradePrice, sellerEthBalanceB4Trade, buyerEthBalanceB4Trade, platformFeeRecipientEthBalanceB4Trade, true)
        
        maxDiff = new BN('100000000000000000') // 10^17 TDropWei = 0.1 TDrop
        await verifyLiquidityMiningResults(nftSeller, nftBuyer, sellerTDropBalanceB4Trade, buyerTDropBalanceB4Trade, currentTradePrice, highestSellingPriceInThePast, currentTradeBlockHeight, lastTradeBlockHeight, maxDiff, true)
        
        buyerTDropBalance = await tdropToken.balanceOf(nftBuyer)
        assert.equal(buyerTDropBalance.toString(), buyerTDropBalanceB4Trade.toString(), 'The buyer should not mine any TDrop since the trading price is lower than the priceThreshold')

        console.log("-------------------------------------------------------------")
        console.log("")
    })
})
