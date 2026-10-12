# Returns on kridi sales

## Rule (current version)

A return on a ticket paid in part or in full on kridi is handled in the main process
(`electron/services/returnService.js`, inside the `db:returns:create` transaction):

1. Everything is checked before anything is written:
   - the ticket counts;
   - every line belongs to this ticket;
   - quantities are whole numbers above 0;
   - quantities are never more than are left on the line, including the earlier returns and
     the other lines of the same return;
   - a return already saved (same id or number) is refused (`RETURN_ALREADY_SAVED`) and
     nothing is counted twice.
2. The amount is what the pieces were really paid, after the discounts (`shared/refund.mjs`).
   All returns of a ticket together never exceed the ticket's total.
3. The debt still owed on the ticket goes down first (`returns.credit_reduced`, on the invoice
   and on the customer's balance).
4. Only the rest (`hand_back`) is given back, in cash or as an avoir card. The rest is never more
   than the customer actually paid.
5. The drawer counts as cash out only `total_refund - credit_reduced`, and nothing for an avoir.
   The sales journal splits each return into kridi, cash and avoir.
6. A failure at any step undoes the whole return (one transaction).

## Returns saved by older versions

Before `returns.credit_reduced` existed (migration `2026_10_return_credit_reduced`), a return on a
kridi ticket left the debt as it was. The drawer did not count it as cash out. The migration only
adds the column. Older rows stay empty and are read with the old rule, so closed drawers do not
change.

`electron/services/creditReturnsAudit.js` handles these rows.

- `auditLegacyCreditReturns` (read only) gives each old return one of these statuses:

| Status | Proven by |
|---|---|
| `ALREADY_SETTLED` | `credit_reduced` filled |
| `SETTLED_BY_AVOIR` | an avoir card linked to the return |
| `EXCHANGE` | linked to an exchange |
| `CASH_REFUNDED` | the drawer closed short by exactly its old kridi refunds, or an expense named after the return |
| `DEBT_NOT_LOWERED` | drawer closed with no difference, no avoir, no payment beyond the pieces kept, no note, customer balance equal to the open invoices |
| `MANUAL_REVIEW_REQUIRED` | the records cannot tell: no drawer, drawer not closed, a difference matching nothing or only part, an expense of the same amount, a note on the invoice, a balance that disagrees, or money paid beyond the pieces kept (`possible_overpaid`) |

- `settleProvenLegacyReturns` lowers the debt of the `DEBT_NOT_LOWERED` returns only, and only
  when the whole return goes off the debt. The drawer then still reads no cash out, so closed
  drawers keep their figures. Each return is settled in its own transaction, re-read inside it,
  and gets its `credit_reduced`. Running it again therefore changes nothing. Every other status
  is left exactly as it is.
- It never touches sales, TVA, drawers or loyalty points. Old returns never took points back,
  and whether those points were spent since cannot be known.
- Nothing runs automatically. The development script works on a copy:

      npx vite-node scripts/audit-credit-returns.mjs <copy.db> [report.csv]          # report, read only
      npx vite-node scripts/audit-credit-returns.mjs <copy.db> --settle --out <new.db>

  The input file is never written: its SHA-256 is printed before and after.
