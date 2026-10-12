# BEHAVIOUR_SCORE.md — Payment Behaviour Score

## Related Documents

- `docs/modules/loans/LOANS.md` — loan module overview
- `docs/modules/loans/APPLICATION.md` — score calculated during submission
- `docs/modules/loans/LENDER_INTEGRATION.md` — score shared with lenders
- `docs/DATABASE.md` — private.loan_applications behaviour_score fields
- `docs/modules/fees/PAYMENTS.md` — payment history that feeds the score
- `docs/modules/fees/FEE_STRUCTURES.md` — fee records that feed the score

---

## Implementation Status (2026-10-11)

**Built as `calculate_behaviour_score()`**, and the score is stored on the application
alongside `behaviour_score_breakdown` — the breakdown, not just the number.

That matters and is worth keeping: this document gives a parent the right to understand
their score, and `/parent/loans` shows every category and its weight rather than a bare
figure. A credit-shaped number a parent cannot interrogate is the thing this section
exists to prevent.

The score is recorded **at the time of application** rather than recomputed on read, so a
declined application still explains itself months later against the score the lender
actually saw.

---

## Purpose

This document defines the complete payment behaviour score — its factors, weighting, calculation algorithm, score bands, how it is presented to parents and lenders, and the ethical constraints governing its use. Every Claude Code session implementing or modifying the score algorithm must read this document in full.

---

## Overview

The payment behaviour score is ZSMS's proprietary indicator of a parent's fee payment reliability. It is calculated from observed payment behaviour within the ZSMS system and shared with lending partners to help them assess loan applications. It is explicitly not a credit score, not a creditworthiness determination, and AfriTech is not a credit bureau.

The score operates on a 300–850 scale — the same range as South African credit scores — to be immediately interpretable by lenders familiar with that market. This range also future-proofs the score for when ZSMS registers as an MFI and the score becomes a formal input to lending decisions.

---

## Score Scale

| Range | Band | Label | Meaning for Lender |
|---|---|---|---|
| 750–850 | Excellent | Strong payment history | Preferred rate; minimal additional verification |
| 650–749 | Good | Consistent payment history | Standard rate; standard verification |
| 550–649 | Fair | Some payment delays | Slightly higher rate; enhanced documentation |
| 450–549 | Poor | Significant delays | Case-by-case; manual underwriter review |
| 300–449 | Very Poor | Multiple unpaid balances | Decline or refer to specialised product |
| 500 | Neutral | No history | Default when insufficient data exists |

---

## Scoring Factors

The score is composed of four categories. Each category produces a sub-score from 0–100, then weighted to produce the composite score on the 300–850 scale.

### Category 1 — Payment History (35% weight)

Measures how reliably the parent has paid fees when due.

```typescript
interface PaymentHistoryInputs {
  totalFeeRecords: number           // All fee records ever generated for this parent's children
  paidOnTime: number                // Paid before or on due_date
  paidWithin7Days: number           // Paid 1-7 days late
  paidWithin14Days: number          // Paid 8-14 days late
  paidWithin30Days: number          // Paid 15-30 days late
  paidAfter30Days: number           // Paid more than 30 days late
  neverPaid: number                 // Still outstanding (excluding current term)
  rejectedPayments: number          // Submissions that were rejected
  queriedPayments: number           // Submissions that required querying
  reversals: number                 // Payments that were reversed
}

function scorePaymentHistory(inputs: PaymentHistoryInputs): number {
  if (inputs.totalFeeRecords === 0) return 50  // No history — neutral

  const weights = {
    onTime: 100,
    within7: 85,
    within14: 65,
    within30: 40,
    after30: 15,
    neverPaid: 0,
  }

  const weightedSum =
    (inputs.paidOnTime      * weights.onTime) +
    (inputs.paidWithin7Days * weights.within7) +
    (inputs.paidWithin14Days * weights.within14) +
    (inputs.paidWithin30Days * weights.within30) +
    (inputs.paidAfter30Days  * weights.after30) +
    (inputs.neverPaid        * weights.neverPaid)

  const maxPossible = inputs.totalFeeRecords * 100
  let score = (weightedSum / maxPossible) * 100

  // Penalties
  score -= inputs.rejectedPayments * 3  // Each rejected submission -3 points
  score -= inputs.queriedPayments  * 1  // Each queried submission -1 point
  score -= inputs.reversals        * 5  // Each reversal -5 points

  return Math.max(0, Math.min(100, score))
}
```

