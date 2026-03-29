# Barkat System User Flow Map

## Overview
This document provides a comprehensive visual map of how the Barkat Property Maintenance Management System works from the user's perspective.

## System Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User Interface│    │   Business Logic │    │   Data Layer    │
│   (React App)   │◄──►│   (Services)     │◄──►│   (SQLite DB)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘

## User Journey Flow

### 1. Initial Setup Flow

```
User Opens App
    ↓
Dashboard Loads
    ↓
User Navigates to Projects
    ↓
Clicks "New Project" or "Import Standard Workbook"
    ↓
Enters Project Details:
    ├── Project Name (Required)
    ├── Address, City, State, Pincode
    ├── Bank Details (Account Name, Bank, IFSC, Branch)
    ├── QR Code Upload
    └── Template Type Selection
    ↓
Project Created with Auto-Generated Code (PRJ-001, PRJ-002, etc.)
```

### 2. Data Import Flow (Excel)

```
User Selects "Import Standard Workbook"
    ↓
File Selection Dialog
    ↓
Excel File Validation
    ├── Checks for required sheets: Project, Units, Ledger
    ├── Validates file format (.xlsx, .xls, .csv)
    ├── File size and corruption checks
    └── Sheet structure validation
    ↓
Data Preview Screen
    ├── Shows detected projects
    ├── Shows unit count
    ├── Shows ledger rows
    ├── Shows validation warnings/blockers
    └── Allows user to review before import
    ↓
User Confirms Import
    ↓
Transaction Processing
    ├── Creates/Updates Projects
    ├── Creates/Updates Units with sector extraction
    ├── Creates Maintenance Letters from Ledger
    ├── Applies Rates and Add-ons
    ├── Links Payments if present
    └── Generates Import Summary
    ↓
Success Notification with Summary
```

### 3. Manual Data Entry Flow

```
User Navigates to Units Section
    ↓
Selects Project from Dropdown
    ↓
Clicks "Add Unit"
    ↓
Enters Unit Details:
    ├── Unit Number (e.g., A-001, B-042)
    ├── Owner Name
    ├── Area (sqft)
    ├── Unit Type (Plot/Bungalow/Garden)
    ├── Contact Information
    ├── Status (Active/Inactive/Vacant)
    └── Optional: Penalty, Addresses
    ↓
Unit Saved to Database
    ↓
User Can Add Multiple Units
```

### 4. Billing Generation Flow

```
User Navigates to Billing Section
    ↓
Selects Project and Financial Year
    ↓
Sets Letter Date and Due Date
    ↓
Configures Add-ons (Optional):
    ├── NA Tax
    ├── Solar Contribution
    ├── Cable Charges
    ├── Custom Add-ons
    └── Early Payment Discounts
    ↓
System Calculates:
    ├── Base Maintenance = Area × Rate per sqft
    ├── GST (if configured)
    ├── Add-ons
    ├── Arrears from previous years
    └── Penalties (if applicable)
    ↓
User Reviews Preview
    ↓
Clicks "Generate Letters"
    ↓
System Creates Maintenance Letters for All Units
    ├── Validates rates exist for the year
    ├── Checks bank details are configured
    ├── Generates unique letter IDs
    └── Stores in database
    ↓
Letters Appear in Billing Table
    ↓
User Can Download PDF Letters
```

### 5. Payment Recording Flow

```
User Navigates to Payments Section
    ↓
Selects Project and Unit
    ↓
Enters Payment Details:
    ├── Payment Date
    ├── Amount Received
    ├── Payment Mode (Cash/Cheque/Transfer/UPI)
    ├── Financial Year Attribution
    ├── Cheque Number (if applicable)
    └── Remarks
    ↓
System Validates:
    ├── Unit belongs to selected project
    ├── Amount is positive
    ├── Financial year format is correct
    └── Payment mode is valid
    ↓
Payment Recorded
    ├── Updates payment table
    ├── Links to maintenance letter if specified
    ├── Updates letter status if fully paid
    └── Generates receipt PDF
    ↓
User Can View Payment History
```

