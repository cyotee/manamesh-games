// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {PokerHandEvaluator} from "../../../contracts/verifier/PokerHandEvaluator.sol";

/// @title PokerHandEvaluator_parity — S7 TS ↔ Solidity hand-eval parity
/// @notice Consumes the same packed 7-card vectors as
///         `test-vectors/hand-eval-parity.json` (loaded via `vm.readFile`) and
///         `src/hands.parity.test.ts`.
///
/// ## Packing convention (must match TS `encodeCard` / `SUIT_VALUES`)
///
/// ```
/// uint8 card = (rank << 4) | suit
/// ```
///
/// | Field | Range | Meaning |
/// |-------|-------|---------|
/// | rank  | 2..14 | 14 = Ace (high) |
/// | suit  | 0..3  | 0=clubs, 1=diamonds, 2=hearts, 3=spades |
///
/// TS side: `handOutcome.encodeCard`, `types.RANK_VALUES` / `SUIT_VALUES`.
/// Solidity side: this file's `_c` and `PokerHandEvaluator.evaluate`.
///
/// `expected`: "A_wins" | "B_wins" | "tie" — relative score order only
/// (absolute score bits need not match TS `HandRank` enums; royal flush is
/// category 8 A-high SF on-chain vs HandRank 9 off-chain).
contract PokerHandEvaluatorParityTest is Test {
    using stdJson for string;

    string private constant VECTOR_REL = "/test-vectors/hand-eval-parity.json";

    function _c(uint8 rank, uint8 suit) internal pure returns (uint8) {
        return uint8((rank << 4) | suit);
    }

    function _seven(uint256[] memory packed) internal pure returns (uint8[7] memory cards) {
        require(packed.length == 7, "need 7 cards");
        for (uint256 i = 0; i < 7; ++i) {
            require(packed[i] <= type(uint8).max, "card > uint8");
            cards[i] = uint8(packed[i]);
        }
    }

    function _loadJson() internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), VECTOR_REL));
    }

    function _assertExpected(uint256 scoreA, uint256 scoreB, string memory expected, string memory id)
        internal
        pure
    {
        bytes32 exp = keccak256(bytes(expected));
        if (exp == keccak256("A_wins")) {
            assertGt(scoreA, scoreB, id);
        } else if (exp == keccak256("B_wins")) {
            assertLt(scoreA, scoreB, id);
        } else if (exp == keccak256("tie")) {
            assertEq(scoreA, scoreB, id);
        } else {
            revert(string.concat("unknown expected: ", expected, " @ ", id));
        }
    }

    /// @notice Drive every vector from the shared JSON file.
    function test_parity_allVectorsFromJson() public view {
        string memory json = _loadJson();
        // forge-std: length of array via parse raw; we use a known count from keys.
        // Walk indices until handA parse fails.
        for (uint256 i = 0; i < 64; ++i) {
            string memory base = string.concat(".vectors[", vm.toString(i), "]");
            // Detect end of array: missing id reverts on parseJsonString.
            try this.readId(json, string.concat(base, ".id")) returns (string memory id) {
                uint256[] memory handA = json.readUintArray(string.concat(base, ".handA"));
                uint256[] memory handB = json.readUintArray(string.concat(base, ".handB"));
                string memory expected = json.readString(string.concat(base, ".expected"));

                uint256 scoreA = PokerHandEvaluator.evaluate(_seven(handA));
                uint256 scoreB = PokerHandEvaluator.evaluate(_seven(handB));
                _assertExpected(scoreA, scoreB, expected, id);
            } catch {
                // First missing index ends the loop; require we ran the known suite.
                assertGe(i, 10, "expected at least 10 parity vectors");
                break;
            }
        }
    }

    /// @dev External wrapper so try/catch can trap parse failures for end-of-array.
    function readId(string memory json, string memory key) external pure returns (string memory) {
        return json.readString(key);
    }

    // -------------------------------------------------------------------------
    // Hard-coded mirrors of the JSON (pure; fail loudly if JSON diverges)
    // -------------------------------------------------------------------------

    function test_parity_royal_vs_junk() public pure {
        uint8[7] memory a = [
            _c(14, 3),
            _c(13, 3),
            _c(12, 3),
            _c(11, 3),
            _c(10, 3),
            _c(2, 0),
            _c(3, 1)
        ];
        uint8[7] memory b = [_c(14, 0), _c(12, 1), _c(10, 2), _c(8, 3), _c(6, 0), _c(4, 1), _c(2, 2)];
        assertGt(PokerHandEvaluator.evaluate(a), PokerHandEvaluator.evaluate(b));
    }

    function test_parity_wheel_vs_broadway() public pure {
        uint8[7] memory wheel =
            [_c(14, 0), _c(2, 1), _c(3, 2), _c(4, 3), _c(5, 0), _c(8, 1), _c(10, 2)];
        uint8[7] memory broadway =
            [_c(10, 0), _c(11, 1), _c(12, 2), _c(13, 3), _c(14, 1), _c(2, 2), _c(3, 0)];
        assertLt(PokerHandEvaluator.evaluate(wheel), PokerHandEvaluator.evaluate(broadway));
    }

    function test_parity_three_pair_collapse() public pure {
        uint8[7] memory threePairs =
            [_c(13, 0), _c(13, 1), _c(12, 2), _c(12, 3), _c(11, 0), _c(11, 1), _c(2, 2)];
        uint8[7] memory twoPairLow =
            [_c(13, 0), _c(13, 1), _c(12, 2), _c(12, 3), _c(4, 0), _c(3, 1), _c(2, 2)];
        assertGt(PokerHandEvaluator.evaluate(threePairs), PokerHandEvaluator.evaluate(twoPairLow));
    }

    function test_parity_identical_tie() public pure {
        uint8[7] memory a = [_c(14, 0), _c(14, 1), _c(13, 2), _c(13, 3), _c(9, 0), _c(5, 1), _c(2, 2)];
        uint8[7] memory b = [_c(14, 2), _c(14, 3), _c(13, 0), _c(13, 1), _c(9, 2), _c(5, 3), _c(2, 0)];
        assertEq(PokerHandEvaluator.evaluate(a), PokerHandEvaluator.evaluate(b));
    }

    function test_parity_pair_ace_kicker_vs_pair_king_kicker() public pure {
        uint8[7] memory aceK =
            [_c(5, 0), _c(5, 1), _c(14, 2), _c(13, 3), _c(12, 0), _c(3, 1), _c(2, 2)];
        uint8[7] memory kingK =
            [_c(5, 0), _c(5, 1), _c(13, 2), _c(12, 3), _c(11, 0), _c(3, 1), _c(2, 2)];
        assertGt(PokerHandEvaluator.evaluate(aceK), PokerHandEvaluator.evaluate(kingK));
    }

    function test_parity_quads_fh_flush_order() public pure {
        uint8[7] memory quads =
            [_c(9, 0), _c(9, 1), _c(9, 2), _c(9, 3), _c(2, 0), _c(3, 1), _c(4, 2)];
        uint8[7] memory fh =
            [_c(13, 0), _c(13, 1), _c(13, 2), _c(12, 0), _c(12, 1), _c(2, 0), _c(3, 1)];
        uint8[7] memory flush =
            [_c(14, 2), _c(10, 2), _c(7, 2), _c(5, 2), _c(3, 2), _c(2, 0), _c(4, 1)];
        uint256 sQuads = PokerHandEvaluator.evaluate(quads);
        uint256 sFh = PokerHandEvaluator.evaluate(fh);
        uint256 sFlush = PokerHandEvaluator.evaluate(flush);
        assertGt(sQuads, sFh);
        assertGt(sFh, sFlush);
        assertGt(sQuads, sFlush);
    }

    /// @notice Spot-check that hard-coded packed bytes match JSON for royal_vs_junk.
    function test_parity_jsonMatchesHardcodedRoyal() public view {
        string memory json = _loadJson();
        uint256[] memory handA = json.readUintArray(".vectors[0].handA");
        uint256[] memory handB = json.readUintArray(".vectors[0].handB");
        string memory expected = json.readString(".vectors[0].expected");
        string memory id = json.readString(".vectors[0].id");

        assertEq(id, "royal_vs_junk");
        assertEq(expected, "A_wins");

        uint8[7] memory hardA = [
            _c(14, 3),
            _c(13, 3),
            _c(12, 3),
            _c(11, 3),
            _c(10, 3),
            _c(2, 0),
            _c(3, 1)
        ];
        for (uint256 i = 0; i < 7; ++i) {
            assertEq(handA[i], hardA[i], "handA diverged from JSON");
        }
        uint8[7] memory hardB = [_c(14, 0), _c(12, 1), _c(10, 2), _c(8, 3), _c(6, 0), _c(4, 1), _c(2, 2)];
        for (uint256 i = 0; i < 7; ++i) {
            assertEq(handB[i], hardB[i], "handB diverged from JSON");
        }
    }
}
