import type { Metadata } from 'next'
import { Inter, Outfit, Fira_Code } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const firaCode = Fira_Code({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Codebase Feature Planner',
  description: 'AI-powered codebase analysis and feature planning dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} ${firaCode.variable}`}>
      <body className="min-h-screen bg-[#08090f] text-[#cbd5e1] font-sans antialiased overflow-x-hidden">
        {children}
      </body>
    </html>
  )
}

