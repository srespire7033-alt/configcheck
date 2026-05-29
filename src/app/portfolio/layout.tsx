import { AppHeader } from '@/components/layout/app-header';

export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main className="bg-gray-50 dark:bg-[#0b1120] min-h-screen">{children}</main>
    </>
  );
}
