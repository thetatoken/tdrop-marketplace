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

const primaryMarketPlatformFeeSplitBasisPoints = 3000
const secondaryMarketPlatformFeeSplitBasisPoints = 1000
const epsilon = new BN('1000000000000000000') // 1 * 10**18, 1 TDrops
const alpha = new BN('1000000000000000000')
const gamma = new BN('10000000000000').sub(new BN(1))
const omega = new BN('100000');
const maxRewardPerTrade = new BN('1000000000000000000000') // 1000 * 10**18, 1000 TDrop

//
// Note: This test case only works with Gananche since it calls `evm_mine`
//
contract('ThetaDrop-NFT-Liquidity-Mining', (accounts) => {

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
        await marketplace.setPrimaryMarketPlatformFeeSplitBasisPoints(primaryMarketPlatformFeeSplitBasisPoints, {from: admin})
        await marketplace.setSecondaryMarketPlatformFeeSplitBasisPoints(secondaryMarketPlatformFeeSplitBasisPoints, {from: admin})
        await marketplace.setTokenSwapAgent(tokenSwapAgent.address, {from: admin})
        await marketplace.setDataWarehouse(dataWarehouse.address, {from: admin})
        await marketplace.enableNFTLiqudityMining(true, {from: admin})
        await marketplace.updateLiquidityMiningParams(epsilon, alpha, gamma, omega, maxRewardPerTrade, {from: admin})
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

    let calculateExpectedTDropMined = (numBlocksElapsed, price, highestSellingPriceInThePast) => {
        let priceIncrease = new BN(price).sub(new BN(highestSellingPriceInThePast))
        if (priceIncrease.lt(new BN(0))) {
            return epsilon
        } else {
            let normalizedPriceIncrease = priceIncrease.div(gamma.add(new BN(1)))

            // f = ceil(log2(normalizedPriceIncrease + 1))
            let f = new BN(Math.ceil(Math.log(normalizedPriceIncrease.add(new BN(1))) / Math.log(2)))

            // g = 1 - 1000000 / (omega * numBlocksElapsed + 1000000) = omega * numBlocksElapsed / (omega * numBlocksElapsed + 1000000)
            let gNumer = omega.mul(new BN(numBlocksElapsed))
            let gDenom = omega.mul(new BN(numBlocksElapsed)).add(new BN(1000000))
    
            // tdropMined = alpha * f * g + epsilon
            let tdropMined = alpha.mul(f).mul(gNumer).div(gDenom)
            tdropMined = tdropMined.add(epsilon)

            if (tdropMined.gt(maxRewardPerTrade)) {
                tdropMined = maxRewardPerTrade
            }

            return tdropMined
        }
    }

    let deploy = async contracts => Promise.all(contracts.map(contract => contract.new()))
  
    it('NFT Liquidity Mining', async () => {
        // NOTE: the (msgValue == price) check in StaticMarket.ETHForERC721() and StaticMarket.ERC721ForETH()
        //       require that (msg.value == sellingPrice && msg.value == buyingPrice) for NFT/TFuel trade.
        //       i.e. for NFT/TFuel trandes, sellingPrice and buyingPrice need to be identical, otherwise the 
        //       atomicMatch() will fail
        let nftTokenID   = 9912879027088
        let sellingPrice = 2834508383853485
        let buyingPrice  = 2834508383853485
        let nftSeller    = accounts[6]
        let nftBuyer     = accounts[0]
        let platformFeeRecipient = accounts[7]

        let {registry, marketplace, tokenSwapAgent, dataWarehouse, atomicizer, statici, tdropToken} = await deployCoreContracts()
        let tokenSwapAgentAddr = tokenSwapAgent.address
        let [erc721] = await deploy([TestERC721])

        await erc721.mint(nftSeller, nftTokenID)

        // -------------- Account registration and setup -------------- //

        // -------------- The seller puts the NFT on sale -------------- //

        await erc721.setApprovalForAll(tokenSwapAgentAddr, true, {from: nftSeller})

        let buyerInitialEthBalance = await web3.eth.getBalance(nftBuyer)
        let sellerInitialEthBalance = await web3.eth.getBalance(nftSeller)
        let platformFeeRecipientInitialEthBalance = await web3.eth.getBalance(platformFeeRecipient)

        //
        // The first trade
        //

        // -------------- Prepare for the NFT Trade -------------- //

        const erc721c = new web3.eth.Contract(erc721.abi, erc721.address)

        // NFT Seller
        // Important note: should use different salt strings for different trades
        const selectorOne = web3.eth.abi.encodeFunctionSignature('ERC721ForETH(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
        const paramsOne = web3.eth.abi.encodeParameters(['address[2]', 'uint256[2]'], [[erc721.address, "0x0000000000000000000000000000000000000000"], [nftTokenID, sellingPrice]]) 
        const one = {registry: registry.address, maker: nftSeller, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: paramsOne, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '11'}
        const firstData = erc721c.methods.transferFrom(nftSeller, nftBuyer, nftTokenID).encodeABI()
        const firstCall = {target: erc721.address, howToCall: 0, data: firstData}
        let sigOne = await marketplace.sign(one, nftSeller) // in an actual implementation, this should be signed by the seller

        // NFT Buyer, target: "0x0000000000000000000000000000000000000000" indicates buying with TFuel
        // Important note: should use different salt strings for different trades        
        const selectorTwo = web3.eth.abi.encodeFunctionSignature('ETHForERC721(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
        const paramsTwo = web3.eth.abi.encodeParameters(['address[2]', 'uint256[2]'], [["0x0000000000000000000000000000000000000000", erc721.address], [nftTokenID, buyingPrice]])
        const two = {registry: registry.address, maker: nftBuyer, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: paramsTwo, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '12'}
        const secondCall = {target: "0x0000000000000000000000000000000000000000", howToCall: 0, data: "0x"}
        let sigTwo = await marketplace.sign(two, nftBuyer) // in an actual implementation, this should be signed by the buyer

        // -------------- Advance a few blocks -------------- //
        
        await mineBlocks(10)
        let h1 = await getBlockHeight(true)

        // -------------- Execute the NFT Trade -------------- //

        // tradeNFT needs to be called by the nftBuyer since the buyer needs to pay the TFuel
        await marketplace.tradeNFT(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: nftBuyer, value: sellingPrice})

        // -------------- Verify the NFT Trade -------------- //

        let tokenOwner = await erc721.ownerOf(nftTokenID)
        assert.equal(tokenOwner, nftBuyer, 'Incorrect token owner')

        let buyerFinalEthBalance = await web3.eth.getBalance(nftBuyer)
        let sellerFinalEthBalance = await web3.eth.getBalance(nftSeller)
        let platformFeeRecipientFinalEthBalance = await web3.eth.getBalance(platformFeeRecipient)
        let buyerTDropBalance = await tdropToken.balanceOf(nftBuyer)
        let sellerTDropBalance = await tdropToken.balanceOf(nftSeller)

        split = primaryMarketPlatformFeeSplitBasisPoints / 10000.0
        expectedPlatformFee = Math.floor(buyingPrice * split)
        expectedNFTSellerEarning = buyingPrice - expectedPlatformFee

        let sellerFinalEthBalanceBN = web3.utils.toBN(sellerFinalEthBalance)
        let sellerInitialEthBalanceBN = web3.utils.toBN(sellerInitialEthBalance)

        let platformFeeRecipientFinalEthBalanceBN = web3.utils.toBN(platformFeeRecipientFinalEthBalance)
        let platformFeeRecipientInitialEthBalanceBN = web3.utils.toBN(platformFeeRecipientInitialEthBalance)

        assert.equal(sellerFinalEthBalanceBN.sub(sellerInitialEthBalanceBN), expectedNFTSellerEarning, 'Incorrect amount of TFuel transferred')
        assert.equal(platformFeeRecipientFinalEthBalanceBN.sub(platformFeeRecipientInitialEthBalanceBN), expectedPlatformFee, 'Incorrect platform fee transferred')

        // -------------- Verify the Liquidity Mining Results -------------- //

        assert.isTrue(sellerTDropBalance.cmp(new BN('0')) == 0) // sellerTDropBalance == 0

        let expectedTDropMined = calculateExpectedTDropMined(h1, sellingPrice, 0)

        console.log("buyerTDropBalance :", buyerTDropBalance.toString(), "TDropWei")
        console.log("expectedTDropMined:", expectedTDropMined.toString(), "TDropWei")

        let diffInTDropWei = buyerTDropBalance.sub(expectedTDropMined)
        let diffInTDrop = diffInTDropWei.mul(new BN(100000000)).div(new BN('1000000000000000000')).toNumber() / 100000000
        console.log("diffInTDropWei    :", diffInTDropWei.toString(), "TDropWei")
        console.log("diffInTDrop       :", diffInTDrop, "TDrop")

        // expectedTDropMined - maxDiff < buyerTDropBalance < expectedTDropMined + maxDiff
        let maxDiff = new BN('1000000000000000') // 10^15 TDropWei = 0.001 TDrop
        assert.isTrue(buyerTDropBalance.gt(expectedTDropMined.sub(maxDiff)))
        assert.isTrue(buyerTDropBalance.lt(expectedTDropMined.add(maxDiff)))
    })
})
