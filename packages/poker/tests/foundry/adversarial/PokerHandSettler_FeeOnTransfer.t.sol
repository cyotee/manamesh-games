// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CraneTest} from "@crane/contracts/test/CraneTest.sol";

import {AdversarialHelpers} from "./AdversarialHelpers.sol";
import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {PokerDeployLib} from "../../../script/PokerDeployLib.sol";

/**
 * @title FeeOnTransferERC20
 * @notice Test-only ERC20 that skims 1% of every transfer / transferFrom to the fee sink.
 * @dev Recipient receives amount - fee; total supply is conserved (fee held by sink).
 */
contract FeeOnTransferERC20 is ERC20 {
    uint256 public constant FEE_BPS = 100; // 1%
    address public immutable feeSink;

    constructor(string memory name_, string memory symbol_, address feeSink_) ERC20(name_, symbol_) {
        feeSink = feeSink_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || from == feeSink || to == feeSink) {
            // mint / burn / fee accounting: no second skim
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * FEE_BPS) / 10_000;
        uint256 send = value - fee;
        if (fee > 0) {
            super._update(from, feeSink, fee);
        }
        super._update(from, to, send);
    }
}

/**
 * @title PokerHandSettler_FeeOnTransferTest
 * @notice S8: fee-on-transfer token vs vault ledger.
 *
 * ## Product limitation (documented residual — no silent production fix)
 * `PokerHandSettlerTarget.deposit` does:
 *   `safeTransferFrom(msg.sender, this, amount)` then `balanceOf[msg.sender] += amount`.
 * It does **not** measure `balanceOf(this)` delta. With a 1% fee-on-transfer token the
 * vault ledger is credited the **requested** amount while the contract holds **less**
 * ERC20 — `sum(ledgers) > token.balanceOf(settler)`. Withdraw can then brick when the
 * last users try to exit (or earlier if free balances exceed holdings).
 *
 * **Decision locked by these tests:** fee-on-transfer / rebasing ERC20s are an
 * **unsupported token class**. Tests prove the broken invariant (known residual) against
 * the current diamond; baseline ERC20Mock remains 1:1. Do not treat FoT as production-
 * ready without a product change (e.g. credit actual received amount).
 */
