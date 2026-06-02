import { AppHeader } from '@/components/layout/app-header';

export default function OrgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AppHeader />
      {/* max-w-screen-2xl (1536px) gives the org detail page Hubbl-level
          breathing room. The dashboard is data-dense (6 tabs, matrix
          with 3×3 grid, side-by-side cards) and the older 7xl cap
          (1280px) was crowding tables and forcing truncation on
          finding rows. Other pages stay at 7xl via their own layouts. */}
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </>
  );
}
