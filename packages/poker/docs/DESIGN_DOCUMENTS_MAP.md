# Poker Design Documents Map

**Status:** Current  
**Last Major Update:** 2026-07-15 (adversarial next-wave plan S1–S10)  
**Purpose:** Single source of truth index for all design, architecture, requirements, and planning documents related to the Texas Hold'em poker module (including mental-poker cryptography and on-chain settlement).

**Scope:** Focuses on current design (post `packages/poker/` extraction and PRD_CONTRACTS.md). Historical documents are clearly marked.

**How to use this map:**
- Start here for any poker design question.
- "Current" documents reflect the implemented design (PokerHandSettler + BettingConfigOracle + mental poker in `CryptoPokerGame`).
- Always prefer documents with recent dates and "Current" status.
- Cross-reference with code in `packages/poker/src/`, `contracts/`, and `packages/manamesh/packages/frontend/`.

---

## Current / Active Design Documents

| Document | Location | Type | Status | Key Topics | Related |
|----------|----------|------|--------|------------|---------|
| **Design Documents Map** (this file) | `packages/poker/docs/DESIGN_DOCUMENTS_MAP.md` | Index | Current | Overview of all docs, navigation | All |
| **Poker Deployment Readiness PRD** | `packages/poker/docs/PRD_Deployment.md` | PRD | Current | What remains to make poker deployable; integration, deployment, auth, E2E | TASK.md, PREPAREDNESS_REPORT.md, PRD_CONTRACTS.md |
| **Poker Deployment Task Breakdown** | `packages/poker/docs/TASK.md` | Task spec | Current | Detailed phased tasks, user stories, files to change, acceptance criteria | PRD_Deployment.md |
| **Poker Deployment Preparedness Report** | `packages/poker/docs/PREPAREDNESS_REPORT.md` | Assessment | Current | Current state (tests, features, gaps), readiness % (~75%), completed vs pending | All current docs |
| **Mental Poker Game Workflow & Security** | `packages/poker/docs/GAME_FLOW_AND_SECURITY.md` | Technical spec | Current | P2P connection, SRA phases (key exchange/encrypt/shuffle), cooperative decryption, betting integration, security model (`client: false`, etc.) | crypto.ts, betting.ts, PokerBoard.tsx |
| **Poker Hand Settlement Smart Contracts PRD** | `packages/manamesh/PRD_CONTRACTS.md` | Locked PRD | Current (design) | Purpose, HandInit/HandOutcome structs, contract interface (assert/settle/force-timeout), EIP-712, oracle, invariants, §11 locked decisions | contracts/, handOutcome.ts, signing.ts, PokerHandSettlerDFPkg |
| **Adversarial Tests** | `packages/poker/docs/ADVERSARIAL_TESTS.md` | Security test map | Current | Threat IDs A1–A14 / C1–C4 / M1–M11 → automated tests; residual risks | `tests/foundry/adversarial/`, `src/crypto.adversarial.test.ts`, `src/mentalPoker.*` |
| **Adversarial Test Implementation Plan** | `docs/superpowers/plans/2026-07-15-poker-adversarial-tests.md` | Plan | Phase 1 complete | Settlement adversarial suite A1–A14 / C1–C4 | ADVERSARIAL_TESTS.md |
| **Mental Poker Adversarial Plan** | `docs/superpowers/plans/2026-07-15-mental-poker-adversarial-suite.md` | Plan | Phase 1 complete | Workflow + privacy M1–M12, G1–G7, R1–R6 | ADVERSARIAL_TESTS.md (M-threats) |
| **Adversarial Next Wave Plan (S1–S10)** | `docs/superpowers/plans/2026-07-15-poker-adversarial-next-wave.md` | Plan | **Complete** | Multi-street settle, peels, concurrent decrypt, multi-winner, force-timeout N≥3, oracle mid-hand, eval parity, fee-token residual, BlockchainService, key-exchange | ADVERSARIAL_TESTS.md |
| **Poker Betting Architecture (historical)** | `packages/poker/docs/historical/POKER_BETTING_ARCHITECTURE.md` | Architecture | Historical | Why off-chain betting + on-chain settlement (old GameVault version) | See current PRD_CONTRACTS.md and docs/TASK.md |

---

## High-Level / Platform Documents (Poker Sections)