### Category 2 — Payment Capacity (25% weight)

Estimates financial stability relative to fee obligations.

```typescript
interface PaymentCapacityInputs {
  declaredMonthlyIncome: number | null  // From previous loan applications (if any)
  totalMonthlyFees: number              // Sum of active fee obligations
  numberOfEnrolledChildren: number
  boardingStudents: number              // Higher fees = higher income proxy
  currentOutstandingTotal: number       // Total currently unpaid across all children
}

function scorePaymentCapacity(inputs: PaymentCapacityInputs): number {
  let score = 50  // Start neutral

  // Fee-to-income ratio (if income declared)
  if (inputs.declaredMonthlyIncome && inputs.declaredMonthlyIncome > 0) {
    const feeToIncomeRatio = inputs.totalMonthlyFees / inputs.declaredMonthlyIncome
    if (feeToIncomeRatio < 0.15)       score += 20  // Fees < 15% of income — comfortable
    else if (feeToIncomeRatio < 0.25)  score += 10  // Fees 15-25% — manageable
    else if (feeToIncomeRatio < 0.35)  score += 0   // Fees 25-35% — stretched
    else if (feeToIncomeRatio < 0.50)  score -= 10  // Fees 35-50% — tight
    else                               score -= 20  // Fees > 50% — high risk
  }

  // Boarding school proxy (indicates higher disposable income)
  if (inputs.boardingStudents > 0) score += 5

  // Number of enrolled children (higher commitment = demonstrated ability)
  if (inputs.numberOfEnrolledChildren >= 2) score += 5
  if (inputs.numberOfEnrolledChildren >= 3) score += 5

  // Current outstanding penalty
  if (inputs.currentOutstandingTotal > 0) {
    const outstandingMonths = inputs.currentOutstandingTotal / (inputs.totalMonthlyFees || 1)
    score -= Math.min(20, outstandingMonths * 10)
  }

  return Math.max(0, Math.min(100, score))
}
```

### Category 3 — Account Behaviour (20% weight)

Measures engagement and responsiveness within the ZSMS platform.

```typescript
interface AccountBehaviourInputs {
  monthsOnZsms: number                // How long the parent has had a ZSMS account
  portalLoginsLast90Days: number      // Portal/app logins in last 90 days
  whatsappOptedIn: boolean            // Whether they receive WhatsApp messages
  hasPreviouslyRepaidZsmsLoan: boolean // Previously completed a ZSMS-facilitated loan
  averageRemindersBeforePayment: number // Average number of reminders sent before payment
}

function scoreAccountBehaviour(inputs: AccountBehaviourInputs): number {
  let score = 50

  // History length (more data = more confidence)
  if (inputs.monthsOnZsms >= 24)      score += 15
  else if (inputs.monthsOnZsms >= 12) score += 10
  else if (inputs.monthsOnZsms >= 6)  score += 5
  else if (inputs.monthsOnZsms < 3)   score -= 10

  // Portal engagement (active users are more reachable)
  if (inputs.portalLoginsLast90Days >= 10)   score += 10
  else if (inputs.portalLoginsLast90Days >= 3) score += 5
  else if (inputs.portalLoginsLast90Days === 0) score -= 5

  // WhatsApp opt-in (reachable for collections)
  if (inputs.whatsappOptedIn) score += 5

  // Prior loan repayment (strongest positive signal)
  if (inputs.hasPreviouslyRepaidZsmsLoan) score += 15

  // Reminder dependency (higher reminders needed = lower score)
  if (inputs.averageRemindersBeforePayment === 0)      score += 10
  else if (inputs.averageRemindersBeforePayment <= 1)  score += 0
  else if (inputs.averageRemindersBeforePayment <= 2)  score -= 5
  else                                                  score -= 15

  return Math.max(0, Math.min(100, score))
}
```

### Category 4 — Risk Indicators (20% weight)

Flags specific risk patterns that lenders need to know about.

