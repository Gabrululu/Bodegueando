# Bodegueando — Technical architecture

This document covers the full architecture: what exists, why each piece exists, deployed
addresses, tests, and how to run and deploy everything. For the product vision — what we built,
why Arbitrum, the problem it solves and its impact — see the [README](./README.md). For a
one-page summary with a diagram (English / Spanish), see
[gabrululu.github.io/Bodegueando](https://gabrululu.github.io/Bodegueando/) (`docs/index.html`,
served via GitHub Pages).

A few Spanish terms are kept throughout because they're the product's own vocabulary:
*bodega* (neighborhood corner store), *bodeguero* (shopkeeper), *fiado* (informal store credit —
"put it on my tab"), and PUNTOS (the cashback points token).

## Architecture

```
bodegueando/
├── contracts/
│   ├── solidity/                     # Foundry — PaymentRouter, PuntosToken and the rest of the Solidity contracts
│   ├── stylus-fiado-scoring/         # Arbitrum Stylus (Rust) — FiadoScoring
│   └── circom-credit-certificate/    # Circom/snarkjs — CreditCertificate ZK circuit
└── frontend/                         # Next.js + Tailwind + wagmi/viem
```

- **PaymentRouter.sol / PuntosToken.sol** (Solidity/Foundry): take a customer's payment to a
  bodega in USDG, grant cashback in `PUNTOS` (ERC-20), and record the payment in
  `FiadoScoring`. It also exposes `payFiado`, so a customer can pay back a fiado debt (no
  cashback, since it isn't a new purchase).
- **FiadoScoring** (Rust/Stylus): keeps a bounded buffer of each bodega's latest payments and
  computes a heuristic credit score/limit (moving average of payments, frequency, late-payment
  penalty) — the heavy computation that justifies Stylus over plain Solidity. It also exposes
  `updateScoreFromAi` so the frontend's AI module can adjust the score with an external
  recommendation, and a real per-customer debt ledger (`extendFiado`/`repayFiado`) — see "Fiado
  with a real debt ledger" below.
- **Frontend** (Next.js): connects to the contracts via wagmi/viem. The
  `app/api/fiado-score/route.ts` route reads a bodega's on-chain history, calls the Anthropic
  API (Claude) for a score/limit recommendation, and writes it back on-chain.

## Deployed contracts (Arbitrum Sepolia)

| Contract | Address | Arbiscan |
|---|---|---|
| **FiadoScoring** (Stylus/Rust) | `0x22FD7ED957b356dcF4a93574D24fC724736480B2` | [view / verified](https://sepolia.arbiscan.io/address/0x22FD7ED957b356dcF4a93574D24fC724736480B2) |
| **PuntosToken** | `0x2bd8AbEB2F5598f8477560C70c742aFfc22912de` | [view verified code](https://sepolia.arbiscan.io/address/0x2bd8AbEB2F5598f8477560C70c742aFfc22912de#code) |
| **PaymentRouter** (USDG) | `0x3E774Bb89AD93aAEE1ddd3d6cEeE609B712b655b` | [view verified code](https://sepolia.arbiscan.io/address/0x3E774Bb89AD93aAEE1ddd3d6cEeE609B712b655b#code) |
| **PuntosPaymaster** | `0x493D8B20f12E94cf513b9F078E41FFDF1E685B86` | [view verified code](https://sepolia.arbiscan.io/address/0x493D8B20f12E94cf513b9F078E41FFDF1E685B86#code) |
| **BeneficioToken** (social programs PoC) | `0x1ffbE40Ea1B050B1429cDE507a1A970e1AedF8Bc` | [view verified code](https://sepolia.arbiscan.io/address/0x1ffbE40Ea1B050B1429cDE507a1A970e1AedF8Bc#code) |
| **InvoiceEscrow** (fiado with partial collateral, USDG) | `0xa6CCbB44F50a8a494C621B1b5aE922ABef1A0c96` | [view verified code](https://sepolia.arbiscan.io/address/0xa6CCbB44F50a8a494C621B1b5aE922ABef1A0c96#code) |
| **RewardsCatalog** (rewards catalog) | `0x0c07b1b63aAbAD36d15877D80f10411534C44a2f` | [view verified code](https://sepolia.arbiscan.io/address/0x0c07b1b63aAbAD36d15877D80f10411534C44a2f#code) |
| **GroupOrders** (joint purchases between bodegas, USDG) | `0x5223dA615bB75E766841B01b949F5e5bB8869E5F` | [view verified code](https://sepolia.arbiscan.io/address/0x5223dA615bB75E766841B01b949F5e5bB8869E5F#code) |
| **CreditCertificate** | `0xc42547586FbEfCA3D8EA189B1e87a2c234f67828` | [view verified code](https://sepolia.arbiscan.io/address/0xc42547586FbEfCA3D8EA189B1e87a2c234f67828#code) |
| **Groth16Verifier** (ZK verifier, auto-generated) | `0x6a61e780f9a811eA28718146A9B2F720C19359fb` | [view verified code](https://sepolia.arbiscan.io/address/0x6a61e780f9a811eA28718146A9B2F720C19359fb#code) |
| **CreditLine** (USDG) | `0x08856a37d3F7F53e1bc4810e27eF7155255FcA11` | [view verified code](https://sepolia.arbiscan.io/address/0x08856a37d3F7F53e1bc4810e27eF7155255FcA11#code) |

> `PaymentRouter`, `PuntosPaymaster`, `InvoiceEscrow`, `GroupOrders` and `CreditLine` are the
> USDG versions, deployed on 2026-10-04 from block `315555074` with
> `script/deploy-usdg-stack.sh` (see "Deploying the USDG stack"). The other contracts are shared
> and wired to them: `FiadoScoring` points to the router and escrow, `PuntosToken`'s minter is the
> router, and `RewardsCatalog` reads the router's bodega registry. Earlier deployments are retired
> and hold no funds.

Every contract that needs to know who is a registered bodega (`InvoiceEscrow`,
`RewardsCatalog`, `GroupOrders`, `CreditLine`, `BeneficioToken`, `PuntosPaymaster`) references
`PaymentRouter` as an updatable address (`Ownable` + `setBodegaRegistry`, or
`setFiadoScoring`/`setEscrow` in `FiadoScoring`'s case) rather than `immutable` — the bodega
registry is solely `PaymentRouter`'s responsibility, and any contract that queries it can be
repointed to a new instance without losing its own logic or being redeployed itself.

`PuntosToken`, `PaymentRouter`, `PuntosPaymaster` and `BeneficioToken` are verified with
readable Solidity source on Arbiscan (`forge verify-contract`). `FiadoScoring` is verified with
`cargo stylus verify` — it doesn't show source code like Etherscan, but it proves the deployed
bytecode matches a reproducible build of `src/lib.rs` inside cargo-stylus's official Docker
container.

## End-to-end demo

Two separate views, not a single screen that shows or hides sections:

- **`BuyerPanel.tsx`** (buyer): look up a bodega by its code, see its available fiado if it
  turned it on (read-only) and pay it via `PaymentRouter.receivePayment`. It also shows the
  buyer's own code (so a bodega can extend them credit) and, if they owe fiado to the bodega
  they're looking at (`FiadoScoring.getFiadoDebt`), a button to pay it via
  `PaymentRouter.payFiado`.
- **`BodegaOwnerPanel.tsx`** (shopkeeper): their own code to share with customers, their
  balance, the fiado switch (`setFiadoEnabled`), a button to recalculate their fiado with AI
  (`/api/fiado-score`, shopkeeper-only) and a form to extend credit to a
  specific customer by their code (`FiadoScoring.extendFiado`), with the total outstanding debt
  and the remaining room to keep extending credit.

`app/app/page.tsx` detects the role after login by reading
`PaymentRouter.isBodega(smartAccountAddress)` — an account already registered as a bodega goes
straight to `BodegaOwnerPanel`; a new account explicitly picks "I'm a shopkeeper" / "I'm a
customer" (see "Shopkeeper and customer are two separate spaces" below for the full detail of
this separation).

**Fiado is opt-in per bodega, not automatic.** In real life a bodega doesn't always extend
credit — it's the owner's call ("no credit today, maybe tomorrow"). `fiado_enabled` in
`FiadoScoring` starts as `false` for every bodega and only the bodega itself can turn it on
(`setFiadoEnabled`, written by `msg.sender`, no separate allowlist — each one controls only its
own fiado). Payment history and score keep being calculated regardless — so a bodega already has
a track record the day it decides to turn it on. While it's off, the customer sees nothing about
fiado in the app and can only pay.

The AI route (`/api/fiado-score`, structured output) reads a bodega's on-chain history and calls
`updateScoreFromAi` to write back a score/limit recommendation — tested end-to-end against
Arbitrum Sepolia: Claude returned a more conservative recommendation than the heuristic ("*a
single payment isn't enough history*") and it was confirmed on-chain.

### Fiado with a real debt ledger: `extendFiado` / `repayFiado` / `payFiado`

`getCreditLimit` is the ceiling per bodega; on top of it, `FiadoScoring` keeps a per-customer debt
ledger — how much credit was given to each customer and how much they've paid back:

- **`extendFiado(customer, amount)`** — the bodega (`msg.sender`, same pattern as
  `setFiadoEnabled`) extends credit to a specific customer. No money moves: it's the promise
  that the customer takes something now and pays later. It fails if fiado is off for that bodega
  or if it exceeds the available room (`credit_limit - total_outstanding` for that same bodega).
- **`repayFiado(bodega, customer, amount)`** — restricted to `payment_router`, like
  `recordPayment`, because the real money already moved in `PaymentRouter.payFiado` before this
  call. If the customer overpays, the deduction is capped at the outstanding debt (no underflow,
  no revert).
- **`PaymentRouter.payFiado(bodega, amount)`** — the buyer pays in USDG (the equivalent of the
  soles they're paying), which goes straight to the bodega just like `receivePayment`, but does
  **not** grant cashback (paying a debt isn't a new purchase) and calls `repayFiado` instead of
  `recordPayment`.
- **`getFiadoDebt(bodega, customer)`**, **`getAvailableFiado(bodega)`**,
  **`getTotalOutstanding(bodega)`** — new views used by the frontend: `BodegaOwnerPanel` shows
  how much credit it has already given (outstanding) and how much room is left, and lets it extend
  credit to a customer by their 6-digit code; `BuyerPanel` shows the buyer's own code (same
  `lib/bodegaCodes.ts` system, already generic per address — no need to build a new one) to give
  to their bodega, and if they owe the bodega they're looking at, they can pay it right there.

Tests: `cargo test` (limit exceeded, fiado off, only `payment_router` can call `repayFiado`) and
`forge test` (fund transfer, no cashback, overpayment).

### InvoiceEscrow — fiado with partial collateral

`extendFiado` is 100% unsecured credit: the bodega extends credit without the customer
depositing anything, limited only by its `credit_limit`. `InvoiceEscrow.sol` is an **additional**
path (it doesn't replace `extendFiado`) for amounts where a bodega prefers to ask for a partial
deposit instead of extending credit on trust alone:

- **`proposeInvoice(customer, principal, collateral, dueDate)`** — the bodega (checked against
  `PaymentRouter.isBodega`) proposes an invoice. No funds or debt move yet.
- **`acceptInvoice(id)`** — the customer accepts and deposits the collateral in USDG (with a
  prior approve, in the same UserOperation), which the contract holds. It atomically calls
  `FiadoScoring.extendFiadoFor(bodega, customer, principal)`, so this debt counts toward the same
  score/history as unsecured fiado.
- **`repayInvoice(id, amount)`** (partial payments allowed; it never pulls more than what's owed)
  — sends the USDG straight to the bodega and calls `repayFiado`, just like
  `PaymentRouter.payFiado`. Once the full principal is reached, it returns all the collateral to
  the customer.
- **`claimCollateral(id)`** — after the due date with an outstanding balance, the bodega claims
  `min(shortfall, collateral)`, it's deducted from the on-chain debt, and any leftover goes back
  to the customer.

For `extendFiadoFor` and the `repayFiado` triggered by `claimCollateral`/`repayInvoice` to count
as trusted calls, `FiadoScoring` (Rust/Stylus) has a second trusted address, `escrow` (settable
only by its owner via `setEscrow`, same pattern as `payment_router`), and an
`extendFiadoFor(bodega, customer, amount)` method restricted to that address — exactly the same
logic as `extendFiado`, except `bodega` is a parameter instead of `msg.sender`.

Tests: `cargo test` (`extend_fiado_for`/`repay_fiado` only accept the configured `escrow`) and
`forge test` (proposal/cancellation, collateral pulled on accept, partial vs. full repayment,
overpayment never pulled, claim before/after the due date, claim capped at the available
collateral, and a fuzz test that the escrow never holds more than the active collateral).

### RewardsCatalog — rewards redeemable across bodegas

PUNTOS are earned as cashback and can be spent on gas or redeemed for something concrete through
`RewardsCatalog.sol`: each bodega builds its own rewards catalog, paid in PUNTOS by any customer in
the network, regardless of which bodega they earned them at.

- **`createReward(title, kind, pointCost, availableUntil, claimWindowSeconds)`** — any bodega
  registered in `PaymentRouter` publishes its own reward. `kind` is `Instant` (e.g. "1kg of
  rice") or `Raffle` (e.g. "Christmas basket"). The bodega sets two independent time windows:
  `availableUntil` (until when it's offered / entries are accepted) and `claimWindowSeconds` (how
  long the redemption code lasts once generated — not a fixed 15 minutes, each bodega chooses its
  own per reward).
- **`redeemInstant(id)`** — the customer pays `pointCost` PUNTOS (transferred straight to the
  bodega, not burned) and receives a one-time 6-digit code, valid for `claimWindowSeconds`.
- **`enterRaffle(id)`** — pays `pointCost` per entry; they can enter more than once for more
  chances. **`drawWinner(id)`** — only the owning bodega, only after `availableUntil`: picks a
  winner with `keccak256(blockhash, timestamp, id)` (bounded on-chain randomness, manipulable to
  a limited degree by the block proposer — acceptable for a low-value raffle, it doesn't warrant
  an external VRF oracle) and generates the winner's own redemption code.
- **`fulfillRedemption(code)`** — the bodega that owns the reward validates at the counter the
  code the customer shows and marks it delivered. The PUNTOS were already charged on entry, so
  this function only changes state and never moves funds — nobody can "reserve" without
  committing.

`PuntosToken` is a standard ERC-20 with no transfer restrictions, so `approve`+`transferFrom`
work without modifying it. The `approve` to `RewardsCatalog` is batched with the redemption in a
single `UserOperation` (`sendAndWait`, `frontend/lib/smartAccount.ts`), just like that same helper
already does with the paymaster `approve` — a single signature, no extra steps for someone who
doesn't know what an "approve" is. Since 1 PUNTO is worth 1 USD of cashback, the UI always shows
a reward's cost next to its value in soles.

Tests (Foundry): creation gated to registered bodegas, charging and code generation in
`redeemInstant`, expired/already used/other-bodega codes rejected, accumulating raffle entries,
`drawWinner` failing too early and with no participants, pausing rewards.

### GroupOrders — joint purchases between bodegas

A remote bodega often loses sales because the distributor doesn't reach it, or
because the minimum order it requires is more than a single bodega needs. `GroupOrders.sol` lets
several bodegas pool demand up to that minimum — bodega↔bodega, unlike
`InvoiceEscrow`/`RewardsCatalog` which are bodega↔customer, so this lives only in
`BodegaOwnerPanel.tsx`, nothing in `BuyerPanel.tsx`.

- **`createGroupOrder(title, goal, pledgeDeadline, withdrawWindowSeconds)`** — any registered
  bodega organizes a group order with a goal in USDG (like the rest of the app), a deadline for
  pledges, and how long a grace period it has itself to withdraw once the goal is reached.
- **`pledge(id, amount)`** — any registered bodega pledges USDG before the deadline. It's
  recorded per bodega (not anonymous) — that record is what's used off-chain to split the goods in
  proportion to what each one contributed.
- **`withdraw(id)`** — only the organizer, only once the pledge period has closed, the goal was
  reached, and it's still within the grace period. It takes the whole pool to buy from the
  distributor in real life (the distributor isn't an on-chain actor).
- **`refund(id)`** — any bodega that pledged claims its share back if the order never reached its
  goal, or if it did but the organizer let the grace period expire without withdrawing — the
  funds are never stuck forever.

**Proximity filter (frontend, not in the contract).** A group order only makes sense between
bodegas that are actually close — someone has to pick up the goods at a single drop-off point, so
pooling demand with a bodega from another district solves nothing. The contract itself
deliberately has no concept of location (same criterion as the rest of the project: a bodega's
location is UX metadata, not something that needs to be trustless, so it lives off-chain — see
"Map of nearby bodegas" below). The filter is handled entirely in `BodegaOwnerPanel.tsx`, reusing
that same location:

- When listing orders, each one is matched with its organizer's saved location
  (`GET /api/bodega/location`, the same source that feeds the map) and the distance to the bodega
  viewing the list is computed (`lib/distance.ts`, Haversine formula — real-route precision isn't
  needed for this).
- A radius selector (1 km / 2 km / 5 km / All, 2 km by default — the "same neighborhood" scale
  that motivated this filter) determines what is shown as "near you".
- If the bodega itself hasn't saved its location yet, there's nowhere to measure distance from —
  in that case the full unfiltered list is shown, with a notice inviting it to save it, instead of
  hiding orders that could be relevant.
- Orders whose organizer didn't save a location are kept apart, in a collapsed section ("bodegas
  without a registered location") — never silently mixed into the "nearby" list, because there's
  no way to know whether they're close or not.

What it deliberately does NOT solve: it doesn't model units or a product catalog (`goal` is an
amount, not a number of sacks of rice — same criterion as `BeneficioToken.sol`, to avoid
simulating a catalog that doesn't exist in the rest of the app). The proximity filter is only for
discovery (what's shown first) — the contract still accepts a pledge from any registered bodega
regardless of distance, so it doesn't replace the organizer's human judgment about whom to
distribute to if someone far away pledges anyway.

Tests (Foundry): creation/pledge gated to registered bodegas, withdrawal too early/before the
goal/after the window reverts, a successful withdrawal transfers the whole pool and blocks later
refunds, refund when the goal isn't reached, refund when the grace period expires without
withdrawal, double refund reverts.

### CreditCertificate — Zero-Knowledge credit certificate

The shopkeeper's credit score with Zero-Knowledge. The verifier is a standard Solidity Groth16
verifier, which runs on Arbitrum exactly as on any EVM chain.

`FiadoScoring.getScore`/`getPaymentHistory` are already public — anyone can read them without
ZK. The real value of the proof here isn't "hiding data that's already public on-chain", it's two
concrete things: (1) a **verifiable, portable credential** ("score ≥ 700" instead of the exact
number) that a bank/supplier can validate in one click without understanding Bodegueando's
contracts, and (2) that the same credential is **consumable on-chain** — see "CreditLine" below.

**Stack**: Circom + snarkjs (Groth16) — a new sibling subproject of `contracts/solidity/` /
`contracts/stylus-fiado-scoring/`: `contracts/circom-credit-certificate/`.

- **The circuit** (`circuits/creditCertificate.circom`) takes a private `score` and EdDSA
  signature, and a public `threshold`/`bodega`/oracle pubkey/`issuedAt`. It uses proven
  `circomlib` templates (`Poseidon`, `EdDSAPoseidonVerifier`, `GreaterEqThan`) — no hand-rolled
  cryptography. It proves "the oracle signed `poseidon(bodega, score, issuedAt)` AND
  `score >= threshold`" without `score` ever appearing in the public signals.
- **Trusted setup**: reuses an already-published Powers of Tau file (iden3/Hermez's public
  ceremony, standard for small circuits like this one) instead of running its own ceremony — the
  real trust assumption here is the centralized oracle, not the setup.
- **The ZK oracle** (`frontend/lib/zkOracle.ts`) signs with an EdDSA-BabyJubJub key
  (`ZK_ORACLE_PRIVATE_KEY`) — deliberately **different** from `ORACLE_PRIVATE_KEY` (which is
  secp256k1, Ethereum's curve, and isn't cheap to verify inside a circuit). `circomlibjs` signs
  with exactly the same parameters the circuit verifies.
- **`app/api/credit-certificate/attest`**: reads the current score from `FiadoScoring` (already
  public) and, if it meets the requested threshold, signs the attestation — it refuses to sign if
  the bodega has an unresolved default in `CreditLine` (see below).
- **`app/api/credit-certificate/prove`**: runs `snarkjs.groth16.fullProve` server-side (the wasm
  + zkey weigh several MB, there's no point sending them to the shopkeeper's phone) and returns
  the proof already formatted as the calldata `submitCertificate` expects.
- **`CreditCertificate.sol`** (`Ownable` — unlike the project's self-service contracts, here an
  admin-configurable trust anchor for the oracle pubkey is needed): `submitCertificate` calls the
  auto-generated Groth16 verifier (`CreditCertificateVerifier.sol`,
  `snarkjs zkey export solidityverifier`, not edited by hand), checks that the pubkey matches the
  configured one and that the attestation isn't stale, and stores the certificate for 30 days.
  `getCertifiedThreshold(bodega)` is the view that `CreditLine.sol` (or any external verifier)
  queries.
- **`app/certificado/[address]`**: a public read-only page, same pattern as `/pagar/[code]` — a
  bank opens the link and sees "✅ Valid certificate: score ≥ 700, expires on...", read straight
  from the contract, no wallet.

Tests: the full circuit (`contracts/circom-credit-certificate/test/` — a real proof generated and
verified without exposing the score; an insufficient score and a wrong signature can't generate a
proof) and Foundry tests for `CreditCertificate.sol` (with a mock verifier, since the ZK math is
covered at circuit level). On-chain, proving "score ≥ 500" over a real score of 600 makes
`getCertifiedThreshold` return `500`; the 600 never appears in any public signal or event.

### CreditLine — on-chain credit line

The ZK certificate isn't only for external banks: it's also consumable **on-chain**. A bodega
with a certified score borrows from a shared pool with **less collateral the better the score it
proved** — the same partial-collateral mechanism as `InvoiceEscrow.sol`, except here the size of
the collateral is decided by the certified score, not by the bodega.

- **Shared pool**: `deposit(amount)`/`withdraw(shares)`, anyone can lend — a simple vault pattern
  (shares proportional to the pool's value), not full ERC-4626. Share value is based on
  `totalAssets() = poolBalance + totalReceivable` (see "USDG payments" for why outstanding loans
  and their fixed interest are counted).
- **`borrow(amount)`**: only registered bodegas with a valid certificate. The collateral % is set
  by the certified tier (fixed table: score≥900→15%, ≥700→30%, ≥500→50%); the collateral is pulled
  in USDG and can be previewed with `requiredCollateral(bodega, amount)`.
- **`repay(loanId)`**: principal + 5% fixed interest (no dynamic curve), all at once (see
  `amountOwed(loanId)`); returns the collateral, and the repayment goes back to the pool.
- **`liquidate(loanId)`**: after the due date without repayment, anyone can execute it — the
  collateral goes to the pool (compensating lenders) and the default is recorded.

It is deliberately **not** a full lending protocol: no dynamic interest curve, no price oracle
(everything in the same currency, USDG, no cross-asset risk), no installments. The default
deliberately doesn't touch `FiadoScoring` on-chain — coupling one more contract as an authorized
caller there has a real cost (`FiadoScoring` is an immutable Stylus contract, so adding a new
caller forces a redeploy — and new Stylus activations are currently paused, see "USDG payments").
Instead, `attest/route.ts` blocks new certificates while there's an unresolved default: a real
reputational consequence, without coupling more contracts together.

Tests (Foundry): collateral tiers, withdrawal limited to the pool's liquidity, deposits while
fully lent out, late depositors not diluting earned interest, donations not moving the share
price, repayment, liquidation before/after the due date, double resolution, and a fuzz test of the
pool's balance invariant.

### On-chain circuit breaker for the AI oracle

`app/api/fiado-score/route.ts` signs `updateScoreFromAi` with `ORACLE_PRIVATE_KEY`, a key that
lives as an environment variable in the same process that serves the web app (see "Deliberate
hackathon shortcuts" below). To bound what that key can do if it leaks, `FiadoScoring` limits what
the oracle can write: the limit it proposes can be at most twice
what the on-chain heuristic itself (the same one that runs on every `record_payment`) would
compute for that bodega right now. Lowering the limit (being more conservative than the
heuristic) remains uncapped, because it's never a risk. The heuristic's math was extracted into
`heuristic_score_and_limit`, a pure function shared by both `recompute_heuristic` (which already
runs on every payment) and `update_score_from_ai` (the validation) — there are no two
calculations that could drift apart.

Tests (`cargo test`): a limit within 2× is accepted, one far above reverts with
`AiLimitOutOfRange`, and lowering the limit remains free regardless of the heuristic.

### `BeneficioToken.sol` — on-chain social programs PoC (Vaso de Leche, Qali Warma, Pensión 65)

The reason this makes sense in this project specifically, rather than as a generic feature bolted
on top: no supermarket or pharmacy chain reaches every neighborhood where there is a bodega — that
makes bodegas, without anyone designing it that way, the country's largest and closest last-mile
network. `BeneficioToken` uses that real presence so a social program reaches whoever needs it
directly, spendable only at their neighborhood bodega, with no intermediaries taking a cut along
the way.

Unlike `PuntosToken` (free, transferable between anyone), `BeneficioToken` is a restricted ERC-20:
a beneficiary can only spend it by transferring it to a bodega already registered in
`PaymentRouter` (never reselling it to someone else or exchanging it for cash), and each issuance
expires `duration` seconds after being issued. The restriction lives in `_update`, the hook ERC20
calls on *every* transfer (including `transferFrom`) — there's no way around it using another
function of the token. One unit represents S/ 1 of benefit, and the app shows it as such.

- **`issue(beneficiary, amount, duration)`** — only the `owner` (in a real integration, the
  relevant municipality or ministry) can issue benefits.
- **Normal `transfer`/`transferFrom`** — works as "redeem": if the recipient isn't a registered
  bodega (`IBodegaRegistry.isBodega`, the same source of truth `PaymentRouter` already uses — there
  is no second registry that could drift) or if the sender's benefit has expired, it reverts
  (`NotABodega` / `BenefitExpired`).

**What this PoC deliberately does NOT solve:** it doesn't restrict the spending category ("food
only") because the app has no product catalog — building one would be a separate project, not
something this contract can honestly simulate. Nor does it reclaim expired balances back to the
program (that would need an on-chain keeper); an expired benefit simply can no longer be spent and
stays frozen in the wallet.

Tests (`forge test`): issuance only by the owner, expiry, valid spending at a registered bodega,
an attempt to resell to another person (the case that justifies the whole contract) reverts, and
`transferFrom` (approving a third party) is subject to the same rules as a direct `transfer`.

The issuance UI lives in the same panel any bodega already uses (`BodegaOwnerPanel.tsx`), not a
separate dashboard:

- **Who can issue.** `issue()` is `onlyOwner` on-chain. The panel reads that same `owner()`
  (`useReadContract`, with no separate environment variable that could drift from the contract)
  and only shows the "Admin panel — Social benefits" section to the matching account. Even if
  someone forced it to appear in the frontend, the call to `issue()` would revert on-chain for any
  other account.
- **The `owner` is the smart account of a real Privy-logged-in session, not the deployer
  account.** Privy generates a *new smart account* per login — there's no way to "log in as" a
  pre-existing external private key through the app's normal flow, so `BeneficioToken`'s `owner`
  has to be that same smart account (computed by reproducing the same `toSimpleSmartAccount` that
  `lib/smartAccount.ts` uses) so that whoever administers social programs sees the panel simply by
  logging in normally, without extra steps or a separate account to remember.
- **Fiado stays self-service.** `extendFiado`/`setFiadoEnabled` are keyed on `msg.sender` — each
  bodega controls only its own fiado, with no allowlist (see "Fiado with a real debt ledger"
  above). The admin panel is additive: an extra section only the `owner` sees.

**Redemption UI, on the beneficiary's side (`BuyerPanel.tsx`).** As soon as the customer has a
`BeneficioToken` balance (`balanceOf > 0`), they see a separate card — apart from regular payment,
never mixed with the normal "Pay" button — with their balance and expiry date. The payment itself
(`transfer(bodega, amount)`) is enabled only once they've also typed a bodega's code, reusing the
same code lookup they already use to pay or repay their fiado. Expiry isn't pre-validated in the
frontend — if the benefit has already expired, the payment attempt reverts on-chain
(`BenefitExpired`, see `_update` in `BeneficioToken.sol`) and a generic error is shown; the
source of truth remains the contract, not a date calculation on the client.

### Shopkeeper dashboard

`BodegaOwnerPanel` is a dashboard (`components/bodega/`) with five areas — **Inicio** (overview), **Cobrar** (get paid), **Fiado**
(store credit), **Crédito** (credit) and **Mi red** (network) — a bottom tab bar on phones and a
sidebar on desktop. Everything is shown in soles.

- **The tab lives in the URL** (`/app?tab=fiado`), read with `useSyncExternalStore` over
  `history.pushState`/`popstate`, so the back button works and a link (e.g. from the Telegram bot)
  can open a specific area. Only the active tab is mounted, so only its data is fetched.
- **Inicio** shows today's and the week's sales, what's owed in fiado, the trust level, a
  "Pendientes" list built from contract state (overdue or soon-due collateral invoices, loans
  due, group orders ready to withdraw, closing soon or refundable — each one links to where it's
  resolved), and a first-steps checklist for new bodegas that disappears once complete.
- **Full sales history and "Quién te debe" without a backend or indexer.** `lib/bodega/activity.ts`
  reads `PaymentRouter.PaymentReceived` and `FiadoScoring.FiadoExtended`/`FiadoRepaid` with
  `eth_getLogs` filtered by the bodega's indexed topic, split into ≤9M-block windows (the Arbitrum
  Sepolia RPC caps a query at 10M blocks) fetched in parallel, starting at
  `NEXT_PUBLIC_CONTRACTS_DEPLOY_BLOCK` when set. Each debtor's current balance comes from
  `getFiadoDebt`, the source of truth, in one multicall. The raw RPC call is used instead of
  `client.getLogs` because the node returns a `blockTimestamp` per log that viem's formatter drops;
  when it comes back empty (`0x0`, seen on older logs) the block is fetched once, batched.
- **Sales chart** (`SalesChart.tsx`): daily totals for 7 or 30 days, one series, ≤24px columns with a
  rounded data end, hairline gridlines at clean round values, a per-bar tooltip on hover/focus
  (aligned inward at the edges so it never overflows) and the same data as a table.
- **"Recordarle" (remind)** uses `app/api/fiado/remind`: the server builds the message itself from
  the on-chain debt, only sends if there is debt, and allows at most one reminder per
  bodega/customer per day (`setIfNotExists` in `lib/kv.ts`) — callers never choose the text.
- Shared reads live in `lib/bodega/hooks.ts`; wagmi caches by (contract, function, args), so
  Inicio and Fiado share the same query and a refetch in one tab updates the other.

### The Telegram bot as a profile

Neither the web app nor the bot ever shows "ETH", "USDG" or a `0x...` address to the shopkeeper
or the buyer — everything is shown in soles, and linking with Telegram is done with a 6-digit
code, not by pasting an address into the chat.

**Webhook in production, polling in local development.** Vercel can't keep a process listening
(each serverless function responds once and shuts down), so in production Telegram calls
`app/api/telegram/webhook/route.ts` for every message. The business logic lives in
`lib/telegramCommands.ts` (dispatching `/start`, `/vincular`, `/perfil`) and
`lib/telegramProfile.ts` (building the `/perfil` text), shared by the webhook and by
`GET /api/telegram/profile`, which the local polling daemon (`scripts/telegram-bot.mjs`) uses. The
`X-Telegram-Bot-Api-Secret-Token` header (compared against `TELEGRAM_WEBHOOK_SECRET`) rejects
requests that don't really come from Telegram.

**Outgoing alerts never carry caller-chosen text**, so nobody can use the official bot to send
phishing in Bodegueando's name. `POST /api/telegram/notify` only accepts two message kinds, both
built server-side:

- `{ kind: "payment", bodegaAddress, txHash }` — the server reads the transaction receipt and only
  sends if it contains a `PaymentReceived` from the current `PaymentRouter` to that bodega; the
  amount comes from the event, not the client. One alert per transaction (`setIfNotExists`), so
  replaying the call does nothing.
- `{ kind: "test", bodegaAddress }` — the fixed "notifications on" message, at most once every 10
  minutes per account.

If Telegram rejects the send, the dedupe key is released so it can be retried. The fiado
reminder (`/api/fiado/remind`) follows the same rule: message built from on-chain debt, rate
limited.

**Linking:**
1. From `BodegaOwnerPanel.tsx` (or `BuyerPanel.tsx`, optional for buyers) the user requests a
   code with "Generate my code" → `POST /api/telegram/generate-code` stores
   `{code → address}` in `lib/kv.ts` (expires after 10 minutes, single use — `GETDEL`), so the
   webhook finds it even when it runs on a different serverless instance.
2. A button opens `t.me/<bot>?start=<code>` — Telegram's deep-link-with-parameter mechanism,
   which always delivers the code intact (a prefilled `?text=/vincular <code>` can be sent by the
   client before the code is complete, because `/vincular` is a registered command).
3. The webhook receives `/start <code>` and calls the same logic as `/vincular <code>`, which
   stores `chat_id → address` via `lib/kv.ts` (Upstash Redis in production,
   `frontend/.data/telegram-links.json` in local development — see "Storage: Upstash Redis in
   production" below).
4. The web app polls `GET /api/telegram/status` until it sees the link confirmed.

**Profile by chat:** once linked, anyone — shopkeeper or buyer — can send `/perfil` to the bot at
any time, not just receive push alerts. It reads `PaymentRouter.isBodega` to decide the role and
builds the reply:

- **Bodega:** payments received, trust level and how much fiado it offers (in soles).
- **Buyer:** accumulated cashback points (converted to soles).

**Registering the webhook** (once, after deploying the `app/api/telegram/webhook` code):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<your-domain>/api/telegram/webhook", "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"}'
```

**Local development:** without a public HTTPS URL Telegram can't call the webhook, so locally the
polling daemon is still used (`scripts/telegram-bot.mjs`, no secret, no webhook), running
separately from `pnpm run dev`:

```bash
cd frontend
pnpm run bot
```

**Command list for @BotFather** (`/setcommands` → pick the bot → paste as-is; the bot speaks
Spanish to its users):

```
start - Ver cómo vincular tu cuenta de Bodegueando
vincular - Vincular tu cuenta con tu código de 6 dígitos (ej. /vincular 123456)
perfil - Ver tus pagos, puntos o fiado
```

The bot is [@bodegueandobot](https://t.me/bodegueandobot).

### Storage: Upstash Redis in production, local file in development

Vercel's filesystem is ephemeral per invocation — two requests to the same endpoint can run on
different serverless instances that never saw what the other wrote — so everything the app stores
off-chain (bodega/customer codes, Telegram links, locations, profiles, rate-limit keys) goes
through `lib/kv.ts`, which has two backends behind the same interface:

- **With `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set** (free account at
  [console.upstash.com](https://console.upstash.com)): uses real Redis over REST — works the same
  from any serverless function, with no need for a persistent connection.
- **Without those variables**: falls back to the usual JSON file under `.data/` — zero friction to
  keep developing locally without creating an Upstash account.

Small stores (`telegram.ts`, `bodegaLocations.ts`) use whole-blob `readJsonStore`/`writeJsonStore`;
stores that grow without bound (`bodegaCodes.ts`) use the atomic per-key primitives
(`setIfNotExists`, `getValue`, `setValue`, `deleteKey`, `incrementCounter`) — see "Bodega code".

**Keep-alive.** Upstash archives free databases after ~30 days without activity, and restoring
creates a new database with a new URL/token (which means updating the env vars and redeploying).
A daily Vercel cron (`frontend/vercel.json`, 12:00 UTC) calls `app/api/cron/keepalive`, which does
a real `SET` + `GET` on its own `keepalive:last` key. The route only answers to
`Authorization: Bearer $CRON_SECRET` (sent by Vercel, also used by `app/api/cron/paymaster-health`) and returns 503 if the Upstash variables are
missing, so a misconfiguration shows up in the cron logs.

### Automatic test-balance faucet for the demo

`PaymentRouter.receivePayment` charges in USDG (see "USDG payments"), and unlike gas (which
`PuntosPaymaster` pays), the *payment amount* has to come out of the buyer's own balance, and a
new account starts at 0. So anyone can try the demo on their own, `app/api/faucet/route.ts` funds
new accounts: as soon as a panel detects a connected account, it asks for
a small balance gift (`FAUCET_AMOUNT_USDG`, default 10 USDG) — a real transfer of testnet USDG,
not simulated. The faucet wallet is topped up at [faucet.paxos.com](https://faucet.paxos.com).
Abuse protections:

- **Once per address**, recorded in `lib/kv.ts` (same store as bodega-codes/telegram-links) as
  soon as the transaction is sent — it doesn't matter if the account spends the balance, it won't
  ask again.
- **Checks the current USDG balance** before sending anything — if the account already has funds,
  it doesn't duplicate the gift.
- Without `FAUCET_PRIVATE_KEY` configured, the route simply does nothing (`funded: false`) — it
  doesn't break the payment flow if it isn't configured, it just doesn't give away a balance.

Both `BuyerPanel` and `BodegaOwnerPanel` request it: a bodega gets paid without needing a balance
of its own, but to pledge to a group order or post a loan's collateral it does need USDG. Nobody
needs ETH: gas is covered by `PuntosPaymaster`.

Like the paymaster's gas deposit, this funding account needs occasional manual top-ups — it's a
demo shortcut, not a real fiat ramp (see "Real soles ↔ USDG ramps" in the roadmap table below for
the distinction with a real Yape/cash integration).

### Wallet-less login + self-service registration + gas paid in PUNTOS

The product goal is that nobody has to know what a wallet is:

- **Login (`components/Login.tsx`, Privy):** you sign in with your phone or email (OTP code), or a
  passkey — never "connect your wallet". Privy creates an embedded wallet on first login,
  invisible to the user — they only see their email/phone on screen.
- **Self-service bodega registration (`PaymentRouter.registerSelf`):** anyone can register as a
  bodega from the web app, without an admin approving it (see the analysis in the contract code:
  `isBodega` only decides who can *receive* a payment the buyer already chose to send — there's
  nothing to abuse). Registering an address twice reverts with `AlreadyRegistered`.
- **Gas paid in PUNTOS, not ETH (`PuntosPaymaster.sol`, ERC-4337):** each person has a *smart
  account* (eth-infinitism's `SimpleAccount`, EntryPoint v0.7, built with `permissionless.js` in
  `lib/smartAccount.ts`) whose owner is the Privy embedded wallet. Pimlico is the bundler. An
  account's first few transactions are sponsored for free; from then on, gas is charged in PUNTOS
  from the user's own balance, converted from ETH at the paymaster's `puntosPerEth` rate (see
  "USDG payments"). The user never sees "gas" or signs a wallet popup; they only see a button that
  says "Register" or "Pay".

**PUNTOS bootstrap on registration.** `receivePayment` mints PUNTOS cashback to whoever *pays*
(`msg.sender`), never to the bodega that gets paid, so `registerSelf()`/`registerBodega` mint
`BODEGA_BOOTSTRAP_PUNTOS` once at registration as a small welcome balance.

**The free runway is only consumed if the transaction succeeded.** `PuntosPaymaster._postOp`
receives each `UserOperation`'s `PostOpMode` and only marks a free transaction as used when
`mode == PostOpMode.opSucceeded` — a first attempt that reverts (a mistyped code, a wrong amount)
doesn't cost the account its free runway.

Tests: `test/PaymentRouter.t.sol` (bootstrap mint, no repeated registration) and
`test/PuntosPaymaster.t.sol` (with a real `EntryPoint` deployed in the test, not mocked).

### Frictionless gas: margin for the buyer, free gas for the bodega, realistic cashback cap

How gas is charged, designed so that neither buyer nor bodega ever has to understand "gas":

- **Five free transactions per account** (`FREE_TRANSACTIONS = 5`). It gives a new
  account plenty of runway when its second or third action isn't necessarily a purchase (paying
  back fiado, redeeming a reward — neither generates cashback), without anyone hitting a gas
  error in their first steps, something that simply doesn't exist as a concept in
  Yape/Plin/cash.
- **A bodega never pays gas, ever.** `PuntosPaymaster._validatePaymasterUserOp` checks
  `PaymentRouter.isBodega(account)` first: if it's a registered bodega, it always sponsors it,
  without looking at its PUNTOS balance or consuming its free-transaction runway. It fits the
  business model (never charging the bodega for its basic activity) — a bodega takes far fewer gas
  actions than a buyer makes purchases, so sponsoring it entirely is cheap.
- **`cashbackBps` capped at 3%.** The operating default stays at 2%; the cap (the maximum
  an owner could ever set) matters looking ahead: since PUNTOS are denominated in dollars, if
  they are ever redeemable 1:1 for real value, cashback stops being an accounting entry and
  becomes a real discount on a bodega's sale — 3% stays well below any traditional card-terminal
  fee (2.5%–3.5%) even in that scenario.
- **Best-effort charging, never gating.** A real approve + `receivePayment` UserOperation costs
  ~388k gas, about **US$ 0.05** on Arbitrum Sepolia, while the default 2% cashback on a S/5
  purchase is ~US$ 0.03 — small purchases don't pay for the next transaction's gas. So validation
  never requires PUNTOS: after the free runway, `postOp` charges `min(cost, balance, allowance)`
  and the platform covers the rest, emitted as `GasShortfallSponsored` so that cost can be
  measured. `POST_OP_OVERHEAD_GAS` (40k, measured) is added so the charge includes `postOp`'s own
  gas, which the EntryPoint's `actualGasCost` leaves out.

Tests (Foundry): free runway, bodegas always sponsored, charge capped by balance and by allowance
(including a fuzz test), validation never gating on PUNTOS, and the `puntosPerEth` conversion.

### Shopkeeper and customer are two separate spaces, never combined

`app/app/page.tsx` doesn't infer the role by combining it with the other's view: an account
already registered as a bodega (`isBodega` on-chain) goes **straight** to `BodegaOwnerPanel`, with
no way to see `BuyerPanel` in the same session. A new account sees an explicit choice before any
panel — "I'm a shopkeeper" / "I'm a customer". "I'm a shopkeeper" triggers `registerSelf()`;
"I'm a customer" only stores the choice (`localStorage`, per address) so it doesn't ask again on
future visits. The bodega QR (`/pagar/[code]`, see below) skips the selector: scanning a QR is
already an unambiguous customer intent.

**Inside `BuyerPanel.tsx`, no action is offered until the typed code's role is confirmed.** The
"Bodega code" field resolves a code to an address and then reads `isBodega(resolvedAddress)`; the
payment UI (regular, fiado, social benefit) stays hidden until it really is a registered bodega,
and otherwise says so explicitly ("That code doesn't belong to a bodega").

### Bodega code: QR + short number, never an address

`BodegaOwnerPanel.tsx` never shows a `0x...` address for the customer to copy — it generates
a permanent 6-digit code (`lib/bodegaCodes.ts`, via `lib/kv.ts`, never expiring — unlike the
Telegram code, this one has to keep working months later, printed on a sign) and shows it as a QR
code (`qrcode.react`) encoding `https://<domain>/pagar/<code>`.

The customer scans it with the phone's native camera (no scanning library: the URL opens
`app/pagar/[code]/page.tsx` directly, which resolves the code server-side and preloads
`BuyerPanel`) or types the code by hand as a fallback. Neither panel shows a `0x...` anywhere.

**Two independent pools, atomic storage, adaptive length.** The same 6-digit code is also used
for a buyer's personal code (so a bodega can extend them credit, or they can receive a social
benefit) — two populations with very different growth profiles. `lib/bodegaCodes.ts` keeps them in
independent pools (`"bodega"`/`"buyer"`, keys `code:<pool>:code:<code>` and
`code:<pool>:addr:<address>`), each with its own headroom — bodegas are bounded (~500–600 thousand
in Peru), buyers are not.

Codes are reserved with atomic per-key primitives from `lib/kv.ts` (`setIfNotExists`, `getValue`,
`deleteKey`, `incrementCounter`): real `SETNX`/`GET`/`DEL`/`INCR` in Redis, and an in-process mutex
in the local-file fallback. This keeps concurrent registrations from overwriting each other and
avoids rewriting an ever-growing blob.

`getOrCreateCode(pool, address)` reserves the code first (`SETNX`) and only then claims the
address (`SETNX` again) — if two concurrent requests collide on the same address, the loser
releases (`DEL`) the extra code it reserved and returns the one that already won. Codes are
generated with `crypto.randomInt`: the code isn't a security secret (real authorization is the
smart account's signature, this is just a UX pointer), but the cryptographic generator costs
nothing.

**Adaptive length per pool.** It starts at 6 digits (900,000 codes). An atomic counter per pool
(`code:<pool>:count`, incremented only once per genuinely new registered address, never on every
attempt) decides the issuing length: on reaching 80% of the current length's capacity, NEW codes
in that pool start being issued with one more digit — the same pattern as a phone numbering plan
adding a digit when an area code fills up. Codes already issued keep resolving forever, they are
never renumbered or shortened: resolving a code is a key lookup and doesn't care how many digits
it has (the frontend inputs accept 6–9 digits, `/^\d{6,9}$/`, instead of assuming exactly 6).

**Schema migration.** `scripts/migrate-bodega-codes.mjs` is a one-off script to move codes from an
old schema (a single blob that didn't distinguish pools) to the current pooled schema, classifying
each address with `PaymentRouter.isBodega` on-chain — the same source of truth the rest of the app
uses. Important operational note: the bodega registry lives in `PaymentRouter`, so if that
contract is redeployed (as in the USDG migration), any account that relied on `registerSelf()` to
be classified as a bodega needs to register again on the new instance before running this
migration, or it will be classified as a buyer.

### Installable app (PWA)

A shopkeeper shouldn't have to find the app in the browser every time, so Bodegueando installs to
the home screen and opens like an app, with no browser bar:

- **`app/manifest.ts`** — name, colors and icons (`public/icons/`: 192/512 px, a maskable 512 px
  version with the drawing inside Android's safe zone, and `apple-touch-icon.png` for iPhone,
  declared through `metadata.icons.apple` and `metadata.appleWebApp` in `app/layout.tsx`). It
  opens straight at `/app`.
- **`public/sw.js`** — deliberately does **not** cache the app: balances, fiado and payments must
  always be read live, and an old cached bundle could sign transactions with outdated logic. It only
  serves `public/offline.html` when a page is opened without internet. Registered by
  `components/pwa/ServiceWorkerRegistrar.tsx` in production only; `next.config.ts` serves it with
  `no-cache` (so a new version arrives on the next visit) and a same-origin script CSP.
- **`components/pwa/InstallAppBanner.tsx`** — shown in `/app` after login: on Android/Chrome it
  keeps the browser's `beforeinstallprompt` event and its "Instalar" button opens the native
  dialog; on iPhone Safari (no such event) it explains Compartir → "Agregar a inicio". Hidden when
  already installed (standalone mode) or once dismissed.

### Map of nearby bodegas ([mapcn.dev](https://www.mapcn.dev))

Each bodega can save its location, which feeds a map for customers and the radius filter in
`GroupOrders` (see "GroupOrders" above; `RewardsCatalog` stays a global list, since redeeming
points doesn't involve picking anything up at a shared physical point). The map uses
[mapcn](https://www.mapcn.dev) — React components on top of MapLibre GL, free CARTO tiles (no API
key), installed via the shadcn/ui CLI (`pnpm dlx shadcn@latest add @mapcn/map`).

- **Location as UX metadata, not on-chain**: the same criterion as the 6-digit codes
  (`lib/bodegaCodes.ts`) — nobody needs trustless verification of a pin on a map. It lives in
  `lib/bodegaLocations.ts` (same `readJsonStore`/`writeJsonStore` pattern from `lib/kv.ts`,
  Upstash with a file fallback) and `app/api/bodega/location/route.ts` (`POST` saves/updates,
  `GET` with no parameters returns the full list to feed the map, `GET ?address=` preloads one's
  own).
- **`BodegaOwnerPanel.tsx`**, "Your location on the map" section: a button that calls
  `navigator.geolocation.getCurrentPosition` to center the map, with a draggable pin
  (`MapMarker draggable`) to adjust it by hand if the GPS isn't exact.
- **`BuyerPanel.tsx`**, "Nearby bodegas" section: geolocates the customer to center the map (if
  they deny permission, it centers on Lima by default), fetches every bodega with a saved location
  and drops a pin for each; each pin's popup resolves its 6-digit code (the same trick
  `RewardsCatalog` already uses in the frontend: `POST /api/bodega/code` creates-or-returns any
  address's code) and links to `/pagar/[code]`, the same route the bodega's QR uses.
- The buyer's map doesn't compute or sort by "proximity": the map itself, centered on the
  customer, already communicates visually which bodegas are close — the same deliberate
  simplicity as the rest of the project. `GroupOrders` does compute real distance
  (`lib/distance.ts`, Haversine) because there "nearby" decides what's shown first, not just what's
  visible on a map — see "GroupOrders" above.

**Maintenance notes.** `components/ui/map.tsx` (from the mapcn registry) uses
`import * as MapLibreGL`, since `maplibre-gl` 6.x has no default export. The app's palette and
`--font-sans` live in `app/globals.css`; re-running `shadcn init` would overwrite them.

**MapLibre's Web Worker is served from `public/`.** Under Next.js/Turbopack bundling MapLibre can't
derive its worker URL from `import.meta.url`, so `scripts/copy-maplibre-worker.mjs` (a
`postinstall` hook, so it always matches the installed `maplibre-gl` version) copies
`maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` into `public/` (not committed — build
artifacts), and `components/ui/map.tsx` calls `MapLibreGL.setWorkerUrl("/maplibre-gl-worker.mjs")`
once, before building any `Map`. Without it the map compiles but never finishes loading.

## USDG payments (Paxos)

Everything that moves money settles in
[USDG](https://docs.paxos.com/guides/stablecoin/usdg/testnet), Paxos' regulated stablecoin
(`0xFFC95faa3d63Cde504a05B567C600B78C0b41892` on Arbitrum Sepolia,
`0x004B506865409877C9fA29bfb1ebA929984B9bbC` on Arbitrum One, 6 decimals), instead of testnet
ETH: `PaymentRouter` (payments and `payFiado`), `InvoiceEscrow` (collateral and repayment),
`GroupOrders` (pledges) and `CreditLine` (pool, collateral, loan and repayment).

- **Shared `StablecoinSettlement` base.** All four contracts inherit the stablecoin
  (`immutable`), its scale to 18 decimals (computed in the constructor from `decimals()`; tokens
  with more than 18 are rejected) and `_toUsd18`. Internal amounts (an invoice's principal, a
  group order's goal, a loan) are stored in USDG decimals, which is exactly what gets transferred.
  Only what enters the PUNTOS/fiado ledger is normalized.
- **A single unit of account: USD with 18 decimals.** Cashback, history, limit and fiado debt
  (including `InvoiceEscrow`'s collateral-backed debt) are all in dollars:
  **1 PUNTO = 1 USD of cashback**. `FiadoScoring` (Stylus) didn't change, because its heuristic
  doesn't depend on the unit.
- **Transfer pattern.** `SafeERC20` everywhere, checks-effects-interactions (events are also
  emitted before any external call) and `nonReentrant` on every function that moves funds, as a
  second line of defense in case the token ever gains hooks. `PaymentRouter` and
  `InvoiceEscrow.repayInvoice` send straight from the payer to the bodega, without custody.
  `repayInvoice(id, amount)` only pulls what's owed, so the "overpay and wait for a refund" case
  doesn't exist.
- **`CreditLine` share accounting.** A share's value is based on
  `totalAssets = poolBalance + totalReceivable`, where `totalReceivable` = principal + fixed
  interest of outstanding loans — so withdrawals and deposits while loans are outstanding are
  priced fairly, deposits work even with the pool fully lent out, and a late depositor doesn't
  capture interest they didn't fund. A default's loss is recognized at liquidation. Direct donations to the contract don't move
  the internal accounting (no share-inflation attack). `withdraw` only pays out what's liquid. New
  views: `requiredCollateral(bodega, amount)` and `amountOwed(loanId)`.
- **Gas in PUNTOS, with a rate.** PUNTOS are denominated in USD, so `PuntosPaymaster`
  converts gas using `puntosPerEth` (the ETH/USD price with 18 decimals). The owner maintains it
  with `setPuntosPerEth`, bounded to `[100, 100,000]` USD/ETH. It isn't a live oracle read because
  ERC-7562 doesn't allow a paymaster's validation to read other contracts' storage, and on
  Arbitrum gas costs fractions of a cent: a rate that's a few percent stale doesn't matter. The
  charge is best-effort (see "Frictionless gas").
- **Frontend.** Every payment goes as `approve(exact amount)` + the call in a single UserOperation
  (`lib/stablecoin.ts::withStablecoinApproval`): one signature and no open allowance. The UI shows
  everything in soles using the USD→PEN rate (`lib/exchangeRate.ts`). Where users handle their own money (their balance, the credit pool, what they owe
  on a loan) the dollar equivalent is added. Nobody sees "USDG", "ETH" or wei.
- **Faucet.** `/api/faucet` gives away testnet USDG (the faucet wallet is topped up at
  [faucet.paxos.com](https://faucet.paxos.com)). It doesn't give away ETH: the paymaster pays gas.

Tests: all four contracts against a 6-decimal mock, including fuzz tests of cashback, escrow
balance and pool invariants (`balance = liquidity + collateral`). `test/PaymentRouter.fork.t.sol`
runs the router against the real USDG contract on an Arbitrum Sepolia fork
(`ARBITRUM_SEPOLIA_RPC_URL=... forge test --mc PaymentRouterForkTest`).
`test/DeployUsdgStack.t.sol` runs the full deploy script and checks every wiring step.

**Stylus paused: `FiadoScoring` is reused.** Since October 2, 2026, Arbitrum's Security Council has
paused the activation of **new** Stylus contracts on One, Nova and Sepolia (`cargo stylus check`
responds "Stylus activations appear to be paused on this chain"). Already-activated contracts keep
working, so the USDG deployment reuses the existing `FiadoScoring` (`0x22FD…80B2`) and only
rewires it (`setPaymentRouter`, `setEscrow`). Consequence: the previous payment history (in
ETH-wei, small amounts) coexists with the new one (in USD-wei) until each bodega accumulates 12
new payments and the ring buffer replaces it. Until then, those bodegas' heuristic limit comes out
lower than their USDG history would justify.

## Deliberate hackathon shortcuts

- **Real soles don't flow in and out of the app yet.** Everything settles in testnet USDG (see
  "USDG payments"). The soles↔USDG ramp with a licensed provider in Peru is roadmap; see "Business
  model" in the README.
- **AI oracle with a server-held key.** `app/api/fiado-score/route.ts` signs the
  `updateScoreFromAi` transaction with a testnet private key stored in `ORACLE_PRIVATE_KEY` (an
  environment variable of the Next.js server). In production this should be a dedicated signing
  service, not a key in the backend process. The damage a leaked key can do is bounded on-chain:
  `FiadoScoring.update_score_from_ai` rejects any limit above twice what the heuristic justifies
  with the real history — see "On-chain circuit breaker for the AI oracle".
- **`SimpleAccount` (eth-infinitism's reference), not Safe or Kernel.** It's the implementation
  Pimlico's official guide uses for Privy signers — a smaller risk surface than evaluating another
  smart-account library against the hackathon clock.
- **Pimlico only as bundler, our own paymaster.** `PuntosPaymaster.sol` is our own contract (not
  Pimlico's hosted ERC-20 paymaster) because PUNTOS is our own token with no market price —
  Pimlico only relays UserOperations to the EntryPoint; all the "free at first, then charged in
  PUNTOS" logic lives in our contract.
- **The paymaster's gas deposit and `puntosPerEth` are maintained by hand.** `PuntosPaymaster`
  needs real ETH deposited in the EntryPoint to sponsor transactions (`deposit()` / `cast send`),
  and `setPuntosPerEth` is `onlyOwner` — the same owner can sweep PUNTOS, so that key isn't put on
  the server to update the rate automatically. A daily Vercel cron
  (`app/api/cron/paymaster-health`, `lib/paymasterHealth.ts`) checks both and sends a Telegram
  alert to `TELEGRAM_ADMIN_CHAT_ID` when the deposit falls below
  `PAYMASTER_BALANCE_ALERT_THRESHOLD_ETH` (default `0.01` ETH) or the rate drifts more than
  `PUNTOS_PER_ETH_DRIFT_ALERT_PCT` (default 10%) from CoinGecko's ETH/USD, including the exact
  `cast send` to fix it. `pnpm run check-paymaster-balance` still checks the deposit by hand.
- **The bodega QR needs a real URL, not localhost.** `app/pagar/[code]/page.tsx` can only be
  scanned with the phone camera if the app is deployed (Vercel or similar) — on `localhost` the
  hand-typed 6-digit code still works.
- **WhatsApp (Twilio)**: just a stub for now (`app/api/whatsapp/webhook/route.ts`) —
  implementation planned for the coming weeks. That's why **Telegram was implemented first**: same
  goal (telling the shopkeeper when they get paid), available right away.
- **Read-only, cached USD → PEN exchange rate.** `lib/exchangeRate.ts` fetches USD/PEN from
  open.er-api.com (no API key; frankfurter.app was ruled out because it only covers ECB reference
  currencies and doesn't include soles), caches the result for ~5 minutes and falls back to a
  hard-coded approximate rate if it's down — the demo can't break because of an external API.
  There's no contract involved: it's for display, and for converting what the user types in soles
  into the USDG amount they sign.

## Full architecture / Roadmap

The product idea is that the blockchain is invisible: the shopkeeper and the customer should never
see "gas", "network", "address" or "seed phrase" — everything feels like a payments-and-points
app, but under the hood what matters (balance, points, fiado) lives on-chain. What follows is the
full architecture the product is aiming for; the **Current MVP** section marks which part of it is
already built and tested on testnet.

### System layers

1. **User layer** — PWA/web app for shopkeeper and customer, login with phone/email (Privy, no
   "connect your wallet"), in-store payment QR, payment alerts via Telegram, and WhatsApp
   (coming).
2. **Account abstraction (ERC-4337)** — smart accounts created on first login, bundler (Pimlico)
   + our own paymaster (`PuntosPaymaster.sol`) that sponsors the first transactions for free and
   charges the rest in PUNTOS. Login works with SMS, email or passkey (WebAuthn); in all three
   cases the smart account's signer is the same Privy embedded wallet.
3. **On-chain contracts (Arbitrum)** — the real ledger, not a database; everything that moves
   money settles in USDG:
   - `PaymentRouter.sol` — processes payments, cashback, points and self-service bodega
     registration (`registerSelf` — the bodega registry lives here, no separate
     `MerchantRegistry.sol`).
   - `PuntosPaymaster.sol` — ERC-4337 paymaster that charges gas in PUNTOS.
   - `LoyaltyPoints.sol` — points token (implemented as `PuntosToken`, ERC-20).
   - `CreditLineManager.sol` — fiado lines, limits and due dates (implemented as `FiadoScoring`
     on Stylus, with on-chain scoring **and** AI adjustment).
   - `InvoiceEscrow.sol` — fiado with partial collateral, an additional option alongside the usual
     unsecured fiado (see "InvoiceEscrow").
   - `RewardsCatalog.sol` — rewards catalog redeemable for PUNTOS, owned by each bodega and
     redeemable at any bodega in the network (see "RewardsCatalog").
   - `GroupOrders.sol` — joint purchases between bodegas to reach a distributor's minimum
     (see "GroupOrders").
   - `CreditCertificate.sol` + `CreditLine.sol` — Zero-Knowledge credit certificate
     (Circom/Groth16) and the on-chain credit line that consumes it (see
     "CreditCertificate"/"CreditLine").
4. **Backend and services** — an API orchestrating smart-account creation, contract calls,
   scoring and notifications; a database for profile/catalog/metrics and a balance cache so the UX
   feels instant; an off-chain risk engine complementing on-chain scoring.
5. **On/off ramps** — soles ↔ USDG conversion through local, licensed ramps. Settlement already
   happens in USDG (testnet); the ramp itself is roadmap, but the integration point is clear in
   the design.

```
[Customer / Shopkeeper]
       │  login with phone/email/passkey (Privy)
       ▼
[PWA / Web app] ←→ [Telegram bot] (WhatsApp: coming weeks)
       │  UserOperation (smart account, signed by the embedded wallet)
       ▼
[Bundler (Pimlico) + PuntosPaymaster.sol]
       │
       ▼
[Arbitrum Sepolia]
  - PaymentRouter (USDG payments, cashback, self-service bodega registration)
  - PuntosToken (LoyaltyPoints)
  - FiadoScoring / CreditLineManager (Stylus)
  - PuntosPaymaster (pays gas, charged in PUNTOS)
  - InvoiceEscrow, GroupOrders, CreditLine (USDG), RewardsCatalog, CreditCertificate, BeneficioToken
```

### Current MVP — what's built vs. roadmap

| Piece | Status |
|---|---|
| QR payment → cashback → points (`PaymentRouter` + `PuntosToken`) | ✅ Deployed on Arbitrum Sepolia |
| USDG settlement for every contract that moves money (`StablecoinSettlement`) | ✅ Deployed — see "USDG payments" |
| Fiado with on-chain scoring (`FiadoScoring`, Stylus) | ✅ Deployed and verified |
| Opt-in fiado per bodega (`setFiadoEnabled`/`isFiadoEnabled`) | ✅ Off by default, each bodega turns its own on |
| Per-customer fiado ledger (`extendFiado`/`repayFiado`/`payFiado`) | ✅ See "Fiado with a real debt ledger" |
| AI fiado adjustment (Claude, explained in Spanish, writes on-chain) | ✅ Working |
| AI oracle on-chain circuit breaker (`updateScoreFromAi` bounded to 2× the heuristic) | ✅ See "On-chain circuit breaker for the AI oracle" |
| Wallet-less login (Privy: phone, email or passkey) | ✅ Embedded wallet, the user never sees "wallet" or an address |
| Self-service bodega registration (`PaymentRouter.registerSelf`) | ✅ Anyone registers from the web app, no admin |
| Gas paid in PUNTOS via Account Abstraction (`PuntosPaymaster.sol`, ERC-4337) | ✅ 5 free transactions per account, bodegas always sponsored, best-effort charging — see "Frictionless gas" |
| Daily `PuntosPaymaster` health alert (gas deposit + `puntosPerEth` drift) | ✅ Vercel cron, alert only — see "Deliberate hackathon shortcuts" |
| Shopkeeper/customer as separate spaces, detected by on-chain role (`isBodega`) | ✅ See "Shopkeeper and customer are two separate spaces" |
| Shopkeeper dashboard (Inicio, Cobrar, Fiado, Crédito, Mi red) | ✅ See "Shopkeeper dashboard" |
| Bodega code via QR + short number (no visible `0x...`) | ✅ `/pagar/[code]`, permanent code |
| Off-chain storage in Upstash Redis (codes, Telegram links, locations, profiles) | ✅ File fallback in local development, daily keep-alive cron — see "Storage" |
| Payment alerts and profile (`/perfil`) on Telegram, all in soles | ✅ Webhook in production — see "The Telegram bot as a profile" |
| Amounts in soles (PEN), never ETH/USDG, with a real exchange rate | ✅ USD→PEN, see "Deliberate hackathon shortcuts" |
| Automatic test-balance faucet for new accounts | ✅ Once per account, in USDG |
| Installable app (PWA: manifest, icons, offline page, install banner) | ✅ Chrome reports it installable — see "Installable app (PWA)" |
| Map of nearby bodegas (mapcn.dev / MapLibre) | ✅ Each bodega saves its location; customers pay straight from the pin |
| `BeneficioToken` — restricted social programs (Vaso de Leche, Qali Warma, Pensión 65) | ✅ Deployed; admin issuance UI in the bodega panel + redemption UI in the customer panel |
| `InvoiceEscrow` (fiado with partial collateral) | ✅ Deployed and verified |
| `RewardsCatalog` (rewards redeemable across bodegas) | ✅ Deployed and verified |
| Joint purchases between bodegas (`GroupOrders.sol`), filtered by proximity in the frontend | ✅ Deployed and verified |
| Shopkeeper's Zero-Knowledge credit score (`CreditCertificate.sol`) | ✅ Deployed and verified — real Groth16 proof verified on-chain |
| On-chain credit line consuming the ZK certificate (`CreditLine.sol`) | ✅ Deployed and verified — less collateral the better the certified score |
| WhatsApp notifications | 🔜 Coming — stub in `app/api/whatsapp/webhook/route.ts` |
| Real soles ↔ USDG ramps | 🔜 Roadmap — integrate a conversion provider already licensed in Peru, not our own token; see "Business model" in the README |

### Target demo flow (judges)

1. The customer scans the bodega's QR code and pays in soles (settled in USDG).
2. They get a confirmation and cashback points instantly.
3. A fiado recalculation is requested — the AI analyzes the on-chain history and adjusts the
   limit, explaining why in plain Spanish.
4. Everything is verifiable on the explorer: verified contracts, real transactions.

## Setup

### Prerequisites

- Node.js + [pnpm](https://pnpm.io/)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)
- [Rust](https://rustup.rs/) + the `wasm32-unknown-unknown` target + [cargo-stylus](https://github.com/OffchainLabs/cargo-stylus)

```bash
# Rust + wasm target (the toolchain version is pinned in rust-toolchain.toml)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
rustup target add wasm32-unknown-unknown
cargo install --locked cargo-stylus

# Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Install the monorepo dependencies

```bash
pnpm install
```

### Solidity contracts

`contracts/solidity/lib/` (forge-std, OpenZeppelin, account-abstraction) isn't versioned — they're
reproducible third-party dependencies, not project code. Install them first:

```bash
cd contracts/solidity
forge install foundry-rs/forge-std@v1.9.7 --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge install eth-infinitism/account-abstraction@v0.7.0 --no-git
cd ../..
```

```bash
pnpm run contracts:build
pnpm run contracts:test
# optional: fork test against the real USDG contract
cd contracts/solidity && ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc forge test --mc PaymentRouterForkTest
```

#### Deploying the USDG stack (recommended)

`script/deploy-usdg-stack.sh` runs the whole deployment in order and is how the current contracts
were deployed (2026-10-04):

1. **On-chain pre-checks**: the RPC is Arbitrum Sepolia; the deployer owns `FiadoScoring`,
   `PuntosToken` and the previous paymaster; `FiadoScoring` accepts `setPaymentRouter`/`setEscrow`
   from the deployer (checked with `eth_call`, nothing sent); balances.
2. **`forge script DeployUsdgStack`** — deploys `PaymentRouter`, `PuntosPaymaster`,
   `InvoiceEscrow`, `GroupOrders` and `CreditLine`, sets `PuntosToken`'s minter, funds the
   paymaster's EntryPoint deposit (after recovering the old paymaster's), and repoints
   `RewardsCatalog`/`BeneficioToken` when the deployer owns them.
3. **`cast send` to `FiadoScoring`** (`setPaymentRouter`, `setEscrow`) and a read-back check.
   This can't live in the forge script: forge executes scripts in its own EVM, which can't run
   Stylus (WASM) code — any call to `FiadoScoring` reverts there with `OpcodeNotFound`. `cast`
   estimates gas on the Arbitrum node itself, which does run Stylus.
4. **Arbiscan verification** of each new contract (Etherscan API v2; non-blocking).
5. Prints the `NEXT_PUBLIC_*` values for the frontend, including
   `NEXT_PUBLIC_CONTRACTS_DEPLOY_BLOCK`.

```bash
cd contracts/solidity
# .env: PRIVATE_KEY (deployer 0x3B0e…AFbf), ARBITRUM_SEPOLIA_RPC_URL, ARBISCAN_API_KEY (etherscan.io key, API v2)
script/deploy-usdg-stack.sh              # simulation only — sends nothing
script/deploy-usdg-stack.sh broadcast    # real deployment
# PUNTOS_PER_ETH=<ETH/USD × 1e18> is optional; by default it's read from CoinGecko
```

Afterwards:

- `BeneficioToken` is owned by a smart account, not the deployer: rewire it from that account
  (Mi red → "Actualizar registro de bodegas" in the bodega dashboard).
- Bodegas register again (the new router starts with an empty `isBodega`).
- Fund the `FAUCET_PRIVATE_KEY` wallet with USDG at [faucet.paxos.com](https://faucet.paxos.com)
  (plus a little ETH for its own gas).
- Update the "Deployed contracts" table and `docs/index.html`.

The individual scripts (`RedeployPaymentRouter`, `DeployInvoiceEscrow`, `DeployGroupOrders`,
`DeployCreditLine`, `DeployPuntosPaymaster`) still work for redeploying a single contract. They
all take the stablecoin from `STABLECOIN_ADDRESS` (USDG on Arbitrum Sepolia by default), via
`script/StablecoinScript.sol`.

#### Individual deploys

Deploy to Arbitrum Sepolia from scratch (requires `contracts/solidity/.env` with `PRIVATE_KEY`,
`ARBITRUM_SEPOLIA_RPC_URL`, and an already-deployed `FIADO_SCORING_ADDRESS` — see below):

```bash
cd contracts/solidity
forge script script/Deploy.s.sol:Deploy --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
```

If `PuntosToken`/`FiadoScoring` are already deployed and only `PaymentRouter.sol` changed, use
`RedeployPaymentRouter.s.sol` instead of `Deploy.s.sol` — it reuses the existing `PuntosToken`
instead of creating a new one (which would wipe the points balance of everyone who already tried
the app):

```bash
cd contracts/solidity
PUNTOS_TOKEN_ADDRESS=<already deployed address> FIADO_SCORING_ADDRESS=<already deployed address> \
  forge script script/RedeployPaymentRouter.s.sol:RedeployPaymentRouter \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
# then: cast send <FiadoScoringAddress> "setPaymentRouter(address)" <newRouter> ...
```

`PuntosPaymaster` deploy (requires `PuntosToken` and `PaymentRouter` already deployed — the latter
as `IBodegaRegistry`, to know whom to sponsor without charging PUNTOS; EntryPoint v0.7 uses the same
canonical address `0x0000000071727De22E5E9d8BAf0edAc6f37da032` on every EVM network, already
confirmed deployed on Arbitrum Sepolia):

```bash
cd contracts/solidity
PUNTOS_TOKEN_ADDRESS=<already deployed address> PAYMENT_ROUTER_ADDRESS=<already deployed address> \
DEPOSIT_ETH=20000000000000000 PUNTOS_PER_ETH=<current ETH/USD price>000000000000000000 \
  forge script script/DeployPuntosPaymaster.s.sol:DeployPuntosPaymaster \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
```

If `PaymentRouter` is redeployed later, repoint the paymaster without redeploying it:
`cast send <PuntosPaymasterAddress> "setBodegaRegistry(address)" <newRouter> ...`. Keep the gas
rate current with `cast send <PuntosPaymasterAddress> "setPuntosPerEth(uint256)" <rate> ...`.

`BeneficioToken` deploy (requires `PaymentRouter` already deployed, used as `IBodegaRegistry`):

```bash
cd contracts/solidity
PAYMENT_ROUTER_ADDRESS=<already deployed address> \
  forge script script/DeployBeneficioToken.s.sol:DeployBeneficioToken \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
# optional: cast send <BeneficioTokenAddress> "transferOwnership(address)" <admin smart account>
```

`InvoiceEscrow` deploy (requires `PaymentRouter` and `FiadoScoring` already deployed; the latter
must support `setEscrow`/`extendFiadoFor`, added together with this contract — see "InvoiceEscrow"
above):

```bash
cd contracts/solidity
PAYMENT_ROUTER_ADDRESS=<already deployed address> FIADO_SCORING_ADDRESS=<already deployed address> \
  forge script script/DeployInvoiceEscrow.s.sol:DeployInvoiceEscrow \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
# then: cast send <FiadoScoringAddress> "setEscrow(address)" <InvoiceEscrowAddress> ...
```

`RewardsCatalog` deploy (requires `PaymentRouter` and `PuntosToken` already deployed; unlike
`InvoiceEscrow` it needs no later wiring on any other contract):

```bash
cd contracts/solidity
PAYMENT_ROUTER_ADDRESS=<already deployed address> PUNTOS_TOKEN_ADDRESS=<already deployed address> \
  forge script script/DeployRewardsCatalog.s.sol:DeployRewardsCatalog \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
```

`GroupOrders` deploy (requires only `PaymentRouter` already deployed; no later wiring on any other
contract):

```bash
cd contracts/solidity
PAYMENT_ROUTER_ADDRESS=<already deployed address> \
  forge script script/DeployGroupOrders.s.sol:DeployGroupOrders \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
```

`CreditCertificate` deploy (also deploys the auto-generated Groth16 verifier; needs no other
contract already deployed):

```bash
cd contracts/solidity
forge script script/DeployCreditCertificate.s.sol:DeployCreditCertificate \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
# then: cast send <CreditCertificateAddress> "setOraclePubKey(uint256,uint256)" <ax> <ay> ...
# (ax/ay come from frontend/lib/zkOracle.ts::getOraclePubKey() with ZK_ORACLE_PRIVATE_KEY configured)
```

`CreditLine` deploy (requires `PaymentRouter` and `CreditCertificate` already deployed):

```bash
cd contracts/solidity
PAYMENT_ROUTER_ADDRESS=<already deployed address> CREDIT_CERTIFICATE_ADDRESS=<already deployed address> \
  forge script script/DeployCreditLine.s.sol:DeployCreditLine \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
```

### ZK circuit (CreditCertificate)

```bash
cd contracts/circom-credit-certificate
npm install
npm run compile   # circom → build/creditCertificate.r1cs + .wasm
# trusted setup (reuses a public Powers of Tau — see the "CreditCertificate" section):
npx snarkjs groth16 setup build/creditCertificate.r1cs ptau/pot15_final.ptau build/creditCertificate_0000.zkey
npx snarkjs zkey contribute build/creditCertificate_0000.zkey build/creditCertificate_final.zkey
npx snarkjs zkey export solidityverifier build/creditCertificate_final.zkey build/CreditCertificateVerifier.sol
npm test   # 3 tests: valid proof, insufficient score, wrong signature
```

The artifacts the frontend needs at runtime (`creditCertificate.wasm`, `creditCertificate.zkey`,
`verification_key.json`) are already copied and committed in `frontend/circuits/` — there's no need
to regenerate them unless the circuit changes.

### Stylus contract (FiadoScoring)

```bash
pnpm run stylus:check
cd contracts/stylus-fiado-scoring && cargo test
```

> **New Stylus activations are paused on Arbitrum One, Nova and Sepolia since 2026-10-02**
> (Security Council emergency action). `cargo stylus check` reports "Stylus activations appear to
> be paused on this chain", and `cargo stylus deploy` will fail until they're re-enabled. The
> deployed `FiadoScoring` keeps working and is reused by the USDG stack.

Deploy (once activations resume; requires `contracts/stylus-fiado-scoring/.env` with `PRIVATE_KEY`
and `RPC_URL`):

```bash
cd contracts/stylus-fiado-scoring
cargo stylus deploy --private-key-path=... --endpoint=https://sepolia-rollup.arbitrum.io/rpc
```

If the constructor takes arguments, `--constructor-args` must go **at the end** of the command:
`cargo-stylus deploy` (0.10.x) has `allow_hyphen_values` enabled, so it swallows any flag that
comes after it as if it were another constructor argument.

### Frontend

```bash
cp frontend/.env.example frontend/.env.local
# fill in NEXT_PUBLIC_*_ADDRESS with the deployed addresses,
# ANTHROPIC_API_KEY and ORACLE_PRIVATE_KEY (testnet); NEXT_PUBLIC_STABLECOIN_ADDRESS is optional
# (defaults to USDG on Arbitrum Sepolia)
pnpm run dev
```

Wallet-less login and gas paid in PUNTOS need two more free accounts (created by whoever operates
the project, never pasted into a chat):

- [dashboard.privy.io](https://dashboard.privy.io) — create an app, restrict the login methods to
  email + SMS (+ passkey), copy the public App ID into `NEXT_PUBLIC_PRIVY_APP_ID`.
- [dashboard.pimlico.io](https://dashboard.pimlico.io) — free testnet API key, into
  `NEXT_PUBLIC_PIMLICO_API_KEY`.
- `NEXT_PUBLIC_PUNTOS_PAYMASTER_ADDRESS` — the address of the `PuntosPaymaster` deployed above.

Tests (Vitest, offline — the KV file fallback runs in a temp dir and chain reads are mocked):

```bash
cd frontend
pnpm test
```

### CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: frontend type
check (`next typegen` + `tsc`), `pnpm test` and lint; `forge test` (installing the Foundry
libraries at the versions above; the fork test skips itself without an RPC URL); and `cargo test`
for `FiadoScoring`. The circuit tests (`contracts/circom-credit-certificate`) aren't in CI because
they need the `circom` binary and a compile step.

## Regenerating ABIs for the frontend

```bash
cd contracts/solidity
for c in PaymentRouter PuntosToken InvoiceEscrow GroupOrders CreditLine RewardsCatalog BeneficioToken CreditCertificate; do
  forge inspect $c abi --json | python3 -c "import json,sys; json.dump({'abi': json.load(sys.stdin)}, open('../../frontend/lib/abis/$c.json','w'), indent=2)"
done
cd ../stylus-fiado-scoring && cargo stylus export-abi --json   # copy the output array into
                                                               # ../../frontend/lib/abis/FiadoScoring.json,
                                                               # wrapped in {"abi": [...]}
```

`cargo stylus export-abi` needs `solc` on the `PATH` (Foundry downloads it via svm but doesn't
expose it under that exact name):

```bash
ln -sf ~/.local/share/svm/0.8.26/solc-0.8.26 ~/.local/share/svm/0.8.26/solc
export PATH="$HOME/.local/share/svm/0.8.26:$PATH"
```

**Important:** stylus-sdk's `#[public]` macro automatically converts Rust's snake_case function
names to camelCase when exporting the Solidity ABI (e.g. `record_payment` → `recordPayment`).
`contracts/solidity/src/interfaces/IFiadoScoring.sol` already uses the correct camelCase names — if
you change the Rust contract's public API, regenerate the ABI and update the Solidity interface so
they match.