| Document | Location | Type | Status | Poker Relevance | Notes |
|----------|----------|------|--------|-----------------|-------|
| **ManaMesh Architecture** | `packages/manamesh/docs/ARCHITECTURE.md` | Architecture | Current (with notes) | Game module system, crypto primitives, blockchain integration, smart contracts overview | Points to `packages/poker/` for details; updated 2026-06 |
| **Project Status** | `packages/manamesh/PROJECT_STATUS.md` | Status report | Current (with notes) | Poker completeness, gaps (R1/R2 etc.), test health | Updated 2026-06 with pointers to poker module docs |
| **Implementation Plan: Poker Hand Settler** | `packages/manamesh/docs/superpowers/plans/2026-05-19-poker-hand-settler.md` | Detailed plan | Historical (but useful) | Exact steps to build contracts per PRD | References the locked PRD; largely executed |

---

## Historical / Superseded Documents

| Document | Location | Type | Status | Why Historical | Recommended Action |
|----------|----------|------|--------|----------------|--------------------|
| Poker Betting Architecture (original) | `packages/poker/docs/historical/POKER_BETTING_ARCHITECTURE.md` | Architecture | Historical | Describes old `GameVault.sol` / `ChipToken` / deltas / `settleHands()` model | Superseded by current design in PRD_CONTRACTS.md |
| Old task files (MM-031, MM-035, MM-043 etc.) | `packages/manamesh/tasks/archive/` | Tasks | Historical | Pre-poker-package extraction | Reference for history only |
| Various mentions in PLAN.md, older PRDs | `packages/manamesh/PLAN.md`, etc. | Plans | Mixed | Reference pre-current design | Cross-check against current poker docs |

**Legacy contract artifacts** (no longer active design):
- Old `GameVault.sol`, `ChipToken*`, `SignatureVerifier` — removed from active `manamesh/contracts/`. References appear only in historical plans and caches.

---

## Code & Implementation as "Living Design"

- **Game Logic & Crypto Flow**: `packages/poker/src/{crypto.ts, betting.ts, hands.ts, game.ts, types.ts}`
- **On-chain Settlement Helpers**: `packages/poker/src/{handId.ts, signing.ts, handOutcome.ts}`
- **Contracts**: `packages/poker/contracts/{settler/, oracle/, verifier/, types/, lib/}`
- **Deployment**: `packages/poker/script/`
- **Frontend Integration**: `packages/manamesh/packages/frontend/src/App.tsx`, `blockchain/`, wallet signing
- **Tests** (validate design): `packages/poker/src/*.test.ts`, `tests/foundry/`

These often contain more up-to-date details than prose docs (e.g., exact structs, EIP-712 types, accounting logic).

---

## Recommended Reading Order (for New Contributors)

1. `packages/poker/docs/DESIGN_DOCUMENTS_MAP.md` (this)
2. `packages/poker/docs/GAME_FLOW_AND_SECURITY.md` — understand the mental poker game flow
3. `packages/manamesh/PRD_CONTRACTS.md` — understand the settlement contract design
4. `packages/poker/docs/PREPAREDNESS_REPORT.md` — where we are today
5. `packages/poker/docs/PRD_Deployment.md` + `docs/TASK.md` — what still needs doing for deployment
6. Dive into code + tests

---

## Reorganization Applied (2026-06)

The following changes have been applied per the suggestions:
- All active poker design docs consolidated under `packages/poker/docs/`
- `GAME_FLOW_AND_SECURITY.md` moved from `src/`
- `POKER_BETTING_ARCHITECTURE.md` moved to `docs/historical/`
- Cross-references and pointers updated in READMEs, ARCHITECTURE.md, PROJECT_STATUS.md, PRD_CONTRACTS.md, and this map.

## Suggestions for Future Maintenance

1. Keep all poker design under `packages/poker/docs/`
2. Use `historical/` for superseded docs
3. Update high-level manamesh/docs/ to point here
4. Maintain consistent front-matter with Status, Date, Related links
5. When changing contracts or game flow, update this map + primary docs

**Consistent front-matter example:**
```
     **Status:** Current / Historical / Draft
     **Last Major Update:** YYYY-MM-DD
     **Supersedes:** ...
     **See also:** list of 2-4 related docs
     ```

6. **Other cleanups**
   - Periodically grep for old terms (`GameVault`, `settleHands`, legacy deltas) outside `historical/` and `archive/`
   - Add `docs/` to the poker package README table of contents
   - Consider a root-level `DESIGN/` folder only if more games need similar treatment

Following the above would make the new `DESIGN_DOCUMENTS_MAP.md` even more powerful and reduce future maintenance burden.

---

*This map was created to centralize knowledge after the 2026-06 cross-check and documentation alignment work.*