```typescript
interface RiskIndicatorInputs {
  activeLoans: number                   // Current non-repaid ZSMS loans
  activeApplications: number           // Currently pending applications
  disputedPayments: number             // Payments that were formally disputed
  schoolSwitches: number               // Times student transferred between schools
  feesWaived: number                   // Times fees were waived (may indicate hardship)
  maximumSingleOverdueDays: number     // Worst single overdue period (days)
  incomeConsistency: 'consistent' | 'variable' | 'unknown'
  // Based on declared income across multiple applications
}

function scoreRiskIndicators(inputs: RiskIndicatorInputs): number {
  let score = 70  // Start above neutral — most parents without flags score well here

  // Active loan exposure
  if (inputs.activeLoans >= 2)         score -= 20
  else if (inputs.activeLoans === 1)   score -= 5

  // Pending applications (over-application signal)
  if (inputs.activeApplications >= 2)  score -= 15

  // Disputed payments (strong negative)
  score -= inputs.disputedPayments * 10

  // Maximum overdue period (worst case matters to lenders)
  if (inputs.maximumSingleOverdueDays > 90)   score -= 20
  else if (inputs.maximumSingleOverdueDays > 60) score -= 10
  else if (inputs.maximumSingleOverdueDays > 30) score -= 5

  // Income consistency (from prior applications)
  if (inputs.incomeConsistency === 'consistent') score += 10
  else if (inputs.incomeConsistency === 'variable') score -= 5

  // Waivers (may indicate genuine hardship rather than non-payment)
  if (inputs.feesWaived > 0 && inputs.disputedPayments === 0) {
    score -= 3  // Small penalty only — waivers may be legitimate
  }

  return Math.max(0, Math.min(100, score))
}
```

---

## Composite Score Calculation

```typescript
function calculateBehaviourScore(
  parentUserId: string,
  schoolId: string
): Promise<{ score: number; band: string; breakdown: ScoreBreakdown }> {

  // Fetch all inputs from database
  const [historyData, capacityData, behaviourData, riskData] =
    await Promise.all([
      getPaymentHistoryData(parentUserId),
      getPaymentCapacityData(parentUserId),
      getAccountBehaviourData(parentUserId),
      getRiskIndicatorData(parentUserId),
    ])

  // Calculate category scores (0-100)
  const historyScore   = scorePaymentHistory(historyData)
  const capacityScore  = scorePaymentCapacity(capacityData)
  const behaviourScore = scoreAccountBehaviour(behaviourData)
  const riskScore      = scoreRiskIndicators(riskData)

  // Weighted composite (0-100)
  const compositeRaw =
    (historyScore   * 0.35) +
    (capacityScore  * 0.25) +
    (behaviourScore * 0.20) +
    (riskScore      * 0.20)

  // Map 0-100 to 300-850
  const score = Math.round(300 + (compositeRaw / 100) * 550)

  const band = getScoreBand(score)

  return {
    score,
    band,
    breakdown: {
      payment_history:   { score: historyScore,   weight: 0.35 },
      payment_capacity:  { score: capacityScore,  weight: 0.25 },
      account_behaviour: { score: behaviourScore, weight: 0.20 },
      risk_indicators:   { score: riskScore,      weight: 0.20 },
    }
  }
}
```

---

## Minimum Data Requirements

| Condition | Score Behaviour |
|---|---|
| Parent has fewer than 2 fee records | Score = 500 (Neutral) — insufficient data |
| Parent has no payment history (all current term) | Score = 500 (Neutral) |
| Parent has 2-5 fee records | Score calculated with 70% confidence weight applied |
| Parent has 6+ fee records | Full score calculated |

When `score = 500` is returned due to insufficient data, the lender sees: "Insufficient payment history — 500 (Neutral). Minimum 6 months of history recommended for full assessment."

---

## Score Presentation

### To Parents

Parents see the score in plain language — not the raw number (to avoid gaming):

```
Your Payment History Rating

⭐⭐⭐⭐☆  Good (650–749)

"You have a consistent fee payment history.
This is a positive indicator for your loan application."

Factors that help your rating:
✓ Fees usually paid within 14 days of due date
✓ Active portal user
✓ 18 months of payment history on ZSMS

Factors that could improve your rating:
→ 2 fees were paid more than 30 days late in 2025
→ 1 payment submission was queried

Your rating is shared with Madison Finance as part of your application.
```

