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
 * @title ReentrantERC20
 * @notice Compliant ERC20 that reenters the poker settler on transfer / transferFrom.
 * @dev The token contract itself is the vault player for reentrancy tests so that
 *      nested settler calls share `msg.sender == address(this)` with the outer call.
 *      Token balances are honest; the attack surface is nested settler entrypoints.
 */
contract ReentrantERC20 is ERC20 {
    enum Attack {
        None,
        Withdraw,
        Deposit,
        Assert,
        Settle
    }

    IPokerHandSettler public settler;
    Attack public attack;
    uint256 public reenterAmount;

    HandInit internal _init;
    bytes[] internal _initSigs;
    HandOutcome internal _outcome;
    bytes[] internal _winnerSigs;
    bool internal _hasInit;
    bool internal _hasOutcome;

    bool private _inHook;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configure(IPokerHandSettler settler_, Attack attack_, uint256 reenterAmount_) external {
        settler = settler_;
        attack = attack_;
        reenterAmount = reenterAmount_;
    }

    function setAssertPayload(HandInit memory init, bytes[] memory sigs) external {
        _init = init;
        delete _initSigs;
        for (uint256 i = 0; i < sigs.length; ++i) {
            _initSigs.push(sigs[i]);
        }
        _hasInit = true;
    }

    function setSettlePayload(HandInit memory init, HandOutcome memory outcome, bytes[] memory wsigs) external {
        _init = init;
        _outcome = outcome;
        delete _winnerSigs;
        for (uint256 i = 0; i < wsigs.length; ++i) {
            _winnerSigs.push(wsigs[i]);
        }
        _hasInit = true;
        _hasOutcome = true;
    }

    /// @dev Self-deposit so vault owner is this contract (reentry shares msg.sender).
    function selfDeposit(uint256 amount) external {
        _approve(address(this), address(settler), type(uint256).max);
        settler.deposit(amount);
    }

    function selfWithdraw(uint256 amount) external {
        settler.withdraw(amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        _tryReenter();
        return ok;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool ok = super.transferFrom(from, to, amount);
        _tryReenter();
        return ok;
    }

    function _tryReenter() private {
        if (_inHook || attack == Attack.None || address(settler) == address(0)) return;
        _inHook = true;

        if (attack == Attack.Withdraw) {
            try settler.withdraw(reenterAmount) {} catch {}
        } else if (attack == Attack.Deposit) {
            try settler.deposit(reenterAmount) {} catch {}
        } else if (attack == Attack.Assert && _hasInit) {
            try settler.assertHandMembership(_init, _initSigs) {} catch {}
        } else if (attack == Attack.Settle && _hasOutcome) {
            try settler.settleHand(_init, _outcome, _winnerSigs) {} catch {}
        }

        _inHook = false;
    }
}

/**
 * @title PokerHandSettler_ReentrancyTest
 * @notice A13: malicious ERC20 reentrancy against deposit / withdraw / assert / settle.
 *
 * CEI properties under test:
 * - **withdraw**: checks + effects (debit free balance) before `safeTransfer`.
 *   A reentrant `withdraw` from the same vault owner during the transfer cannot
 *   double-spend free balance already debited by the outer call.
 * - **deposit**: interaction (`safeTransferFrom`) then effect (credit vault). Nested
 *   deposits that succeed pull additional tokens and credit once per pull — ledger
 *   stays matched to token balance (no free mint of vault credit).
 * - **assertHandMembership / settleHand**: no ERC20 interaction; reachable only via
 *   deposit/withdraw hooks. Reentry must not break conservation or yield free profit.
 */
contract PokerHandSettler_ReentrancyTest is AdversarialHelpers {
    ReentrantERC20 internal evil;
    address internal evilPlayer;

    function setUp() public override {
        CraneTest.setUp();

        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        assertTrue(bob < alice, "fixture assumes bob < alice by address");

        evil = new ReentrantERC20("EvilChip", "EVIL");
        evilPlayer = address(evil);

        address[] memory tokens = new address[](1);
        tokens[0] = address(evil);

        address[] memory settlers;
        (oracleProxy, settlers) = PokerDeployLib.deploySystem(create3Factory, diamondFactory, address(this), tokens);
        settlerProxy = settlers[0];

        IBettingConfigOracle(oracleProxy).setDefault(operator, RAKE_BPS);

        evil.configure(IPokerHandSettler(settlerProxy), ReentrantERC20.Attack.None, 0);

        // Fund EOAs for assert/settle paths and the evil contract as a vault player.
        _fundEvilTo(alice, 1_000e18);
        _fundEvilTo(bob, 1_000e18);
        _fundEvilSelf(1_000e18);
    }

    function _fundEvilTo(address who, uint256 amount) internal {
        evil.mint(who, amount);
        vm.startPrank(who);
        evil.approve(settlerProxy, type(uint256).max);
        evil.configure(IPokerHandSettler(settlerProxy), ReentrantERC20.Attack.None, 0);
        IPokerHandSettler(settlerProxy).deposit(amount);
        vm.stopPrank();
    }

    function _fundEvilSelf(uint256 amount) internal {
        evil.mint(evilPlayer, amount);
        evil.configure(IPokerHandSettler(settlerProxy), ReentrantERC20.Attack.None, 0);
        evil.selfDeposit(amount);
    }

    function _sumKnownVaults() internal view returns (uint256 sum) {
        sum = IPokerHandSettler(settlerProxy).balanceOf(alice)
            + IPokerHandSettler(settlerProxy).balanceOf(bob)
            + IPokerHandSettler(settlerProxy).balanceOf(operator)
            + IPokerHandSettler(settlerProxy).balanceOf(evilPlayer)
            + IPokerHandSettler(settlerProxy).balanceOf(attacker);
    }

    function _assertLedgerIntactEvil() internal view {
        assertEq(evil.balanceOf(settlerProxy), _sumKnownVaults(), "ledger != token (evil)");
    }

    function _evilVault() internal view returns (uint256) {
        return IPokerHandSettler(settlerProxy).balanceOf(evilPlayer);
    }

    /// A13a: reentrant withdraw during outer withdraw cannot double-spend free balance.
    function test_A13_reentrantWithdraw_noDoubleSpend() public {
        uint256 vaultBefore = _evilVault();
        uint256 walletBefore = evil.balanceOf(evilPlayer);
        _assertLedgerIntactEvil();

        evil.configure(IPokerHandSettler(settlerProxy), ReentrantERC20.Attack.Withdraw, vaultBefore);
        evil.selfWithdraw(vaultBefore);

        // CEI: outer debit first → nested withdraw fails → single payout to evilPlayer.
        assertEq(_evilVault(), 0, "vault should be empty");
        assertEq(evil.balanceOf(evilPlayer), walletBefore + vaultBefore, "token credit once");
        _assertLedgerIntactEvil();
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(evilPlayer), 0);
    }

    /// A13b: reentrant deposit during outer deposit only credits for tokens actually pulled.
    function test_A13_reentrantDeposit_noFreeCredit() public {
        evil.mint(evilPlayer, 200e18);
        evil.configure(IPokerHandSettler(settlerProxy), ReentrantERC20.Attack.None, 0);

        uint256 vaultBefore = _evilVault();
        uint256 settlerTokenBefore = evil.balanceOf(settlerProxy);
        _assertLedgerIntactEvil();

        // Outer + nested deposit 100 each (honest second transferFrom from self).
        evil.configure(IPokerHandSettler(settlerProxy), ReentrantERC20.Attack.Deposit, 100e18);
        evil.selfDeposit(100e18);

        assertEq(_evilVault(), vaultBefore + 200e18, "double credit only for double pull");
        assertEq(evil.balanceOf(settlerProxy), settlerTokenBefore + 200e18);
        _assertLedgerIntactEvil();
    }

    /// A13c: withdraw hook reenters assertHandMembership — no free profit; ledger intact.
    function test_A13_reentrantAssertDuringWithdraw_stateConsistent() public {
        HandInit memory init = _twoPlayerInit();
        bytes[] memory sigs = _signInit(init);

        evil.configure(IPokerHandSettler(settlerProxy), ReentrantERC20.Attack.Assert, 0);
        evil.setAssertPayload(init, sigs);

        uint256 evilVaultBefore = _evilVault();
        uint256 aliceBefore = IPokerHandSettler(settlerProxy).balanceOf(alice);
        uint256 bobBefore = IPokerHandSettler(settlerProxy).balanceOf(bob);

        evil.selfWithdraw(100e18);

        assertEq(evil.balanceOf(evilPlayer), 100e18);
        assertEq(_evilVault(), evilVaultBefore - 100e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), aliceBefore, "alice vault");
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(bob), bobBefore, "bob vault");
        // Nested assert may lock alice/bob buy-ins; locks ≤ balances.
        assertLe(IPokerHandSettler(settlerProxy).lockedOf(alice), aliceBefore);
        assertLe(IPokerHandSettler(settlerProxy).lockedOf(bob), bobBefore);
        _assertLedgerIntactEvil();
    }

    /// A13d: after honest settle, withdraw hook reenters settleHand — no double settle.
    function test_A13_reentrantSettleDuringWithdraw_noDoubleSettle() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        // Move alice winnings into evil vault path: re-fund evil and withdraw as evil
        // while reentering settle with the already-settled hand.
        uint256 bobBefore = IPokerHandSettler(settlerProxy).balanceOf(bob);
        uint256 opBefore = IPokerHandSettler(settlerProxy).balanceOf(operator);
        uint256 aliceBefore = IPokerHandSettler(settlerProxy).balanceOf(alice);

        evil.configure(IPokerHandSettler(settlerProxy), ReentrantERC20.Attack.Settle, 0);
        evil.setSettlePayload(init, o, wsigs);

        uint256 free = _evilVault();
        evil.selfWithdraw(free);

        // Settled balances for alice/bob/operator unchanged by evil withdraw + nested settle.
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), aliceBefore);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(bob), bobBefore);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), opBefore);
        assertEq(_evilVault(), 0);
        _assertLedgerIntactEvil();
    }

    /// A13e: deposit hook tries withdraw mid-outer-deposit — conservation holds.
    function test_A13_reentrantWithdrawDuringDeposit_ledgerIntact() public {
        evil.mint(evilPlayer, 100e18);

        uint256 vaultBefore = _evilVault();
        uint256 walletBefore = evil.balanceOf(evilPlayer);

        // Outer deposit 100; during transferFrom, reenter withdraw(100) against prior free bal.
        evil.configure(IPokerHandSettler(settlerProxy), ReentrantERC20.Attack.Withdraw, 100e18);
        evil.selfDeposit(100e18);

        uint256 vaultAfter = _evilVault();
        uint256 walletAfter = evil.balanceOf(evilPlayer);
        assertEq(
            int256(vaultAfter) - int256(vaultBefore) + (int256(walletAfter) - int256(walletBefore)),
            0,
            "evil player net chip conservation"
        );
        _assertLedgerIntactEvil();
    }
}
