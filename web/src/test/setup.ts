import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Unmount React trees and clear the DOM after every test.
afterEach(() => {
  cleanup()
})