Parents are shown qualitative factors — not raw numbers — to prevent gaming and to focus on actionable information.

### To Lenders

Lenders receive the full breakdown in the loan application package:

```
PAYMENT BEHAVIOUR SCORE

Composite Score: 687 (Good)
Scale: 300 (Very Poor) — 850 (Excellent)
Calculated: 15 Sep 2026 · Based on 24 months of history

Category Breakdown:
Payment History (35%):   82/100  ──────────────────░░░░  Strong
Payment Capacity (25%):  68/100  ──────────────░░░░░░░░  Good
Account Behaviour (20%): 71/100  ──────────────░░░░░░░░  Good
Risk Indicators (20%):   74/100  ───────────────░░░░░░░  Good

Key Data Points:
- Total fee records assessed: 24
- On-time payments: 18 of 24 (75%)
- Average days late when late: 8.3 days
- Active ZSMS history: 24 months
- Portal logins (last 90 days): 12
- Active loans: 0
- Previous ZSMS loan repaid: No (first application)

IMPORTANT: This score reflects payment behaviour within the ZSMS
school fee management platform only. It is not a credit bureau score
and does not incorporate data from external financial institutions.
AfriTech Systems Limited is not a registered credit bureau.
```

---

## Ethical Constraints and Legal Position

**ZSMS is not a credit bureau.** The behaviour score is an internal indicator based on ZSMS platform data only. It does not incorporate data from other sources (banks, mobile money, other lenders).

**The score must be explainable.** Every factor in the score maps to a documented business reason. No black-box machine learning. When ZSMS registers as an MFI, the regulator will ask for the scoring methodology — this document is the answer.

**The score must not discriminate.** No factor in the score uses: gender, ethnicity, religion, location, school type (as a direct proxy for race or ethnicity), or any protected characteristic. School type is used only as a proxy for income level — a recognised and legally acceptable actuarial practice.

**The score is a snapshot.** It is calculated fresh at application time and stored as a snapshot. It is not a continuously updated attribute of the parent's profile. A parent who pays their arrears and improves their behaviour will see a better score on their next application.

**Parents have the right to understand their score.** The parent-facing score display above satisfies this requirement. If a parent disputes their score, they can contact AfriTech support who can explain the calculation using the breakdown stored in `loan_applications.behaviour_score_breakdown`.

---

## Business Rules

1. The score is always calculated server-side. No client-submitted score is accepted.
2. The score is calculated at application submission time and stored as a snapshot in `private.loan_applications.behaviour_score` and `behaviour_score_breakdown`. It is never recalculated after submission.
3. The minimum score on the scale is 300 and the maximum is 850. No score outside this range is produced.
4. When insufficient data exists (fewer than 6 fee records), the score is set to 500 (Neutral) and the lender is notified of the reason.
5. The score breakdown is stored in JSONB and can be retrieved by AfriTech loan officers for dispute resolution. It is never exposed directly to parents — only the qualitative explanation.
6. The score must never incorporate protected characteristics (gender, ethnicity, religion, location of school) as direct factors.

---

## Future Development (Phase 3 — ZSMS as MFI)

When ZSMS registers as a licensed MFI, the behaviour score evolves into a formal credit score that directly determines loan eligibility and interest rates. Planned enhancements:

- **Machine learning layer:** Train on repayment outcomes (which ZSMS-facilitated loans were repaid vs defaulted) to refine factor weights
- **Mobile money integration:** With parent consent, incorporate mobile money transaction history for a richer picture
- **ZCR reporting:** Report loan outcomes to the Zambia Credit Reference Bureau — building the credit file that benefits parents who repay
- **Score improvement guidance:** Personalised tips on how to improve score before the next application

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 14 loan module documentation |
| 2026-04-26 | 300-850 scale confirmed | Matches Southern African credit score convention |
| 2026-04-26 | Four categories with enterprise weighting | Decision 1 confirmed — enterprise-grade algorithm |
| 2026-04-26 | Added ethical constraints section | Regulatory future-proofing for MFI registration |