### 6. Reporting and Analysis Flow

```
User Navigates to Reports Section
    ↓
Views Dashboard Statistics:
    ├── Total Billed
    ├── Total Collected
    ├── Outstanding Amount
    ├── Unit Counts
    └── Collection Rates
    ↓
Applies Filters:
    ├── Project Selection
    ├── Unit Type Filter
    ├── Status Filter
    ├── Financial Year Range
    ├── Outstanding Amount Range
    └── Search (Unit/Owner/Project)
    ↓
Views Pivot Table:
    ├── Unit-wise breakdown
    ├── Year-wise amounts (Billed/Paid/Balance)
    ├── Aggregated totals
    └── Outstanding analysis
    ↓
Exports to Excel (Optional)
    ├── Detailed unit data
    ├── Yearly summaries
    ├── Filtered results
    └── Grand totals
```

## Data Flow Architecture

### Frontend (React) Flow

```
User Action → Event Handler → API Call → State Update → UI Re-render
    ↓              ↓              ↓           ↓            ↓
Button Click → Form Submit → window.api → Redux/State → Component Update
```

### Backend (Electron Main) Flow

```
IPC Request → Validation → Service Layer → Database Query → Response
    ↓           ↓            ↓              ↓              ↓
API Call → Input Check → Business Logic → SQL Operations → JSON Response
```

### Database Flow

```
Transaction Start → Data Validation → Insert/Update → Foreign Key Check → Commit/Rollback
    ↓                 ↓                ↓              ↓                  ↓
BEGIN → Schema Validation → INSERT/UPDATE → CASCADE Rules → COMMIT/ROLLBACK
```

## Error Handling Flow

### Validation Errors

```
User Input → Field Validation → Error Message → User Correction
    ↓           ↓                  ↓              ↓
Form Submit → Required Check → Show Error → Retry
```

### System Errors

```
Error Occurs → Error Logger → User Message → Recovery Option
    ↓           ↓              ↓              ↓
Exception → Log Details → "Something went wrong" → Retry/Contact Support
```

### Data Integrity Errors

```
Constraint Violation → Transaction Rollback → User Notification → Data Correction
    ↓                   ↓                    ↓                    ↓
FK Violation → Rollback → "Invalid reference" → Fix Data
```

## File Processing Flow

### Excel Import Pipeline

```
File Upload → Format Detection → Sheet Parsing → Row Processing → Data Mapping → Validation → Database Import
    ↓           ↓                ↓              ↓               ↓            ↓           ↓
.xlsx/.csv → ExcelJS/SheetJS → JSON Objects → Normalization → Type Check → Business Rules → INSERT
```

### PDF Generation Flow

```
Letter Data → Template Selection → Content Assembly → PDF Rendering → File Save → Download Link
    ↓           ↓                 ↓               ↓              ↓           ↓
Database → Template Type → Text/Images/Tables → PDFKit → Local Storage → Browser Download
```

## User Roles and Permissions

### Administrator Flow

```
Login → Full Access → All Sections → System Settings → Backup/Restore
    ↓     ↓            ↓           ↓              ↓
Admin → Projects/Units/Billing/Payments/Reports/Settings
```

### Operator Flow

```
Login → Limited Access → Data Entry → Basic Reporting
    ↓     ↓              ↓           ↓
User → Units/Billing/Payments → Filtered Reports
```

This flow map demonstrates the comprehensive user experience design of the Barkat system, showing how users interact with each component and how data flows through the system from input to output.
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Excel Import  │    │   Validation     │    │   Schema        │
│   & Data Entry  │    │   & Processing   │    │   & Relations   │
└─────────────────┘    └──────────────────┘    └─────────────────┘

## Key User Scenarios

### Scenario 1: New Housing Society Setup
```
Property Manager wants to set up maintenance billing for a new society
    ↓
1. Creates Project with society details and bank information
2. Imports unit list from Excel (500+ units)
3. Sets maintenance rates per sqft for current financial year
4. Generates maintenance letters for all units
5. Tracks payments as they come in
6. Generates monthly collection reports
```

