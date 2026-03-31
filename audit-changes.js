/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const projectRoot = __dirname

function searchInFile(filePath, searchTerm) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return content
      .split('\n')
      .map((line, index) => ({ line: index + 1, content: line.trim() }))
      .filter((entry) => entry.content.toLowerCase().includes(searchTerm.toLowerCase()))
  } catch {
    return []
  }
}

function searchInDir(dir, searchTerm, results = []) {
  try {
    const items = fs.readdirSync(dir)

    for (const item of items) {
      const fullPath = path.join(dir, item)
      const stat = fs.statSync(fullPath)

      if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
        searchInDir(fullPath, searchTerm, results)
        continue
      }

      if (stat.isFile() && /\.(ts|tsx|js)$/.test(item)) {
        const matches = searchInFile(fullPath, searchTerm)
        if (matches.length > 0) {
          results.push({ file: fullPath, matches })
        }
      }
    }
  } catch {
    // Ignore unreadable folders in this helper script.
  }

  return results
}

console.log('AUDIT: Checking for common recurring issues...\n')

console.log('1. Checking due date implementations:')
for (const term of ['due_date', 'dueDate', 'due date']) {
  const results = searchInDir(path.join(projectRoot, 'src'), term)
  if (results.length === 0) continue

  console.log(`\n   Found "${term}" in:`)
  for (const result of results) {
    console.log(`   ${path.relative(projectRoot, result.file)}`)
    for (const match of result.matches.slice(0, 3)) {
      console.log(`      Line ${match.line}: ${match.content}`)
    }
    if (result.matches.length > 3) {
      console.log(`      ... and ${result.matches.length - 3} more`)
    }
  }
}

console.log('\n\n2. Checking financial year validation:')
for (const result of searchInDir(path.join(projectRoot, 'src'), 'financial_year')) {
  console.log(`   ${path.relative(projectRoot, result.file)}`)
  for (const match of result.matches.slice(0, 2)) {
    if (
      match.content.includes('REGEXP') ||
      match.content.includes('regex') ||
      match.content.includes('pattern')
    ) {
      console.log(`      Warning Line ${match.line}: ${match.content}`)
    }
  }
}

console.log('\n\n3. Checking database constraints:')
const schemaFile = path.join(projectRoot, 'src/main/db/schema.ts')
if (fs.existsSync(schemaFile)) {
  const schemaContent = fs.readFileSync(schemaFile, 'utf8')
  const regexpMatches = schemaContent.match(/CHECK.*REGEXP/g)

  if (regexpMatches) {
    console.log('   Found REGEXP constraints in schema:')
    for (const match of regexpMatches) {
      console.log(`      ${match}`)
    }
  } else {
    console.log('   No REGEXP constraints found in schema')
  }
}

console.log('\n\n4. Checking addon handling:')
const addonFiles = [...new Set(searchInDir(path.join(projectRoot, 'src'), 'addon').map((entry) => entry.file))]
console.log(`   Found addon-related code in ${addonFiles.length} files:`)
for (const file of addonFiles) {
  console.log(`   ${path.relative(projectRoot, file)}`)
}

console.log('\n\n5. Recent changes summary:')
const changelogFile = path.join(projectRoot, 'CHANGELOG.md')
if (fs.existsSync(changelogFile)) {
  console.log('   CHANGELOG.md exists - changes are documented')
  const changelogContent = fs.readFileSync(changelogFile, 'utf8')
  const lastChange = changelogContent.split('##')[1]
  if (lastChange) {
    console.log(`   Last documented: ${lastChange.split('\n')[1] || 'Recent fixes'}`)
  }
} else {
  console.log('   No CHANGELOG.md found')
}

console.log('\n\nAudit complete!')
console.log('\nRecommendations:')
console.log('   - Always search all occurrences before making changes')
console.log('   - Document changes in CHANGELOG.md')
console.log('   - Test both dev and production builds')
console.log('   - Check frontend, backend, database, and PDF generation')
