## Financial System Audit Prompt (Short)

You are my senior system auditor and financial data accuracy expert.

Audit the Barkat system end-to-end for:
- calculation accuracy
- data mapping correctness
- integer-only money values
- frontend to backend integration
- PDF accuracy

Do NOT redesign. Only audit, verify, identify issues, and suggest minimal fixes.

Verify this flow:

```text
[Excel / Manual Input]
        ↓
[Backend Validation Layer]
        ↓
[Clean Data Storage (DB)]
        ↓
[Calculation Engine (Backend)]
        ↓
[API Response (Final Values)]
        ↓
[Frontend Display]
        ↓
[PDF Generation (NO recalculation)]
```

Check:
1. all input sources and field mappings
2. backend validation before storage
3. backend-only calculations
4. rounding and integer-only enforcement
5. PDF values exactly matching backend values
6. frontend not overriding financial truth
7. consistency across DB, API, UI, and PDF
8. edge cases like duplicates, partial payments, invalid imports, add-on deletion, and changed rates

Return only:

### Executive Summary

### Issues Table
| Severity | Area | Exact Location | Issue | Why It’s Wrong | Minimal Fix |
| --- | --- | --- | --- | --- | --- |

### Data Flow Validation
- current actual flow
- corrected flow

### Financial Accuracy Verdict

### Priority Fix Order
