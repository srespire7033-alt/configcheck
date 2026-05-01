import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

// TODO: replace with the live custom domain once configcheck.io is wired up
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://configcheck.vercel.app';
const DESCRIPTION =
  'Connect any Salesforce org and run 182 automated CPQ + Billing + ARM health checks with AI fix suggestions in under 30 seconds. Built for Revenue Cloud consultants.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'ConfigCheck — Salesforce Revenue Cloud audit in 30 seconds',
  description: DESCRIPTION,
  keywords: [
    'Salesforce Revenue Cloud audit',
    'Salesforce CPQ health check',
    'Salesforce Billing audit',
    'Revenue Cloud RLM ARM',
    'CPQ consultant tools',
    'Salesforce config audit',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'ConfigCheck — Salesforce Revenue Cloud audit in 30 seconds',
    description: DESCRIPTION,
    siteName: 'ConfigCheck',
    type: 'website',
    url: SITE_URL,
    // TODO: design and host a 1200x630 branded OG card at /og-card.png
    images: [
      {
        url: '/og-card.png',
        width: 1200,
        height: 630,
        alt: 'ConfigCheck — Salesforce Revenue Cloud audit',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ConfigCheck — Salesforce Revenue Cloud audit in 30 seconds',
    description: DESCRIPTION,
    // TODO: same image as OG card
    images: ['/og-card.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            const t = localStorage.getItem('theme');
            if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
              document.documentElement.classList.add('dark');
            }
          } catch(e) {}
        `}} />
        {/* JSON-LD SoftwareApplication schema for richer search-engine and
            social-card rendering. aggregateRating intentionally omitted
            until we have real reviews to back it. Pricing reflects the
            Pro tier; revisit when the new Starter tier ships. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'ConfigCheck',
              description:
                'Automated Salesforce Revenue Cloud audit tool. Run 182 health checks across CPQ, Billing, and ARM with AI fix suggestions in under 30 seconds.',
              applicationCategory: 'BusinessApplication',
              applicationSubCategory: 'Salesforce CPQ audit tool',
              operatingSystem: 'Web',
              url: 'https://configcheck.vercel.app',
              offers: [
                {
                  '@type': 'Offer',
                  name: 'Free',
                  price: '0',
                  priceCurrency: 'USD',
                },
                {
                  '@type': 'Offer',
                  name: 'Pro',
                  price: '49',
                  priceCurrency: 'USD',
                  priceSpecification: {
                    '@type': 'UnitPriceSpecification',
                    price: '49',
                    priceCurrency: 'USD',
                    referenceQuantity: {
                      '@type': 'QuantitativeValue',
                      value: '1',
                      unitCode: 'MON',
                    },
                  },
                },
              ],
              creator: {
                '@type': 'Person',
                name: 'Maulik',
                jobTitle: 'Salesforce CPQ practitioner',
                address: {
                  '@type': 'PostalAddress',
                  addressLocality: 'Vadodara',
                  addressCountry: 'IN',
                },
              },
              featureList: [
                'Read-only OAuth connection to any Salesforce org',
                '182 automated health checks across CPQ, Billing, and ARM',
                'AI-powered fix suggestions per finding',
                'White-label PDF audit reports',
                'Scheduled scans with email notifications',
                'Org-to-org configuration comparison',
              ],
            }),
          }}
        />
      </head>
      <body className={`${geistSans.variable} font-sans antialiased bg-gray-50 dark:bg-[#0b1120] min-h-screen`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
