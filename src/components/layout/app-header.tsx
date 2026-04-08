'use client';

import { Shield } from 'lucide-react';
import Link from 'next/link';

export function AppHeader() {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-blue-600" />
            <span className="text-xl font-bold text-gray-900">ConfigCheck</span>
          </Link>

          {/* Nav */}
          <nav className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Dashboard
            </Link>
            <Link
              href="/settings"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Settings
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
