pragma abicoder v2;
pragma solidity 0.7.5;

import "./lib/ArrayUtils.sol";
import "./exchange/Exchange.sol";

/**
 * @title ThetaDropMarketplace
 * @author ThetaDrop Marketplace Protocol Developers
 */
contract ThetaDropMarketplace is Exchange {

    using SafeMath for uint;

    string public constant name = "TDrop Marketplace";
  
    string public constant version = "1.0.0";

    /// @notice The super admin address
    address public superAdmin;

    /// @notice The admin address
    address public admin;

    /// @notice The platform fee split in basis points
    uint public platformFeeSplitBasisPoints;

    /// @notice The recipient of the platform fee
    address payable public platformFeeRecipient;

    /// @notice If NFT liquidity mining is enabled
    bool public nftLiquidityMiningEnabled;

    /// @notice the address of TDrop data warehouse
    address public dataWarehouse;

    /// @notice if the marketplace is paused
    bool public paused;
    
    event SuperAdminChanged(address superAdmin, address newSuperAdmin);

    event AdminChanged(address admin, address newAdmin);

    event DataWarehouseChanged(address dataWarehouse, address newDataWarehouse);

    event PlatformFeeSplitBasisPointsChanged(uint platformFeeSplitBasisPoints, uint newPlatformFeeSplitBasisPoints);

    event PlatformFeeRecipientChanged(address platformFeeRecipient, address newPlatformFeeRecipient);

    event EnableNFTLiqudityMining(bool enabled);

    function setSuperAdmin(address superAdmin_) onlySuperAdmin external {
        emit SuperAdminChanged(superAdmin, superAdmin_);
        superAdmin = superAdmin_;
    }

    function setAdmin(address admin_) onlySuperAdmin external {
        emit AdminChanged(admin, admin_);
        admin = admin_;
    }

    function setDataWarehouse(address dataWarehouse_) onlyAdmin external {
        emit DataWarehouseChanged(dataWarehouse, dataWarehouse_);
        dataWarehouse = dataWarehouse_;
    }

    function setPlatformFeeSplitBasisPoints(uint platformFeeSplitBasisPoints_) onlyAdmin external {
        emit PlatformFeeSplitBasisPointsChanged(platformFeeSplitBasisPoints, platformFeeSplitBasisPoints_);
        platformFeeSplitBasisPoints = platformFeeSplitBasisPoints_;
    }

    function setPlatformFeeRecipient(address payable platformFeeRecipient_) onlyAdmin external {
        emit PlatformFeeRecipientChanged(platformFeeRecipient, platformFeeRecipient_);
        platformFeeRecipient = platformFeeRecipient_;
    }

    function enableNFTLiqudityMining(bool enabled) onlyAdmin external {
        emit EnableNFTLiqudityMining(enabled);
        nftLiquidityMiningEnabled = enabled;
    }

    constructor (uint chainId, address[] memory registryAddrs, bytes memory customPersonalSignPrefix,
                 address superAdmin_, address admin_, address payable platformFeeRecipient_) {
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
        paused = false;
    }

    function pause() onlyAdmin external {
        paused = true;
    }

    function unpause() onlyAdmin external {
        paused = false;
    }

    // Assume the first order is initiated by the NFT seller, and the second order is initiated by the buyer (with either TFuel or TNT20 tokens)
    function transactNFT(uint[16] memory uints, bytes4[2] memory staticSelectors,
        bytes memory firstExtradata, bytes memory firstCalldata, bytes memory secondExtradata, bytes memory secondCalldata,
        uint8[2] memory howToCalls, bytes32 metadata, bytes memory signatures)
        onlyWhenUnpaused
        public
        payable
    {
        return _transactNFT(
            Order(address(uints[0]), address(uints[1]), address(uints[2]), staticSelectors[0], firstExtradata, uints[3], uints[4], uints[5], uints[6]),
            Call(address(uints[7]), AuthenticatedProxy.HowToCall(howToCalls[0]), firstCalldata),
            Order(address(uints[8]), address(uints[9]), address(uints[10]), staticSelectors[1], secondExtradata, uints[11], uints[12], uints[13], uints[14]),
            Call(address(uints[15]), AuthenticatedProxy.HowToCall(howToCalls[1]), secondCalldata),
            signatures,
            metadata
        );
    }

    function _transactNFT(Order memory firstOrder, Call memory firstCall, Order memory secondOrder, Call memory secondCall, bytes memory signatures, bytes32 metadata) internal {
        
        require(_sanityChecks(firstCall.data, secondCall.data), "sanity checks failed");
        
        require(_performNFTLiquidityMining(), "failed to perform NFT liquidity mining");
        
        uint adjustedValue;
        bytes memory adjustedSecondCalldata;
        bool chargeSuccess;
        address buyerAddr = secondOrder.maker;
        (adjustedValue, adjustedSecondCalldata, chargeSuccess) = _chargePlatformFee(buyerAddr, secondCall.data);
        require(chargeSuccess, "failed to charge platform fee");
        secondCall.data = adjustedSecondCalldata;
        
        return atomicMatch(
            firstOrder,
            firstCall,
            secondOrder,
            secondCall,
            signatures,
            metadata,
            adjustedValue
        );
    }


    function _sanityChecks(bytes memory firstCalldata, bytes memory secondCalldata) internal returns (bool) {
        // check if the TNT20 payment token is whitelisted

        // check if the call data are well-formed

        return false;
    }

    function _performNFTLiquidityMining() internal returns (bool) {
        if (!nftLiquidityMiningEnabled) {
            return true; // do nothing
        }

        if (msg.value == 0) {
            return true; // only transacting through TFuel can earn TDrop through NFT Liquidity mining
        }

        return false;
    }

    function _chargePlatformFee(address buyerAddr, bytes memory secondCalldata) internal returns (uint adjustedValue, bytes memory adjustedSecondCalldata, bool chargeSuccess) {   
        if (platformFeeSplitBasisPoints == 0) {
            return (msg.value, secondCalldata, true); // do nonthing
        }

        // -------------------------- Charge TFuel ------------------------- //

        if (msg.value > 0) {
            uint platformFeeInTFuel = SafeMath.div(SafeMath.mul(msg.value, platformFeeSplitBasisPoints), 10000);
            adjustedValue = SafeMath.sub(msg.value, platformFeeInTFuel);
            if (platformFeeInTFuel > 0) {
                platformFeeRecipient.transfer(platformFeeInTFuel);
            }
        }

        // ------------------- Charge payment TNT20 token ------------------- //

        // extract the payment token amount
        address tnt20Addr = _getTNT20AddressFromCalldata(secondCalldata);
        uint tnt20Amount = _getTNT20AmountFromCalldata(secondCalldata);

        if (tnt20Amount > 0) {
            uint platformFeeInTNT20 = SafeMath.div(SafeMath.mul(tnt20Amount, platformFeeSplitBasisPoints), 10000);

            ERC20 token = ERC20(tnt20Addr);
            require(token.transferFrom(buyerAddr, platformFeeRecipient, platformFeeInTNT20), "ERC20 token transfer failed");
        }

        // ------------------- Adjust the second call data ------------------- //
        // TODO..
        bytes memory adjustedSecondCalldata = secondCalldata;

        return (adjustedValue, adjustedSecondCalldata, false);
    }

    function _getTNT20AmountFromCalldata(bytes memory callData) internal pure returns (uint) {
            uint amount = abi.decode(ArrayUtils.arraySlice(callData,68,32),(uint));
            return amount;
    }

    function _getTNT20AddressFromCalldata(bytes memory callData) internal pure returns (address) {
            address tnt20Address = abi.decode(ArrayUtils.arraySlice(callData,28, 20),(address));
            return tnt20Address;
    }

    function _getTNT721TokenIDFromCalldata(bytes memory callData) internal pure returns (uint) {

    }

    function _getTNT721AddressFromCalldata(bytes memory callData) internal pure returns (address) {

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
