// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice EIP-712 signature helpers used by the poker settler.
/// @dev Domain separator is computed by the consuming contract; this library
///      only does digest building + recovery.
library SignatureLib {
    /// @custom:signature InvalidSignature(uint256,address)
    error InvalidSignature(uint256 index, address expected);
    /// @custom:signature LengthMismatch(uint256,uint256)
    error LengthMismatch(uint256 a, uint256 b);
    /// @custom:signature MalformedSignature(uint256)
    error MalformedSignature(uint256 length);

    function recoverEIP712(
        bytes32 domainSeparator,
        bytes32 structHash,
        bytes memory signature
    ) internal pure returns (address) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        return _recover(digest, signature);
    }

    function requireSignedByAll(
        bytes32 domainSeparator,
        bytes32 structHash,
        address[] memory signers,
        bytes[] memory sigs
    ) internal pure {
        if (signers.length != sigs.length) revert LengthMismatch(signers.length, sigs.length);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        for (uint256 i = 0; i < signers.length; ++i) {
            address recovered = _recover(digest, sigs[i]);
            if (recovered != signers[i]) revert InvalidSignature(i, signers[i]);
        }
    }

    function _recover(bytes32 digest, bytes memory sig) private pure returns (address) {
        if (sig.length != 65) revert MalformedSignature(sig.length);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return ecrecover(digest, v, r, s);
    }
}
