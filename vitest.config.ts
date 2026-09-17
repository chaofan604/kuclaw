import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.{ts,tsx}'],
    exclude: ['vendor/**', 'dist/**', 'release/**'],
  },
})
