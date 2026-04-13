import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "ConfigCheck - Salesforce CPQ Health Audit",
  description: "AI-powered Salesforce CPQ configuration auditor for consulting firms",
  openGraph: {
    title: "ConfigCheck - Salesforce CPQ Health Audit",
    description: "68 automated checks across 17 categories. AI-powered fix suggestions and remediation plans for Salesforce CPQ.",
    siteName: "ConfigCheck",
    type: "website",
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
      </head>
      <body className={`${geistSans.variable} font-sans antialiased bg-gray-50 dark:bg-[#0b1120] min-h-screen`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
