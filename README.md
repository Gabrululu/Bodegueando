# Bodegueando

Bodegueando digitizes the Peruvian neighborhood corner store (the *bodega*) without asking it
to change how it gets paid. The bodega keeps accepting cash, Yape or Plin just as it does today.
Bodegueando doesn't compete with those methods, it adopts them: on top of every sale it adds a
layer of verifiable history, open cashback and, over time, a financial score that simply
doesn't exist today for any business this size.

Built and tested live on Arbitrum Sepolia: deployed and verified contracts, real transactions,
no simulated environment. For the full technical detail — contracts, mechanisms, deployed
addresses, tests, live runs and setup — see [**ARCHITECTURE.md**](./ARCHITECTURE.md). For a
one-page visual summary with a diagram (English / Spanish), see
[gabrululu.github.io/Bodegueando](https://gabrululu.github.io/Bodegueando/).

## Detailed description

How it works, component by component:

**1. Payment and record.** The customer scans a QR code or types the bodega's short 6-digit
number (they never see a wallet address) and pays in soles from their phone. Under the hood the
payment settles in **USDG**, Paxos' regulated stablecoin, straight from the customer to the
bodega. Every payment is recorded on-chain, permanently and verifiably, regardless of whether
the money first moved through cash or a digital wallet: that record layer is exactly what
doesn't exist anywhere today.

**2. Open cashback.** Every payment automatically mints points worth 2% of the amount — just
like the cashback of a chain such as Sip, but without having to belong to any corporate group:
any bodega signs up and starts giving points from day one. Points are a token the contract
mints on each transaction, not cash leaving the platform. 1 PUNTO is worth 1 USD of cashback,
and the app always shows its value in soles.

**3. History and financial score.** Every payment feeds an on-chain, per-bodega reputation
calculation — punctuality, volume, recurrence — that runs on Stylus because of the amount of
computation involved in recalculating it on every transaction. That history is the basis for
two things: first, a store-credit (*fiado*) limit the bodega can turn on if it wants to extend
credit to a specific customer (off by default, their call); second, and more importantly, the
input for the business's own financial score — the objective proof of soundness that no bodega
can show a microlender today. An AI can suggest adjustments to that history, bounded by a
mechanism in the contract itself that prevents it from proposing a jump larger than twice what
the real data justifies. That history can also already be turned into a Zero-Knowledge credit
certificate ("my score ≥ 700" without revealing the exact number) that a bank validates in one
click, and consumed directly by an on-chain credit line that asks for less collateral the better
the proven score — see ARCHITECTURE.md, CreditCertificate/CreditLine sections.

**4. Frictionless onboarding.** Users sign in with their phone number, email or passkey,
without creating or understanding a wallet. Each person has a smart account (ERC-4337) whose gas
is paid with their own cashback points — never with separate money, just as there's no
"network fee" in Yape or Plin. The bodega is deliberately a different case: since it doesn't
earn cashback for receiving payments (cashback belongs to the buyer), its own actions (turning
on fiado, extending credit to a customer, publishing a reward) are always sponsored by the
platform, without touching points — it never has to think about gas, period.

**5. Notifications.** A Telegram bot tells the shopkeeper when they get paid and shows their
profile — sales, trust level, available fiado — all in soles. (WhatsApp is coming in the next
few weeks — that's why Telegram shipped first: same goal, available right away.)

Around that core, the platform already adds further pieces built on the same on-chain history:
store credit with partial collateral (`InvoiceEscrow`) for amounts where the bodega prefers to
ask for a deposit, a rewards catalog redeemable for points at any bodega in the network
(`RewardsCatalog`), joint purchases between nearby bodegas — from the same area, not anywhere in
the city — to reach a distributor's minimum order (`GroupOrders`), a map of nearby bodegas, and
an initial path for social programs restricted to being spent only at registered bodegas
(`BeneficioToken`). Full detail on each in ARCHITECTURE.md.

The result isn't a new way to pay, but the missing trust infrastructure behind a kind of
commerce that already spans more than 500,000 businesses in Peru — many of them a family's only
livelihood, and present exactly where formal retail never opens a branch.

## How we use Arbitrum

Bodegueando uses Arbitrum in two distinct layers — not as an isolated technical detail but as
the foundation that makes the whole model viable.

**1. Standard Solidity contracts on Arbitrum.** `PaymentRouter` (processes every payment in
USDG and triggers cashback), `PuntosToken` (the points ERC-20) and `PuntosPaymaster` (an
ERC-4337 paymaster that lets users pay gas in points instead of ETH) — and, following the same
pattern, `InvoiceEscrow`, `RewardsCatalog`, `GroupOrders`, `BeneficioToken`,
`CreditCertificate` and `CreditLine` — run on Arbitrum because of its full compatibility with
EVM tooling (Foundry, viem, ERC-4337 bundlers like Pimlico) and, above all, because of cost: a
bodega charges S/5 to S/20 per sale; on an L1 the network fee could exceed the value of the sale.
On Arbitrum the cost per transaction is a fraction of a cent — for the first time, getting paid
through a blockchain is cheaper than a traditional card terminal (2.5%–3.5% fee), not more
expensive.

**2. The fiado calculation, specifically on Arbitrum Stylus (Rust).** `FiadoScoring` is the only
contract not written in Solidity, and not for aesthetic reasons: every payment triggers a
recalculation of the score (average punctuality, accumulated volume, cross-bodega reputation
aggregates) — repeated arithmetic over several accumulators on every transaction. That
computation is substantially more expensive in plain EVM than compiled to WASM. Stylus is today
the only way to have that calculation running on-chain — not in a centralized backend, which
would break the product's core property: that the credit history is verifiable and tamper-proof
— without gas making every payment impractical. On every adjustment, the same contract also
checks that the AI's recommendation never exceeds twice what the real history would justify
(our "circuit breaker").

**Why "being on a compatible network" isn't enough on its own.** If Bodegueando only needed to
move tokens, any L2 would do and the use of blockchain would be superficial. What makes Arbitrum
— and Stylus in particular — a real choice is that the product needs low costs for the use case
to be economically viable, and non-trivial on-chain computation for the scoring engine, which
on a generic EVM would be too expensive to run on every payment. Both are proven today against
deployed and verified contracts on Arbitrum Sepolia, not in a simulated environment.

## Problem and impact

The problem, bluntly: a neighborhood bodega today gets paid in cash, Yape or Plin — almost none
accept cards — but that daily flow leaves no trace that's useful beyond the moment of the sale.
Nothing connects those transactions to proof that the business is sound, nor to the other
businesses on the same block, nor to anyone who could trust it on that basis.

This matters more than it seems, because these aren't just any shops: for whoever opened them,
they're often a whole family's livelihood, and they're usually exactly where formal commerce —
supermarkets, chains, banks — never reaches. That reach already exists; what's missing is the
infrastructure to make use of it.

Several concrete problems follow from that, all with the same root:

- **Unequal loyalty programs.** A chain like Sip can offer cashback because all its stores
  belong to the same group and subsidize each other. An independent bodega has no way to offer
  anything similar — it competes against that perk with no equivalent tool.
- **Zero verifiable history.** Everything that proves the business works (that it sells, that
  customers come back, that the credit it extends gets repaid) lives in the shopkeeper's memory.
  When they look for a working-capital loan from a microlender, they're turned down or offered
  the minimum — not because the business is weak, but because they have nothing to back it up in
  front of a credit analyst.
- **Social programs that don't reach people well.** Programs like Vaso de Leche or municipal
  programs depend on intermediaries to distribute benefits in neighborhoods where, again, the
  bodega is the closest point — but today there's no verifiable record of those businesses to
  make that distribution easier.
- **Formalization paperwork left pending.** Not every bodega has its municipal permits up to
  date, often simply because the process is slow or unclear, not because they don't want to
  operate by the rules.
- **Inefficient wholesale purchasing.** Each bodega negotiates alone with distributors, who
  sometimes send a sales rep store by store — a real cost that ends up making the product more
  expensive — or the bodega has to travel to a wholesaler. On the same block, several bodegas
  make that trip separately, and they don't even stock the same products.

**What Bodegueando does.** It doesn't compete with cash, Yape or Plin — it adopts them: the
bodega keeps getting paid the way it already does, and on top of that it gains a layer of
history, open cashback (without depending on any corporate group) and verification, all
recorded on-chain in a way no one can alter. That history, built up passively sale after sale,
is the foundation for the bodega's financial score — the asset that doesn't exist today and that
it can already show a microlender without exposing its actual sales line by line, thanks to the
Zero-Knowledge credit certificate.

The rest of the problem shares the same underlying solution — once a verifiable record of active
bodegas and their real location exists: social programs have someone to distribute benefits to
directly and traceably; a registered bodega has a clearer starting point to regularize its
permits; several bodegas in the same neighborhood can pool their orders to a wholesaler and
receive them at a single drop-off point, instead of separate trips or visits; and that same
neighborhood presence — the person behind the counter who already knows the families on the
block — can turn the bodega into an alert point for community safety, something nobody is taking
advantage of today.

**Expected impact:** more than 500,000 bodegas in Peru operate today without any digital
infrastructure backing them, while being the closest store to millions of families who live day
to day. Digitizing what they already do — without asking them to change how they get paid — is
the foundation for that history to eventually turn into real credit, better-distributed social
programs, and neighborhood businesses in a stronger position against what today only the big
chains have.

## Business model

Bodegueando doesn't charge the bodega for what brings it to the platform today: getting paid,
earning points and building its history are free for the bodega, and will stay that way.
Charging a per-transaction fee — even one lower than a traditional terminal's 2.5%–3.5% — would
break the project's core promise: that the bodega gains, rather than pays, for leaving a
verifiable record of its own business. No platform revenue can come out of the shopkeeper's
pocket for their daily sales.

So where does the money come from to cover what does cost money to operate (sponsored gas on
Arbitrum via `PuntosPaymaster`, AI oracle compute, infrastructure)? From actors other than the
shopkeeper-selling, each paying for real new value that Bodegueando creates for them:

1. **Banks and microlenders pay to query the credit certificate**, not the bodega. It's the same
   model that already operates today: in Peru, Equifax/Infocorp doesn't charge consumers for
   their own history (they get one free report a year, by law) — it charges the banks, insurers
   and lenders that query the report to decide whether to lend. The bodega generates and uses its
   certificate for free; a financial institution that wants to validate "score ≥ 700" before
   lending pays for that query, just as it already pays a traditional credit bureau — only with
   data that bureau doesn't have today, because it never existed.
2. **A small spread on `CreditLine` interest, only when the bodega chooses to borrow.** It's an
   optional loan, never a condition for selling — a new service (credit with less collateral
   thanks to its history) that doesn't exist for this segment today at any price. The contract
   already charges a fixed interest that today goes 100% back to the lenders' pool; keeping a
   small portion of that interest costs the bodega nothing more compared to its real
   alternative today: no access to credit, or paying much more for it informally.
3. **Distributors pay a brokerage fee on joint purchases (`GroupOrders`), not bodegas.** Today a
   distributor spends money sending a sales rep store by store to collect small orders — a real
   cost it already pays. Bodegueando hands it demand already aggregated from several bodegas in
   the same area: charging a fee lower than what it currently spends on door-to-door sales is new
   value for the distributor, not a cost for the bodega, which comes out ahead anyway with a
   better price.
4. **Social programs (national or municipal government) pay an administration fee**, not the
   beneficiary or the bodega. Leakage — benefits reaching people they're not meant for — in
   programs like Vaso de Leche has exceeded 70% in Lima according to Peru's Ministry of Economy
   and Finance (MEF): a very expensive problem for the State. An administration fee on
   `BeneficioToken`, far below what is lost today to leakage and intermediaries, is a net saving
   for the program, not a new cost for anyone else.

What Bodegueando will never charge: a per-transaction fee to get paid (the heart of the promise
versus a traditional terminal), a fee for earning or redeeming cashback points (they belong to
the bodega and the customer, not the platform), or a fee for building or querying one's own
history and score.

**Honesty note:** none of these four revenue mechanisms is switched on in the deployed contracts
today — `CreditLine.sol` returns 100% of the interest to the lenders' pool, with no protocol cut,
and there's no on-chain fee for banks, distributors or social programs yet. Switching them on is
simple (a protocol constant in the contract, or an off-chain charge for B2B/B2G queries), but it
was deliberately left out of this first version: build the infrastructure and the trust first,
charge for what generates real new value later — never the other way around.

### The infrastructure to charge already exists — it's not just a plan

The four mechanisms above aren't a wish list: each one already has the contract that supports
it, deployed and tested on Arbitrum Sepolia — turning on revenue means flipping a switch on
something that already works, not building it from scratch.

- **Mechanism 1 (certificate queries)** — `CreditCertificate.sol` already issues the ZK
  certificate and `getCertifiedThreshold` is already the public view a financial institution
  would query; all that's missing is charging for that query, which can live off-chain (a
  B2B/B2G API) without touching the contract.
- **Mechanism 2 (`CreditLine` spread)** — the loan pool, the score-based collateral tiers and
  the fixed interest charge (5%) already exist and were tested live with a real loan that was
  repaid; all that's missing is a protocol constant that keeps a portion of that interest instead
  of returning 100% to the pool.
- **Mechanism 3 (`GroupOrders` fee)** — the full flow of pledging, reaching the goal and
  withdrawing was already tested live with real funds moving between bodegas; all that's
  missing is a protocol percentage on the withdrawal.
- **Mechanism 4 (`BeneficioToken` fee)** — issuance, expiry and the restriction to spend only at
  registered bodegas already work; all that's missing is an administration fee, charged to the
  social program that issues it, not to the beneficiary.

**Why mechanism 1 is the first to switch on in practice.** Of the four, it's the one that depends
least on accumulated volume or an external partner: it doesn't need deep liquidity like
mechanism 2, a logistics agreement with a distributor like 3, or a government agreement like 4.
As soon as there are real bodegas with real certificates, a single financial institution willing
to pay to query a score is enough to start generating revenue — without touching or redeploying
any other contract in the product.

**The real cost to cover in the meantime.** Charging zero per transaction is the project's core
promise, but operating isn't free: sponsored gas (`PuntosPaymaster`) and, in the future, the cost
of converting real soles into and out of the app (see below) are real platform expenses from day
one, with no revenue covering them yet. That gap is closed with seed or program capital (not with
a fee on the shopkeeper) until mechanism 1 — the fastest of the four — starts generating real
revenue.

### Moving to real soles adds no cost to anyone

Everything that moves money in Bodegueando (payments, collateral-backed fiado, joint purchases
and the credit line) already settles in **USDG**, Paxos' regulated stablecoin, instead of testnet
ETH (see "USDG payments" in ARCHITECTURE.md). Users never see dollars or USDG: the app shows and
takes everything in soles and converts at the day's rate. The missing step is for those soles to
actually flow into and out of the app, and the plan isn't to build a bank or issue our own
currency — it's to **integrate with a soles↔USDG conversion provider already licensed to operate
in Peru**, evaluated when the time comes without committing to a specific one today. Building
that piece from scratch (license, own reserves, attestation) is a project of a different scale,
with real regulatory risk; integrating with one that already exists is what can realistically be
switched on in a reasonable timeframe.

That change of asset **doesn't touch the cashback mechanism at all.** The points a customer earns
on each purchase never come out of the amount they pay or out of what the bodega receives —
`PaymentRouter` mints them separately, as new supply, exactly like an airline miles program or a
store's loyalty stamp card: nobody overpays for them to exist. That's true today with USDG and
stays true the day real soles come in through a ramp — the code that mints PUNTOS doesn't change,
because it never depended on which asset was used to pay.

The only thing that does have a real cost in that change is the conversion itself (the
on/off-ramp provider charges a margin, like any currency exchange) — and Bodegueando already has
the pattern to absorb it without the user noticing: the same one it uses today for gas.
`PuntosPaymaster` already pays a real cost (gas on Arbitrum) for every transaction and hides it
from the user, with the platform sponsoring it instead of charging for it — tested live, not in
theory. The on/off-ramp margin can be absorbed with the same logic: a platform operating cost,
never a fee visible to the shopkeeper or the buyer. Whoever pays keeps seeing exactly what they
see today — an amount in soles and a button — no matter what happens underneath.

*Sources: [Equifax Peru — Infocorp report](https://www.equifax.pe/personas/productos/reporte-infocorp-credito/)
(model of charging financial institutions; free annual consumer report under Law 27489); MEF,
"Caracterización del Programa del Vaso de Leche" and social policy reviews (benefit leakage).*

## Current status

Everything described above is deployed and verified on Arbitrum Sepolia, with automated tests
and live runs with real (not simulated) transactions: payments with cashback, fiado with a real
debt ledger, the AI oracle's on-chain circuit breaker, collateral-backed fiado, rewards catalog,
joint purchases between bodegas, ZK credit certificate and the on-chain credit line that consumes
it, wallet-less login with gas paid in points, Telegram bot, and a map of nearby bodegas.

USDG settlement for every contract that moves money is implemented and tested (unit, fuzz and an
Arbitrum Sepolia fork test against the real USDG contract) and is being redeployed to Arbitrum
Sepolia with `script/DeployUsdgStack.s.sol`. Coming next: WhatsApp notifications (next few
weeks). Pending on third parties: real soles ↔ USDG ramps.

The detail of each piece — mechanism, what it deliberately does NOT solve, test coverage, and the
live run with real transaction hashes — is in [**ARCHITECTURE.md**](./ARCHITECTURE.md).