### Scenario 2: Monthly Billing Cycle
```
Start of new billing period
    ↓
1. Sets financial year (e.g., 2024-25)
2. Configures rates and add-ons (NA Tax, Cable, etc.)
3. Generates letters for all active units
4. Distributes PDF letters to owners
5. Records payments as received
6. Tracks outstanding amounts
7. Sends reminder letters for pending payments
```

### Scenario 3: Data Correction and Updates
```
Discovering data errors or needing updates
    ↓
1. Filters reports to find problematic records
2. Edits unit details (owner name, contact info)
3. Corrects payment entries if needed
4. Regenerates letters if necessary
5. Updates project bank details
6. Maintains audit trail of all changes
```

### Scenario 4: Financial Analysis and Reporting
```
Management needs financial overview
    ↓
1. Views dashboard for current status
2. Filters by project, unit type, or time period
3. Analyzes collection rates and outstanding amounts
4. Identifies problem areas (high outstanding units)
5. Exports detailed reports to Excel
6. Shares reports with stakeholders
```

## System Integration Points

### External File Handling
```
Excel Files (.xlsx, .xls, .csv)
    ↓
Import/Export Module
    ↓
Data Validation & Normalization
    ↓
Database Storage
    ↓
Report Generation
```

### PDF Document Generation
```
Letter Data from Database
    ↓
Template Engine (PDFKit)
    ↓
PDF Assembly (Header, Content, Footer)
    ↓
QR Code Integration
    ↓
File Storage & Download
```

### Backup and Recovery
```
Scheduled Backup Trigger
    ↓
Database Copy & Compression
    ↓
Storage in User Data Directory
    ↓
Retention Management
    ↓
Restore on Demand
```

## Performance Considerations

### Large Dataset Handling
- **Excel Import**: Processes 1000+ rows efficiently with progress indicators
- **Report Generation**: Uses pagination for 10,000+ unit datasets
- **Search/Filter**: Optimized queries with database indexing
- **PDF Generation**: Batch processing for multiple letters

### User Experience Optimizations
- **Loading States**: Clear feedback during long operations
- **Progress Indicators**: Shows import/export progress
- **Error Recovery**: Graceful handling of corrupted files
- **Offline Operation**: Full functionality without internet connection
- **Responsive Design**: Works on different screen sizes

## Summary

This user flow map demonstrates how the Barkat system provides a seamless experience for property management professionals:

1. **Intuitive Navigation**: Clear section-based organization (Projects, Units, Billing, Payments, Reports)
2. **Flexible Data Entry**: Both Excel import and manual entry options
3. **Robust Validation**: Multi-layer validation prevents data errors
4. **Professional Output**: High-quality PDF letters and Excel reports
5. **Comprehensive Reporting**: Detailed financial analysis and tracking
6. **Data Security**: Local SQLite storage with automatic backups
7. **Error Handling**: User-friendly error messages and recovery options

The system is designed to handle the complete property maintenance management lifecycle from initial setup through ongoing billing and financial reporting.
### User Experience Optimizations
- **Loading States**: Clear feedback during long operations
- **Progress Indicators**: Shows import/export progress
- **Error Recovery**: Graceful handling of corrupted files
- **Offline Operation**: Full functionality without internet connection
- **Responsive Design**: Works on different screen sizes

## Summary

This user flow map demonstrates how the Barkat system provides a seamless experience for property management professionals:

1. **Intuitive Navigation**: Clear section-based organization (Projects, Units, Billing, Payments, Reports)
2. **Flexible Data Entry**: Both Excel import and manual entry options
3. **Robust Validation**: Multi-layer validation prevents data errors
4. **Professional Output**: High-quality PDF letters and Excel reports
5. **Comprehensive Reporting**: Detailed financial analysis and tracking
6. **Data Security**: Local SQLite storage with automatic backups
7. **Error Handling**: User-friendly error messages and recovery options

The system is designed to handle the complete property maintenance management lifecycle from initial setup through ongoing billing and financial reporting.
