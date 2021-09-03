pragma abicoder v2;
pragma solidity 0.7.5;

/**
 * @title ThetaDropDataWarehouse
 * @author ThetaDrop Marketplace Protocol Developers
 * The ThetaDropDataWarehouse stores critical data from the marketplace, including
 * the NFT sales record, the whitelisted tokens, etc. By decoupling the data warehouse
 * from the marketplace, we allow potentially protocol upgrades which change the marketplace
 * implementation while retaining essential data store in the warehouse
 */
contract ThetaDropDataWarehouse {
    
    /// @notice The super admin address
    address public superAdmin;

    /// @notice The admin address
    address public admin;

    /// @notice the marketplace address
    address public marketplace;
    
    /// @notice map[NFTAddress][TokenID] => Highest sale price in TFuelWei
    /// for TNT721, it represents the highest historical transaction value of the NFT token with the specified tokenID
    /// for TNT1155, it represents the highest historical transaction value of a single (i.e. value = 1) NFT token with the specified tokenID
    mapping(address => mapping(uint => uint)) public highestSellingPriceInTFuelWei;

    /// @notice map[NFTAddress][TokenID] => NFTTradeBlockHeight
    mapping(address => mapping(uint => uint)) public tradeBlockHeightMap;

    /// @notice whitelisted TNT20 payment tokens (i.e. stablecoins)
    mapping(address => bool) public whitelistedTNT20PaymentTokenMap;

    /// @notice whitelisted TNT721 NFT tokens for liquidity mining
    mapping(address => bool) public whitelistedTNT721NFTTokenMap;

    /// @notice whitelisted TNT1155 NFT tokens for liquidity mining
    mapping(address => bool) public whitelistedTNT1155NFTTokenMap;

    /// @notice An event thats emitted when the super admin address is changed
    event SuperAdminChanged(address superAdmin, address newSuperAdmin);

    /// @notice An event thats emitted when the admin address is changed
    event AdminChanged(address admin, address newAdmin);

    /**
     * @notice Construct a new TDrop token
     * @param superAdmin_ The account with super admin permission
     * @param admin_ The account with admin permission
     */
    constructor(address superAdmin_, address admin_) public {
        superAdmin = superAdmin_;
        emit SuperAdminChanged(address(0), superAdmin);
        admin = admin_;
        emit AdminChanged(address(0), admin);
    }
    
    /**
     * @notice Change the admin address
     * @param superAdmin_ The address of the new super admin
     */
    function setSuperAdmin(address superAdmin_) onlySuperAdmin external {
        emit SuperAdminChanged(superAdmin, superAdmin_);
        superAdmin = superAdmin_;
    }

    /**
     * @notice Change the admin address
     * @param admin_ The address of the new admin
     */
    function setAdmin(address admin_) onlySuperAdmin external {
        emit AdminChanged(admin, admin_);
        admin = admin_;
    }

    /**
     * @notice Change the marketplace address
     * @param marketplace_ The address of the new marketplace
     */
    function setMarketplace(address marketplace_) onlyAdmin external {
        marketplace = marketplace_;
    }

    function getHighestSellingPriceInTFuelWei(address nftAddr, uint tokenID) public view returns (uint) {
        return highestSellingPriceInTFuelWei[nftAddr][tokenID];
    }

    function updateHighestSellingPriceInTFuelWei(address nftAddr, uint tokenID, uint newHigestPrice) onlyMarketplace public {
        uint currHighestPrice = getHighestSellingPriceInTFuelWei(nftAddr, tokenID);
        require(newHigestPrice > currHighestPrice, "the new highest price needs to be strictly higher than the current higest");
        highestSellingPriceInTFuelWei[nftAddr][tokenID] = newHigestPrice;
    }

    function updateNFTTradeBlockHeight(address nftAddr, uint tokenID) onlyMarketplace public {
        tradeBlockHeightMap[nftAddr][tokenID] = block.number;
    }

    function getLastNFTTradeBlockHeight(address nftAddr, uint tokenID) public view returns (uint) {
        return tradeBlockHeightMap[nftAddr][tokenID];
    }

    function isAWhitelistedPaymentToken(address tokenAddr) public view returns (bool) {
        return whitelistedTNT20PaymentTokenMap[tokenAddr];
    }

    function whitelistPaymentToken(address tokenAddr, bool isWhitelisted) onlyAdmin public {
        whitelistedTNT20PaymentTokenMap[tokenAddr] = isWhitelisted;
    }

    function isAWhitelistedTNT721NFTToken(address tokenAddr) public view returns (bool) {
        return whitelistedTNT721NFTTokenMap[tokenAddr];
    }

    function whitelistTNT721NFTToken(address tokenAddr, bool isWhitelisted) onlyAdmin public {
        whitelistedTNT721NFTTokenMap[tokenAddr] = isWhitelisted;
    }

    function isAWhitelistedTNT1155NFTToken(address tokenAddr) public view returns (bool) {
        return whitelistedTNT1155NFTTokenMap[tokenAddr];
    }

    function whitelistTNT1155NFTToken(address tokenAddr, bool isWhitelisted) onlyAdmin public {
        whitelistedTNT1155NFTTokenMap[tokenAddr] = isWhitelisted;
    }

    modifier onlySuperAdmin { 
        require(msg.sender == superAdmin, "only the super admin can perform this action");
        _; 
    }

    modifier onlyAdmin { 
        require(msg.sender == admin, "only the admin can perform this action");
        _; 
    }

    modifier onlyMarketplace { 
        require(msg.sender == marketplace, "only the marketplace can perform this action");
        _; 
    }
}