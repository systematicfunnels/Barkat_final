# Changelog / Audit Log

All changes made to fix issues will be documented here to ensure they persist and can be tracked.

## Prevention System (2026-03-23)

**Why Issues Recur**: Critical fields like `due_date` and `financial_year` are used in 20+ files each. Fixing only one location causes the issue to reappear from other locations.

**Tools Created**:
- `audit-changes.js` - Scans all files for potential issues
- `CHANGELOG.md` - Documents all changes with file locations
- `ISSUE_PREVENTION_GUIDE.md` - Guide to prevent recurring issues

**How to Use**:
1. Before fixing: Run `node audit-changes.js` to see all locations
2. After fixing: Update this changelog with ALL files changed
3. Verify: Run audit again to ensure no old logic remains

## 2026-03-24 - Due Date Update Issue (RECURRING)

### Due Date Not Updating When Editing Letters
**Issue**: Due date changes not persisting when editing maintenance letters
**Root Cause**: Value extraction issue in update method - TypeScript type casting problem
**Files Changed**:
- `src/main/services/MaintenanceLetterService.ts` - Fixed value extraction in update method
**Problem**: `updates[key as keyof MaintenanceLetter]` was not properly accessing values
**Solution**: Changed to `(updates as any)[key]` with proper logging
**Status**: 🔧 IN PROGRESS - Testing required
**Prevention**: This is a perfect example of why the audit system is needed - the issue affects multiple layers

## 2026-03-23 - Payment & Addon Fixes

### 1. Payment Creation Error - CHECK constraint failed
**Issue**: `CHECK constraint failed: financial_year` when creating payments
**Root Cause**: SQLite REGEXP constraint not supported natively
**Files Changed**:
- `src/main/db/schema.ts` - Removed REGEXP constraints from payments and maintenance_rates tables
- `src/main/db/database.ts` - Added migration to remove constraints from existing databases
**Migration Applied**: ✅ Tables recreated without REGEXP constraints
**Status**: ✅ FIXED

### 2. Payment Receipt PDF Missing Addon Breakdown
**Issue**: Receipts only showed total amount, not individual charges
**Files Changed**:
- `src/main/services/PaymentService.ts` - Enhanced receipt PDF to show detailed breakdown
**Changes**: Added maintenance charges, addons, arrears, and discount breakdown
**Status**: ✅ FIXED

### 3. Maintenance Letter Addon Updates Not Reflecting in PDF
**Issue**: Editing addons didn't update the PDF automatically
**Files Changed**:
- `src/renderer/src/pages/Billing.tsx` - Added addon sync and PDF regeneration
**Changes**: 
  - Compare existing vs new addons
  - Delete removed addons
  - Add new addons
  - Regenerate PDF automatically
**Status**: ✅ FIXED

### 4. TypeScript Errors in PaymentService
**Issue**: Type mismatches with null/undefined
**Files Changed**:
- `src/main/services/PaymentService.ts` - Fixed type annotations
**Changes**: Changed `| null` to `| undefined` to match dbService.get() return type
**Status**: ✅ FIXED

## Previous Issues (for reference)

### Due Date Issues
**Common Pattern**: Due date logic exists in multiple places
**Locations to check**:
- Frontend form validation
- Backend service logic
- PDF generation
- Database constraints

**To prevent recurrence**: Always search for all occurrences of a field/function before making changes.

---

## How to Use This Audit Log

1. **Before making changes**: Check if the issue was already fixed here
2. **After making changes**: Document what was changed and why
3. **If issues recur**: Check if all related locations were updated
4. **For new developers**: Review this log to understand past fixes

## Checklist for Preventing Recurring Issues

- [ ] Search for ALL occurrences of the field/function being changed
- [ ] Check frontend (renderer) code
- [ ] Check backend (main) services
- [ ] Check database schema and constraints
- [ ] Check PDF generation logic
- [ ] Check form validation
- [ ] Test in both dev and production builds
- [ ] Document changes here with exact files and lines
