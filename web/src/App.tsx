import { useState } from 'react'
import { Button } from '@/components/Button'
import reactLogo from '@/assets/react.svg'
import viteLogo from '/vite.svg'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-gray-50 px-6 text-gray-900">
      <div className="flex items-center gap-8">
        <a href="https://vite.dev" target="_blank" rel="noreferrer">
          <img
            src={viteLogo}
            className="h-20 transition-transform hover:scale-110"
            alt="Vite logo"
          />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img
            src={reactLogo}
            className="h-20 transition-transform hover:scale-110 motion-safe:animate-[spin_20s_linear_infinite]"
            alt="React logo"
          />
        </a>
      </div>

      <h1 className="text-4xl font-bold tracking-tight">Vite + React + TypeScript</h1>

      <div className="flex flex-col items-center gap-4 rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
        <Button onClick={() => setCount((c) => c + 1)}>count is {count}</Button>
        <p className="text-sm text-gray-600">
          Edit <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">src/App.tsx</code> and
          save to test HMR
        </p>
      </div>

      <p className="text-sm text-gray-500">Click the logos to learn more</p>
    </main>
  )
}
