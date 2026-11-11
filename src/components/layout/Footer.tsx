
import Link from 'next/link'

export const Footer: React.FC = () => (
  <footer className="bg-navy-900 text-white py-4 text-center">
    <p className="text-sm">© 2026 MandatePay. All rights reserved.</p>
    <nav className="mt-2 space-x-4">
      <Link href="/" className="hover:underline">Home</Link>
      <Link href="/privacy" className="hover:underline">Privacy</Link>
      <Link href="/terms" className="hover:underline">Terms</Link>
    </nav>
  </footer>
)
