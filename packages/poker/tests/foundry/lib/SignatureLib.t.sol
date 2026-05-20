// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {SignatureLib} from "../../../contracts/lib/SignatureLib.sol";

/// @notice External wrapper around SignatureLib so `vm.expectRevert` sees the
///         revert at a deeper call depth than the cheatcode. Internal-library
///         calls are inlined into the test contract and therefore revert at
///         the same depth as the cheatcode, which Foundry 1.5.x rejects unless
///         `allow_internal_expect_revert` is enabled in foundry.toml.
contract SignatureLibHarness {
    function requireSignedByAll(
        bytes32 domainSeparator,
        bytes32 structHash,
        address[] memory signers,
        bytes[] memory sigs
    ) external pure {
        SignatureLib.requireSignedByAll(domainSeparator, structHash, signers, sigs);
    }
}

contract SignatureLibTest is Test {
    SignatureLibHarness internal harness;

    function setUp() public {
        harness = new SignatureLibHarness();
    }

    bytes32 constant DOMAIN_SEPARATOR = keccak256("test-domain");

    function _digest(bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_recoverSigner() public {
        (address signer, uint256 pk) = makeAddrAndKey("signer");
        bytes32 structHash = keccak256("struct");
        bytes memory sig = _sign(pk, _digest(structHash));
        address recovered = SignatureLib.recoverEIP712(DOMAIN_SEPARATOR, structHash, sig);
        assertEq(recovered, signer);
    }

    function test_requireSignedByAll_passesWhenAllSign() public {
        bytes32 structHash = keccak256("struct");
        bytes32 digest = _digest(structHash);
        (address a, uint256 pkA) = makeAddrAndKey("a");
        (address b, uint256 pkB) = makeAddrAndKey("b");
        address[] memory signers = new address[](2);
        signers[0] = a;
        signers[1] = b;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(pkA, digest);
        sigs[1] = _sign(pkB, digest);
        harness.requireSignedByAll(DOMAIN_SEPARATOR, structHash, signers, sigs);
    }

    function test_requireSignedByAll_revertsOnWrongSigner() public {
        bytes32 structHash = keccak256("struct");
        bytes32 digest = _digest(structHash);
        (address a, uint256 pkA) = makeAddrAndKey("a");
        (address b,) = makeAddrAndKey("b");
        address[] memory signers = new address[](2);
        signers[0] = a;
        signers[1] = b;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(pkA, digest);
        sigs[1] = sigs[0]; // signed by A not B
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 1, b));
        harness.requireSignedByAll(DOMAIN_SEPARATOR, structHash, signers, sigs);
    }
}
