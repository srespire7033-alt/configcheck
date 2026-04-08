import { AppHeader } from '@/components/layout/app-header';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </>
  );
}
