// Audit script to check for common issues and ensure changes persist
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;

console.log('🔍 AUDIT: Checking for common recurring issues...\n');

// 1. Check for due date related code
console.log('1. Checking Due Date implementations:');
const dueDateFiles = [];
const searchDirs = ['src/main', 'src/renderer'];

function searchInFile(filePath, searchTerm) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const matches = [];
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(searchTerm.toLowerCase())) {
        matches.push({ line: index + 1, content: line.trim() });
      }
    });
    return matches;
  } catch (e) {
    return [];
  }
}

function searchInDir(dir, searchTerm, results = []) {
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
        searchInDir(fullPath, searchTerm, results);
      } else if (stat.isFile() && (item.endsWith('.ts') || item.endsWith('.tsx') || item.endsWith('.js'))) {
        const matches = searchInFile(fullPath, searchTerm);
        if (matches.length > 0) {
          results.push({ file: fullPath, matches });
        }
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return results;
}

// Search for due date implementations
['due_date', 'dueDate', 'due date'].forEach(term => {
  const results = searchInDir(path.join(projectRoot, 'src'), term);
  if (results.length > 0) {
    console.log(`\n   Found "${term}" in:`);
    results.forEach(result => {
      console.log(`   📄 ${path.relative(projectRoot, result.file)}`);
      result.matches.slice(0, 3).forEach(match => {
        console.log(`      Line ${match.line}: ${match.content}`);
      });
      if (result.matches.length > 3) {
        console.log(`      ... and ${result.matches.length - 3} more`);
      }
    });
  }
});

// 2. Check for financial_year validation
console.log('\n\n2. Checking Financial Year validation:');
const fyResults = searchInDir(path.join(projectRoot, 'src'), 'financial_year');
if (fyResults.length > 0) {
  fyResults.forEach(result => {
    console.log(`   📄 ${path.relative(projectRoot, result.file)}`);
    result.matches.slice(0, 2).forEach(match => {
      if (match.content.includes('REGEXP') || match.content.includes('regex') || match.content.includes('pattern')) {
        console.log(`      ⚠️  Line ${match.line}: ${match.content}`);
      }
    });
  });
}

// 3. Check for database constraints
console.log('\n\n3. Checking Database Constraints:');
const schemaFile = path.join(projectRoot, 'src/main/db/schema.ts');
if (fs.existsSync(schemaFile)) {
  const schemaContent = fs.readFileSync(schemaFile, 'utf8');
  const regexpMatches = schemaContent.match(/CHECK.*REGEXP/g);
  if (regexpMatches) {
    console.log('   ⚠️  Found REGEXP constraints in schema:');
    regexpMatches.forEach(match => console.log(`      ${match}`));
  } else {
    console.log('   ✅ No REGEXP constraints found in schema');
  }
}

// 4. Check for addon handling
console.log('\n\n4. Checking Addon Handling:');
const addonResults = searchInDir(path.join(projectRoot, 'src'), 'addon');
const addonFiles = addonResults.map(r => r.file).filter((v, i, a) => a.indexOf(v) === i);
console.log(`   Found addon-related code in ${addonFiles.length} files:`);
addonFiles.forEach(file => {
  console.log(`   📄 ${path.relative(projectRoot, file)}`);
});

// 5. Check recent changes
console.log('\n\n5. Recent Changes Summary:');
const changelogFile = path.join(projectRoot, 'CHANGELOG.md');
if (fs.existsSync(changelogFile)) {
  console.log('   ✅ CHANGELOG.md exists - changes are documented');
  const changelogContent = fs.readFileSync(changelogFile, 'utf8');
  const lastChange = changelogContent.split('##')[1];
  if (lastChange) {
    console.log(`   Last documented: ${lastChange.split('\n')[1] || 'Recent fixes'}`);
  }
} else {
  console.log('   ⚠️  No CHANGELOG.md found');
}

console.log('\n\n✅ Audit Complete!');
console.log('\n💡 Recommendations:');
console.log('   - Always search ALL occurrences before making changes');
console.log('   - Document changes in CHANGELOG.md');
console.log('   - Test both dev and production builds');
console.log('   - Check frontend, backend, database, and PDF generation');
