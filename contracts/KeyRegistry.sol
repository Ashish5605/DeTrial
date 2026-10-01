// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract KeyRegistry is Ownable2Step {
    struct SignerKey {
        address signer;
        uint64 validFrom;
        uint64 validUntil;
        uint64 revokedAt;
    }

    struct ServiceConfig {
        uint64 responseWindowSeconds;
        bool deemedApprovalEnabled;
        bytes32 statuteRefHash;
        address appellateAuthority;
    }

    // institutionId => signer address => SignerKey struct
    mapping(bytes32 => mapping(address => SignerKey)) public signers;

    // institutionId => serviceId => ServiceConfig
    mapping(bytes32 => mapping(bytes32 => ServiceConfig)) public serviceConfigs;

    // institutionId => default appellate authority fallback
    mapping(bytes32 => address) public defaultAppellateAuthorities;

    event SignerRegistered(bytes32 indexed institutionId, address indexed signer, uint64 validFrom, uint64 validUntil);
    event SignerRevoked(bytes32 indexed institutionId, address indexed signer, uint64 revokedAt);
    event ServiceConfigUpdated(bytes32 indexed institutionId, bytes32 indexed serviceId, address appellateAuthority);

    error InvalidTimeWindow();
    error SignerAlreadyExists();
    error SignerNotFound();
    error KeyNotValid();
    error ZeroAddressNotAllowed();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerSigner(
        bytes32 institutionId,
        address signer,
        uint64 validFrom,
        uint64 validUntil
    ) external onlyOwner {
        if (signer == address(0)) revert ZeroAddressNotAllowed();
        if (validFrom >= validUntil) revert InvalidTimeWindow();
        if (signers[institutionId][signer].validUntil != 0) revert SignerAlreadyExists();

        signers[institutionId][signer] = SignerKey({
            signer: signer,
            validFrom: validFrom,
            validUntil: validUntil,
            revokedAt: 0
        });

        emit SignerRegistered(institutionId, signer, validFrom, validUntil);
    }

    function revokeSigner(bytes32 institutionId, address signer) external onlyOwner {
        SignerKey storage keyInfo = signers[institutionId][signer];
        if (keyInfo.signer == address(0)) revert SignerNotFound();
        if (keyInfo.revokedAt != 0) revert KeyNotValid();

        keyInfo.revokedAt = uint64(block.timestamp);
        emit SignerRevoked(institutionId, signer, keyInfo.revokedAt);
    }

    function setServiceConfig(
        bytes32 institutionId,
        bytes32 serviceId,
        uint64 responseWindowSeconds,
        bool deemedApprovalEnabled,
        bytes32 statuteRefHash,
        address appellateAuthority
    ) external onlyOwner {
        if (appellateAuthority == address(0)) revert ZeroAddressNotAllowed();

        serviceConfigs[institutionId][serviceId] = ServiceConfig({
            responseWindowSeconds: responseWindowSeconds,
            deemedApprovalEnabled: deemedApprovalEnabled,
            statuteRefHash: statuteRefHash,
            appellateAuthority: appellateAuthority
        });

        emit ServiceConfigUpdated(institutionId, serviceId, appellateAuthority);
    }

    function isKeyValidAt(
        bytes32 institutionId,
        address signer,
        uint64 timestamp
    ) external view returns (bool) {
        SignerKey memory keyInfo = signers[institutionId][signer];
        if (keyInfo.signer == address(0)) return false;
        if (timestamp < keyInfo.validFrom) return false;
        if (timestamp > keyInfo.validUntil) return false;
        if (keyInfo.revokedAt != 0 && timestamp >= keyInfo.revokedAt) return false;
        return true;
    }
}
