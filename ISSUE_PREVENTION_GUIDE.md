# Issue Prevention Guide

## Why Issues Keep Recurring

The audit shows that critical fields like `due_date` and `financial_year` are used in **21+ files** each! When you fix an issue in one place, other files still have the old logic.

## Common Problem Patterns

### 1. Due Date Issues
**Found in 21+ files across:**
- Database schema & migrations
- Backend services (5+ files)
- Frontend components (4+ files) 
- Type definitions (3+ files)
- PDF generation (2+ files)
- Tests (3+ files)

### 2. Financial Year Issues  
**Found in 20+ files across:**
- Same pattern as due_date
- Validation in multiple places
- Different regex patterns used
- Frontend vs backend validation mismatch

## Prevention Checklist

### Before Making Any Change:

1. **SEARCH EVERYWHERE** - Use the audit script:
   ```bash
   node audit-changes.js
   ```

2. **Identify ALL locations**:
   - Backend services (`src/main/services/*.ts`)
   - Frontend components (`src/renderer/src/pages/*.tsx`)
   - Database schema (`src/main/db/schema.ts`)
   - Type definitions (`src/preload/types.ts`)
   - PDF generation files
   - Test files

3. **Check for duplicate logic**:
   - Is there validation in both frontend and backend?
   - Are there multiple regex patterns for the same field?
   - Does the database have constraints that conflict with code?

### After Making Changes:

1. **Update ALL locations** - Not just the error location
2. **Document in CHANGELOG.md** - List every file changed
3. **Run full audit** to verify no old logic remains
4. **Test both dev and production builds**

## Specific Examples

### Due Date Fix Pattern:
When fixing due date issues, you must check:
- [ ] `src/main/db/schema.ts` - Database column definition
- [ ] `src/main/services/MaintenanceLetterService.ts` - Business logic
- [ ] `src/main/ipcHandlers.ts` - API validation
- [ ] `src/renderer/src/pages/Billing.tsx` - Frontend form
- [ ] `src/renderer/src/components/MaintenanceRateModal.tsx` - Other forms
- [ ] PDF generation files for due date display
- [ ] Type definitions for consistency

### Financial Year Fix Pattern:
When fixing financial year issues:
- [ ] Remove REGEXP from database schema
- [ ] Update backend validation regex
- [ ] Update frontend validation regex  
- [ ] Check all form components
- [ ] Verify PDF generation
- [ ] Run database migration

## Early Warning Signs

⚠️ **You might have missed something if:**
- The same error appears again after a "fix"
- Build works but runtime errors occur
- Dev works but production build fails
- Only one file was changed for a "system-wide" issue

## Quick Audit Commands

```bash
# Search for all occurrences of a field
grep -r "due_date" src/ --include="*.ts" --include="*.tsx"
grep -r "financial_year" src/ --include="*.ts" --include="*.tsx"

# Run full audit
node audit-changes.js

# Check for REGEXP constraints
grep -r "REGEXP" src/main/db/
```

## Remember

**If a field is used in the UI, it likely has:**
1. Database column definition
2. Backend service logic
3. API endpoint/handler
4. Frontend form component
5. Type definition
6. Validation logic (possibly multiple)
7. PDF/display logic

**Missing any one of these = recurring issue!**

---

## Template for Documenting Fixes

When you fix an issue, add to CHANGELOG.md:

```markdown
### [Date] - [Issue Title]
**Issue**: [Brief description]
**Root Cause**: [Why it happened]
**Files Changed**:
- `file1.ts` - What was changed
- `file2.ts` - What was changed
- [List ALL files touched]
**Locations Checked**: [List all places searched]
**Status**: ✅ FIXED
**Prevention**: [How to prevent recurrence]
```

This systematic approach will prevent issues from coming back!
