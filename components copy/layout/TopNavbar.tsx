'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function TopNavbar() {
  const pathname = usePathname()

  const navItems = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Analytics', href: '/analytics' },
    { name: 'Reporting', href: '/reporting' },
    { name: 'Data Model', href: '/data-model' }, // ✅ New link
  ]

  return (
    <nav className="flex items-center gap-6 px-6 py-3 bg-white border-b shadow-sm">
      <h1 className="text-lg font-semibold">CFO Platform</h1>
      <div className="flex gap-4 text-sm">
        {navItems.map(item => (
          <Link
            key={item.name}
            href={item.href}
            className={`hover:text-blue-600 transition ${
              pathname.startsWith(item.href) ? 'text-blue-600 font-medium' : 'text-gray-700'
            }`}
          >
            {item.name}
          </Link>
        ))}
      </div>
    </nav>
  )
}
