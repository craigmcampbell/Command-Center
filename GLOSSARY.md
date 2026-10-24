# Command Center

A personal desktop dashboard. This glossary currently covers the debt paydown planning area only.

## Language

### Debt paydown

**Debt**:
Any balance being paid down: a credit card, a loan, or anything else with a balance, APR and minimum payment. May optionally link to a Card and/or a YNAB account for its live balance.
_Avoid_: Account, liability

**Carried Balance**:
The part of a Debt's balance that is being paid down and accrues interest. This is the only balance the Plan projects.
_Avoid_: Revolving balance, plan balance

**Pay-in-full Spending**:
Current charges on a card that are cleared in full each month and so are excluded from the Plan. Taken from this month's spending in YNAB for a linked Debt, or typed by hand. Carried Balance is the live balance owed minus this amount, never below zero.
_Avoid_: Transactor spend, statement balance

**Card**:
A manually-tracked credit card in the Finances tab, used for utilization tracking. Distinct from a Debt, though a Debt may link to one.
_Avoid_: Credit account

**Minimum Payment**:
The issuer's required monthly minimum on a Debt's Carried Balance, paid regardless of Strategy. Always manually entered; payments for Pay-in-full Spending are never part of it.
_Avoid_: Monthly payment, planned payment

**Extra Payment**:
The additional amount per month, on top of all Minimum Payments, directed by the Strategy.
_Avoid_: Surplus, snowball amount

**One-time Payment**:
A dated, month-granular lump sum paid toward either the Strategy's current focus Debt or a specific Debt.
_Avoid_: Lump sum, bonus payment

**Strategy**:
The rule that decides which Debt receives the Extra Payment first: Snowball (smallest balance), Avalanche (highest APR), or Custom order.
_Avoid_: Method, plan type

**Baseline**:
The Minimums-only projection (no Extra Payment, no Rollover) that every Strategy is compared against.
_Avoid_: Default, control

**Rollover**:
When a Debt is paid off, its Minimum Payment joins the Extra Payment and moves to the next target Debt.
_Avoid_: Snowball effect, cascade

**Payoff Date**:
The month a given Debt reaches zero; the latest of these is the debt-free date.
_Avoid_: End date

**Plan**:
The single set of inputs for the paydown projection: Debts, Extra Payment, One-time Payments, and selected Strategy.