contract PokerHandSettler_FeeOnTransferTest is AdversarialHelpers {
    FeeOnTransferERC20 internal fot;
    address internal feeSink = makeAddr("feeSink");

    function setUp() public override {
        CraneTest.setUp();

        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        assertTrue(bob < alice, "fixture assumes bob < alice by address");

        fot = new FeeOnTransferERC20("FeeChip", "FOT", feeSink);

        address[] memory tokens = new address[](1);
        tokens[0] = address(fot);

        address[] memory settlers;
        (oracleProxy, settlers) = PokerDeployLib.deploySystem(create3Factory, diamondFactory, address(this), tokens);
        settlerProxy = settlers[0];

        IBettingConfigOracle(oracleProxy).setDefault(operator, RAKE_BPS);
        // `chip` left unset; FoT path uses `fot`. Helpers that touch `chip` are not used here.
    }

    function _fundFot(address who, uint256 amount) internal {
        fot.mint(who, amount);
        vm.startPrank(who);
        fot.approve(settlerProxy, type(uint256).max);
        IPokerHandSettler(settlerProxy).deposit(amount);
        vm.stopPrank();
    }

    function _receivedAfterFee(uint256 amount) internal pure returns (uint256) {
        return amount - (amount * 100) / 10_000;
    }

    /// S8.1: Deposit credits full `amount` while settler holds less token (ledger drift).
    function test_S8_deposit_ledgerExceedsTokenBalance_knownResidual() public {
        uint256 amount = 1_000e18;
        fot.mint(alice, amount);
        vm.startPrank(alice);
        fot.approve(settlerProxy, type(uint256).max);

        uint256 settlerBefore = fot.balanceOf(settlerProxy);
        IPokerHandSettler(settlerProxy).deposit(amount);
        vm.stopPrank();

        uint256 vault = IPokerHandSettler(settlerProxy).balanceOf(alice);
        uint256 tokenHeld = fot.balanceOf(settlerProxy);
        uint256 expectedReceived = _receivedAfterFee(amount);

        // Actual broken behavior: full credit, short token balance.
        assertEq(vault, amount, "ledger credits requested amount");
        assertEq(tokenHeld, settlerBefore + expectedReceived, "token after 1% fee");
        assertLt(tokenHeld, vault, "KNOWN RESIDUAL: token < ledger after FoT deposit");
        assertEq(fot.balanceOf(feeSink), amount - expectedReceived, "fee skimmed");
    }

    /// S8.2: Two deposits deepen drift; sum(ledgers) != token holdings.
    function test_S8_twoDeposits_sumLedgersExceedsToken() public {
        _fundFot(alice, 1_000e18);
        _fundFot(bob, 1_000e18);

        uint256 ledgerSum = IPokerHandSettler(settlerProxy).balanceOf(alice)
            + IPokerHandSettler(settlerProxy).balanceOf(bob)
            + IPokerHandSettler(settlerProxy).balanceOf(operator);
        uint256 tokenHeld = fot.balanceOf(settlerProxy);

        assertEq(ledgerSum, 2_000e18, "full credits");
        assertEq(tokenHeld, 2 * _receivedAfterFee(1_000e18), "99% each");
        assertTrue(ledgerSum > tokenHeld, "KNOWN RESIDUAL: ledger drift");
    }

    /// S8.3: Withdraw of full ledger fails or underpays relative to ledger once FoT applied on exit.
    function test_S8_withdraw_feeOnExit_andOrInsolvency() public {
        _fundFot(alice, 1_000e18);
        // Settler holds 990e18; ledger says 1000e18.
        uint256 vault = IPokerHandSettler(settlerProxy).balanceOf(alice);
        assertEq(vault, 1_000e18);
        assertEq(fot.balanceOf(settlerProxy), 990e18);

        // Partial withdraw within token holdings: CEI debits ledger full amount, then
        // transfer skims 1% so alice receives less than debited.
        uint256 withdrawAmt = 100e18;
        uint256 aliceWalletBefore = fot.balanceOf(alice);
        uint256 vaultBefore = vault;

        vm.prank(alice);
        IPokerHandSettler(settlerProxy).withdraw(withdrawAmt);

        // Ledger reduced by full withdrawAmt (unsafe vs FoT).
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), vaultBefore - withdrawAmt);
        // Alice wallet gains 99e18 (1% fee on transfer out).
        assertEq(fot.balanceOf(alice), aliceWalletBefore + _receivedAfterFee(withdrawAmt));

        // Remaining ledger 900e18 but settler holds 990 - 100 = 890e18 (fee left settler).
        // transfer(900e18) would try to move 900 from settler; only 890 held → revert.
        vm.prank(alice);
        vm.expectRevert(); // ERC20 insufficient balance (or OZ custom error)
        IPokerHandSettler(settlerProxy).withdraw(900e18);
    }

    /// S8.4: Control — FoT fee math is explicit; standard ERC20Mock 1:1 is covered by A14/MultiPlayer.
    function test_S8_baselineFeeMath_andCrossLinkStandardToken() public view {
        // Honest ERC20Mock deposit path is proven ledger==token in MultiPlayer / Handler (A14).
        // Here lock the FoT skim identity used by residual asserts above.
        assertEq(fot.FEE_BPS(), 100, "fee bps");
        assertEq(_receivedAfterFee(1_000e18), 990e18);
        assertEq(_receivedAfterFee(100e18), 99e18);
    }

    /// S8.5: Settle under FoT still moves ledger only (no ERC20), drift persists.
    function test_S8_settle_doesNotRepairLedgerDrift() public {
        _fundFot(alice, 1_000e18);
        _fundFot(bob, 1_000e18);

        HandInit memory init = _twoPlayerInit();
        // vault must be this settler
        init.vault = settlerProxy;
        IPokerHandSettler(settlerProxy).assertHandMembership(init, _signInit(init));

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        uint256 ledgerSum = IPokerHandSettler(settlerProxy).balanceOf(alice)
            + IPokerHandSettler(settlerProxy).balanceOf(bob)
            + IPokerHandSettler(settlerProxy).balanceOf(operator);
        uint256 tokenHeld = fot.balanceOf(settlerProxy);
        assertEq(ledgerSum, 2_000e18, "settle preserves full ledger sum");
        assertEq(tokenHeld, 1_980e18, "token still short 20e18 total fees");
        assertTrue(ledgerSum > tokenHeld, "KNOWN RESIDUAL: settle does not heal FoT drift");
    }
}
