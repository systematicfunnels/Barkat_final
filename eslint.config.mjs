import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/__tests__/**',
      'tests/**',
      'e2e/**',
      'cypress.config.ts',
      'src/main/utils/check-rates-project-983.js'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    files: [
      'src/main/services/InvoiceGenerator.ts',
      'src/main/services/MaintenanceLetterService.ts',
      'src/main/types/pdf.ts',
      'src/main/utils/check-rates-project-983.js',
      'src/renderer/src/components/DetailedMaintenanceLetterModal.tsx'
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-catch': 'off',
      'prefer-const': 'off'
    }
  },
  eslintConfigPrettier
)
