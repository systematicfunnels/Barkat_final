// Script to check and fix missing maintenance rates for Project 983 (Banjara Hills)
// Run this in your browser console or as a preload script

const PROJECT_ID = 983;
const TARGET_YEAR = '2025-26';
const TARGET_UNIT_TYPE = 'Plot';

// Check existing rates
async function checkExistingRates() {
  console.log('=== Checking Maintenance Rates for Project', PROJECT_ID, '===');
  
  const rates = await window.electronAPI.queryDatabase(
    `SELECT id, financial_year, unit_type, rate_per_sqft, gst_percent, penalty_percentage 
     FROM maintenance_rates 
     WHERE project_id = ? 
     ORDER BY financial_year, unit_type`,
    [PROJECT_ID]
  );
  
  console.log('Existing rates:', rates);
  
  // Check for specific rate
  const targetRate = rates.find(r => 
    r.financial_year === TARGET_YEAR && 
    (r.unit_type === TARGET_UNIT_TYPE || r.unit_type === 'All')
  );
  
  if (targetRate) {
    console.log('✓ Rate found for', TARGET_YEAR, TARGET_UNIT_TYPE, ':', targetRate);
    return { found: true, rate: targetRate };
  } else {
    console.log('✗ Rate NOT found for', TARGET_YEAR, TARGET_UNIT_TYPE);
    console.log('Available years:', [...new Set(rates.map(r => r.financial_year))]);
    console.log('Available unit types:', [...new Set(rates.map(r => r.unit_type))]);
    return { found: false, rates };
  }
}

// Add missing rate
async function addMissingRate(ratePerSqft = 50, gstPercent = 18) {
  console.log('=== Adding Missing Rate ===');
  
  try {
    const result = await window.electronAPI.runDatabase(
      `INSERT INTO maintenance_rates (project_id, financial_year, unit_type, rate_per_sqft, gst_percent)
       VALUES (?, ?, ?, ?, ?)`,
      [PROJECT_ID, TARGET_YEAR, TARGET_UNIT_TYPE, ratePerSqft, gstPercent]
    );
    
    console.log('✓ Rate added successfully!');
    console.log('Result:', result);
    return true;
  } catch (error) {
    console.error('✗ Failed to add rate:', error);
    return false;
  }
}

// Run diagnostics
checkExistingRates().then(result => {
  if (!result.found) {
    console.log('\n=== Recommendation ===');
    console.log('You need to add a maintenance rate for:');
    console.log('  Project:', PROJECT_ID, '(Banjara Hills)');
    console.log('  Financial Year:', TARGET_YEAR);
    console.log('  Unit Type:', TARGET_UNIT_TYPE);
    console.log('\nTo add via UI:');
    console.log('1. Go to Projects → Banjara Hills → Settings');
    console.log('2. Click "Maintenance Rates" tab');
    console.log('3. Click "Add Rate"');
    console.log('4. Enter: Year=2025-26, Unit Type=Plot, Rate per sqft=[value]');
    console.log('\nOr call: addMissingRate(50, 18) to add with rate=50, GST=18%');
  }
});

// Export functions for console use
window.checkRates = checkExistingRates;
window.addRate = addMissingRate;
