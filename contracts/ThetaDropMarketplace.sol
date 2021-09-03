pragma abicoder v2;
pragma solidity 0.7.5;

import "./lib/ArrayUtils.sol";
import "./lib/ExtMath.sol";
import "./exchange/ExchangeCore.sol";

interface ITDropToken {
    function mine(address dst, uint rawAmount) external;
}

interface IDataWarehouse {
    function getHighestSellingPriceInTFuelWei(address nftAddr, uint tokenID) external returns (uint);
    function updateHighestSellingPriceInTFuelWei(address nftAddr, uint tokenID, uint newHigestPrice) external;
    function getLastNFTTradeBlockHeight(address nftAddr, uint tokenID) external returns (uint);
    function updateNFTTradeBlockHeight(address nftAddr, uint tokenID) external;
    function isAWhitelistedPaymentToken(address tokenAddr) external returns (bool);
    function isAWhitelistedTNT721NFTToken(address tokenAddr) external returns (bool);
    function isAWhitelistedTNT1155NFTToken(address tokenAddr) external returns (bool);
}

/**
 * @title ThetaDropMarketplace
 * @author ThetaDrop Marketplace Protocol Developers
 */
contract ThetaDropMarketplace is ExchangeCore {

    using SafeMath for uint;

    struct NFTTradeMetadata {
        address seller;
        address buyer;
        address nftTokenAddress;
        uint nftTokenID;
        uint nftAmount;
        address paymentTokenAddress; // paymentTokenAddress == 0x0 means paying with TFuel
        uint paymentTokenAmount;
        uint tdropMined;
    }

    struct LiquidityMiningParameters {
        uint epsilon;
        uint alpha;
        uint gamma;
        uint omega;
        uint maxRewardPerTrade;
    }

    string public constant name = "Wyvern Exchange";
  
    string public constant version = "3.1";

    string public constant codename = "Ancalagon";

    /// @notice The super admin address
    address public superAdmin;

    /// @notice The admin address
    address public admin;

    /// @notice The primary market platform fee split in basis points
    uint public primaryMarketPlatformFeeSplitBasisPoints;

    /// @notice The secondary market platform fee split in basis points
    uint public secondaryMarketPlatformFeeSplitBasisPoints;

    /// @notice The recipient of the platform fee
    address payable public platformFeeRecipient;

    /// @notice If NFT liquidity mining is enabled
    bool public liquidityMiningEnabled;

    /// @notice If NFT liquidity mining only enabled for whitelisted NFTs
    bool public miningOnlyForWhitelistedNFTs;

    /// @notice paramters for the liquidity mining
    LiquidityMiningParameters public lmp;

    /// @notice the address of TDrop data warehouse
    IDataWarehouse public dataWarehouse;

    /// @notice the address of the TDrop token
    ITDropToken public tdropToken;

    /// @notice if the marketplace is paused
    bool public paused;
    
    event SuperAdminChanged(address superAdmin, address newSuperAdmin);

    event AdminChanged(address admin, address newAdmin);

    event DataWarehouseChanged(address dataWarehouse, address newDataWarehouse);

    event PrimaryMarketPlatformFeeSplitBasisPointsChanged(uint splitBasisPoints, uint newSplitBasisPoints);

    event SecondaryMarketPlatformFeeSplitBasisPointsChanged(uint splitBasisPoints, uint newSplitBasisPoints);

    event PlatformFeeRecipientChanged(address platformFeeRecipient, address newPlatformFeeRecipient);

    event NFTTraded(address indexed seller, address indexed buyer, address indexed nftTokenAddress, uint nftTokenID, uint nftAmount, address paymentTokenAddress, uint paymentTokenAmount, uint tdropMined);

    event CalculateTDropMined(uint alpha, uint priceInTFuelWei, uint highestSellingPriceInTFuelWei, uint gamma, uint omega, uint blockHeight, uint lastTradeBlockHeight, uint epsilon, uint maxRewardPerTrade);

    event MinedTDrop(address indexed recipient, uint tdropMined);

    constructor (uint chainId, address[] memory registryAddrs, bytes memory customPersonalSignPrefix,
                 address superAdmin_, address admin_, address payable platformFeeRecipient_, address tdropToken_) {
        DOMAIN_SEPARATOR = hash(EIP712Domain({
            name              : name,
            version           : version,
            chainId           : chainId,
            verifyingContract : address(this)
        }));
        for (uint ind = 0; ind < registryAddrs.length; ind++) {
          registries[registryAddrs[ind]] = true;
        }
        if (customPersonalSignPrefix.length > 0) {
          personalSignPrefix = customPersonalSignPrefix;
        }
        
        superAdmin = superAdmin_;
        emit SuperAdminChanged(address(0), superAdmin);
        admin = admin_;
        emit AdminChanged(address(0), admin);
        platformFeeRecipient = platformFeeRecipient_;
        emit PlatformFeeRecipientChanged(address(0), platformFeeRecipient);
        tdropToken = ITDropToken(tdropToken_);
        paused = false;
        miningOnlyForWhitelistedNFTs = true;
        liquidityMiningEnabled = false;
    }

    function setSuperAdmin(address superAdmin_) onlySuperAdmin external {
        emit SuperAdminChanged(superAdmin, superAdmin_);
        superAdmin = superAdmin_;
    }

    function setAdmin(address admin_) onlySuperAdmin external {
        emit AdminChanged(admin, admin_);
        admin = admin_;
    }

    function setDataWarehouse(address dataWarehouse_) onlyAdmin external {
        emit DataWarehouseChanged(address(dataWarehouse), dataWarehouse_);
        dataWarehouse = IDataWarehouse(dataWarehouse_);
    }

    function setPrimaryMarketPlatformFeeSplitBasisPoints(uint splitBasisPoints_) onlyAdmin external {
        emit PrimaryMarketPlatformFeeSplitBasisPointsChanged(primaryMarketPlatformFeeSplitBasisPoints, splitBasisPoints_);
        primaryMarketPlatformFeeSplitBasisPoints = splitBasisPoints_;
    }

    function setSecondaryMarketPlatformFeeSplitBasisPoints(uint splitBasisPoints_) onlyAdmin external {
        emit SecondaryMarketPlatformFeeSplitBasisPointsChanged(secondaryMarketPlatformFeeSplitBasisPoints, splitBasisPoints_);
        secondaryMarketPlatformFeeSplitBasisPoints = splitBasisPoints_;
    }

    function setPlatformFeeRecipient(address payable platformFeeRecipient_) onlyAdmin external {
        emit PlatformFeeRecipientChanged(platformFeeRecipient, platformFeeRecipient_);
        platformFeeRecipient = platformFeeRecipient_;
    }

    function enableNFTLiqudityMining(bool enabled) onlyAdmin external {
        liquidityMiningEnabled = enabled;
    }

    function enableLiqudityMiningOnlyForWhitelistedNFTs(bool whitelistedOnly) onlyAdmin external {
        miningOnlyForWhitelistedNFTs = whitelistedOnly;
    }
        
    function getLiquidityMiningParamEpsilon() external view returns (uint) {
        return lmp.epsilon;
    }

    function getLiquidityMiningParamAlpha() external view returns (uint) {
        return lmp.alpha;
    }

    function getLiquidityMiningParamGamma() external view returns (uint) {
        return lmp.gamma;
    }

    function getLiquidityMiningParamOmega() external view returns (uint) {
        return lmp.omega;
    }

    function getLiquidityMiningParamMaxRewardPerTrade() external view returns (uint) {
        return lmp.maxRewardPerTrade;
    }

    function updateLiquidityMiningParamEpsilon(uint epsilon) onlyAdmin external {
        lmp.epsilon = epsilon;
    }

    function updateLiquidityMiningParamAlpha(uint alpha) onlyAdmin external {
        lmp.alpha = alpha;
    }

    function updateLiquidityMiningParamGamma(uint gamma) onlyAdmin external {
        lmp.gamma = gamma;
    }

    function updateLiquidityMiningParamOmega(uint omega) onlyAdmin external {
        lmp.omega = omega;
    }

    function updateLiquidityMiningParamMaxRewardPerTrade(uint maxRewardPerTrade) onlyAdmin external {
        lmp.maxRewardPerTrade = maxRewardPerTrade;
    }

    function updateLiquidityMiningParams(uint epsilon, uint alpha, uint gamma, uint omega, uint maxRewardPerTrade) onlyAdmin external {
        lmp.epsilon = epsilon;
        lmp.alpha = alpha;
        lmp.gamma = gamma;
        lmp.omega = omega;
        lmp.maxRewardPerTrade = maxRewardPerTrade;
    }

    function pause() onlyAdmin external {
        paused = true;
    }

    function unpause() onlyAdmin external {
        paused = false;
    }

    // Assume the first order is initiated by the NFT seller, and the second order is initiated by the buyer (with either TFuel or TNT20 tokens)
    function tradeNFT(uint[16] memory uints, bytes4[2] memory staticSelectors,
        bytes memory firstExtradata, bytes memory firstCalldata, bytes memory secondExtradata, bytes memory secondCalldata,
        uint8[2] memory howToCalls, bytes32 metadata, bytes memory signatures)
        onlyWhenUnpaused
        public
        payable
    {
        return _tradeNFT(
            Order(address(uints[0]), address(uints[1]), address(uints[2]), staticSelectors[0], firstExtradata, uints[3], uints[4], uints[5], uints[6]),
            Call(address(uints[7]), AuthenticatedProxy.HowToCall(howToCalls[0]), firstCalldata),
            Order(address(uints[8]), address(uints[9]), address(uints[10]), staticSelectors[1], secondExtradata, uints[11], uints[12], uints[13], uints[14]),
            Call(address(uints[15]), AuthenticatedProxy.HowToCall(howToCalls[1]), secondCalldata),
            signatures,
            metadata
        );
    }

    function _tradeNFT(Order memory firstOrder, Call memory firstCall, Order memory secondOrder, Call memory secondCall, bytes memory signatures, bytes32 metadata) internal {
        _sanityChecks(firstOrder, firstCall, secondOrder, secondCall, metadata);

        NFTTradeMetadata memory tm = _extractNFTTradeMetadata(firstOrder, firstCall, secondOrder, secondCall);

        uint tdropMined;
        tdropMined = _performNFTLiquidityMining(tm);
        tm.tdropMined = tdropMined;
        
        atomicMatch(
            firstOrder,
            firstCall,
            secondOrder,
            secondCall,
            signatures,
            metadata
        );

        _updateNFTTradeBlockHeight(tm.nftTokenAddress, tm.nftTokenID);

        emit NFTTraded(tm.seller, tm.buyer, tm.nftTokenAddress, tm.nftTokenID, tm.nftAmount, tm.paymentTokenAddress, tm.paymentTokenAmount, tm.tdropMined);
    }

    function _sanityChecks(Order memory firstOrder, Call memory firstCall, Order memory secondOrder, Call memory secondCall, bytes32 metadata) internal returns (bool) {        
        // check if the orders and calls are well-formed
        require(firstOrder.staticExtradata.length == 128, "firstCalldata is malformed");
        require(secondOrder.staticExtradata.length == 128, "secondCalldata is malformed");
        require(metadata == bytes32(0), "metadata should be empty");

        // sell side
        uint    sellingPrice = _getPaymentTokenAmount(firstOrder);
        address nftToken     = _getNFTTokenAddress(firstCall);
        uint    nftTokenID   = _getNFTTokenID(firstOrder);

        // buy side
        address paymentToken    = _getPaymentTokenAddress(secondCall);
        uint    buyingPrice     = _getPaymentTokenAmount(secondOrder);
        uint    nftTokenIDPrime = _getNFTTokenID(secondOrder);

        // TODO: support TNT1155, check the nftAmount
        require(sellingPrice == buyingPrice, "selling and buying mismatch");
        require(nftTokenID == nftTokenIDPrime, "nft tokenID mismatch");

        if (paymentToken == address(0)) { // if paid with TFuel
            require(msg.value == buyingPrice, "invalid amount of TFuel for the purchase");
        } else {
            require(dataWarehouse.isAWhitelistedPaymentToken(paymentToken), "not a whitelisted payment token"); 
        }
        
        return true;
    }

    // Please refer to Section 6 in the TDrop Whitepaper for the details of the NFT Liquidity Mining mechanism
    // https://s3.us-east-2.amazonaws.com/assets.thetatoken.org/Theta-Ecosystem-2022-and-TDROP-Whitepaper.pdf
    function _performNFTLiquidityMining(NFTTradeMetadata memory tm) internal returns (uint tdropMined) {
        if (!liquidityMiningEnabled) {
            return 0; // do nothing
        }

        uint priceInTFuelWei = msg.value;
        if (priceInTFuelWei == 0) {
            return 0; // only purchasing with TFuel can earn TDrop through NFT Liquidity mining
        }

        if (miningOnlyForWhitelistedNFTs) {
            if (!(dataWarehouse.isAWhitelistedTNT721NFTToken(tm.nftTokenAddress) || dataWarehouse.isAWhitelistedTNT1155NFTToken(tm.nftTokenAddress))) {
                return 0;
            }
        }

        // TODO: Support TNT-1155
        uint highestSellingPriceInTFuelWei = dataWarehouse.getHighestSellingPriceInTFuelWei(tm.nftTokenAddress, tm.nftTokenID);
        if (priceInTFuelWei > highestSellingPriceInTFuelWei) {
            uint lastTradeBlockHeight = dataWarehouse.getLastNFTTradeBlockHeight(tm.nftTokenAddress, tm.nftTokenID);
            uint blockHeight = block.number;

            uint normalizedPriceIncrease = SafeMath.div(SafeMath.sub(priceInTFuelWei, highestSellingPriceInTFuelWei), SafeMath.add(lmp.gamma, 1));
            uint blockGap = SafeMath.sub(blockHeight, lastTradeBlockHeight);

            // NOTE: We know that log2(normalizedPriceIncrease+1) <= 256, and practically blockGap < 10^10. Thus, if omega < 10^8 and alpha < 10^30,
            //       alpha * log2(normalizedPriceIncrease+1) * omega * blockGap should be at most 2.56 * 10^50 < MAX(uint256) = 1.1579 * 10^77. 
            //       Hence, the multiplications below should never overflow. On the other hand, if alpha = 10^26, then the max representable
            //       tdropMined can be as large as 10^26 * 256 * 10^8 * 10^10 / (10^8 * 10^10 + 1000000) = 2.56 * 10^28 > 20 * 10^9 * 10^18 = maxTDropTokenSupplyInWei.
            //       Therefore, by setting proper parameters alpha and omega, the follow calculation allows us to produce any "tdropMined" value
            //       within range [0, maxTDropTokenSupplyInWei].
            tdropMined = SafeMath.mul(lmp.alpha, ExtMath.log2(SafeMath.add(normalizedPriceIncrease, 1)));
            tdropMined = SafeMath.mul(tdropMined, lmp.omega);
            tdropMined = SafeMath.mul(tdropMined, blockGap);
            tdropMined = SafeMath.div(tdropMined, SafeMath.add(SafeMath.mul(lmp.omega, blockGap), 1000000)); // We use constant 1000000 instead of 1 (as in the whitepaper) for better precision control
            tdropMined = SafeMath.add(tdropMined, lmp.epsilon);
            if (tdropMined > lmp.maxRewardPerTrade) {
                tdropMined = lmp.maxRewardPerTrade;
            }

            dataWarehouse.updateHighestSellingPriceInTFuelWei(tm.nftTokenAddress, tm.nftTokenID, priceInTFuelWei);

            emit CalculateTDropMined(lmp.alpha, priceInTFuelWei, highestSellingPriceInTFuelWei, lmp.gamma, lmp.omega, blockHeight, lastTradeBlockHeight, lmp.epsilon, lmp.maxRewardPerTrade);
        } else {
            tdropMined = lmp.epsilon;
        }

        tdropToken.mine(tm.buyer, tdropMined);
        emit MinedTDrop(tm.buyer, tdropMined);

        return tdropMined;
    }

    function _chargePlatformFee(Order memory firstOrder, Call memory firstCall, Order memory secondOrder, Call memory secondCall)
        internal virtual override returns (uint sellerValue) {
        address nftTokenAddress   = _getNFTTokenAddress(firstCall);
        uint    nftTokenID        = _getNFTTokenID(firstOrder);
        bool isAPrimaryMarketSale = _isAPrimaryMarketSale(nftTokenAddress, nftTokenID);

        uint platformFeeSplitBasisPoints = secondaryMarketPlatformFeeSplitBasisPoints;
        if (isAPrimaryMarketSale) {
            platformFeeSplitBasisPoints = primaryMarketPlatformFeeSplitBasisPoints;
        }

        if (platformFeeSplitBasisPoints == 0) {
            return msg.value; // do nonthing
        }

        address tnt20PaymentTokenAddr = _getPaymentTokenAddress(secondCall);

        if (tnt20PaymentTokenAddr == address(0)) { // paid with TFuel            
            if (msg.value == 0) {
                return 0;
            }

            uint platformFeeInTFuel = SafeMath.div(SafeMath.mul(msg.value, platformFeeSplitBasisPoints), 10000);
            sellerValue = SafeMath.sub(msg.value, platformFeeInTFuel);
            if (platformFeeInTFuel > 0) {
                platformFeeRecipient.transfer(platformFeeInTFuel);
            }

            return sellerValue;

        } else { // paid with TNT20 tokens
            require(msg.value == 0, "msg.value should be zero if the trade is paid in TFuel");

            // extract the payment token amount
            uint price = _getPaymentTokenAmount(secondOrder);
            if (price == 0) {
                return 0;
            }

            address buyerAddr = secondOrder.maker;
            address sellerAddr = firstOrder.maker;
            uint platformFeeInTNT20 = SafeMath.div(SafeMath.mul(price, platformFeeSplitBasisPoints), 10000);
            ERC20 paymentToken = ERC20(tnt20PaymentTokenAddr);
            require(paymentToken.transferFrom(buyerAddr, platformFeeRecipient, platformFeeInTNT20), "TNT20 payment token transfer failed");

            // adjust the orders and calls since the amount of payment token to be sent to the seller has been deducted
            _adjustOrdersAndCalls(firstOrder, firstCall, secondOrder, secondCall, buyerAddr, sellerAddr, price, platformFeeInTNT20);

            return 0;
        }

        return 0;
    }

    function _adjustOrdersAndCalls(Order memory firstOrder, Call memory firstCall, Order memory secondOrder, Call memory secondCall,
        address buyerAddr, address sellerAddr, uint price, uint platformFeeInTNT20) internal {
        uint adjustedPrice = SafeMath.sub(price, platformFeeInTNT20);
            
        (address[2] memory firstTokenAddrPair, uint[2] memory firstTokenIDAndPrice) = abi.decode(firstOrder.staticExtradata, (address[2], uint[2]));
        firstTokenIDAndPrice[1] = adjustedPrice;
        firstOrder.staticExtradata = abi.encode(firstTokenAddrPair, firstTokenIDAndPrice);

        (address[2] memory secondTokenAddrPair, uint[2] memory secondTokenIDAndPrice) = abi.decode(secondOrder.staticExtradata, (address[2], uint[2]));
        secondTokenIDAndPrice[1] = adjustedPrice;
        secondOrder.staticExtradata = abi.encode(secondTokenAddrPair, secondTokenIDAndPrice);

        secondCall.data = abi.encodeWithSignature("transferFrom(address,address,uint256)", buyerAddr, sellerAddr, adjustedPrice);
    }

    function _updateNFTTradeBlockHeight(address nftTokenAddress, uint nftTokenID) internal {
        dataWarehouse.updateNFTTradeBlockHeight(nftTokenAddress, nftTokenID);
    }

    function _getPaymentTokenAddress(Call memory call) internal pure returns (address) {
        return call.target;
    }

    function _getPaymentTokenAmount(Order memory order) internal pure returns (uint) {
        uint amount = abi.decode(ArrayUtils.arraySlice(order.staticExtradata, 96, 32),(uint));
        return amount;
    }

    function _getNFTTokenAddress(Call memory call) internal pure returns (address) {
        return call.target;
    }

    function _getNFTTokenID(Order memory order) internal pure returns (uint) {
        uint tokenID = abi.decode(ArrayUtils.arraySlice(order.staticExtradata, 64, 32),(uint));
        return tokenID;
    }

    function _extractNFTTradeMetadata(Order memory firstOrder, Call memory firstCall, Order memory secondOrder, Call memory secondCall) 
        internal pure returns (NFTTradeMetadata memory) {
        // sell side
        address nftToken   = _getNFTTokenAddress(firstCall);
        uint    nftTokenID = _getNFTTokenID(firstOrder);

        // buy side
        address paymentToken = _getPaymentTokenAddress(secondCall);
        uint    buyingPrice  = _getPaymentTokenAmount(secondOrder);

        NFTTradeMetadata memory tm;
        tm.seller = firstOrder.maker;
        tm.buyer = secondOrder.maker;
        tm.nftTokenAddress = nftToken;
        tm.nftTokenID = nftTokenID;
        tm.nftAmount = 1; // TODO: support TNT1155
        tm.paymentTokenAddress = paymentToken;
        tm.paymentTokenAmount = buyingPrice;

        return tm;
    }

    function _isAPrimaryMarketSale(address nftTokenAddress, uint nftTokenID) internal returns (bool) {
        uint lastTradeBlockHeight = dataWarehouse.getLastNFTTradeBlockHeight(nftTokenAddress, nftTokenID);
        bool isAPrimaryMarketSale = (lastTradeBlockHeight == 0);
        return isAPrimaryMarketSale;
    }

    modifier onlySuperAdmin {
        require(msg.sender == superAdmin, "only the super admin can perform this action");
        _; 
    }

    modifier onlyAdmin {
        require(msg.sender == admin, "only the admin can perform this action");
        _; 
    }

    modifier onlyWhenUnpaused {
        require(!paused, "marketplace is paused");
        _;
    }

}
