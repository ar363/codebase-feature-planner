import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Codebase Feature Planner',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 font-mono p-6">
        {children}
      </body>
    </html>
  )
}
