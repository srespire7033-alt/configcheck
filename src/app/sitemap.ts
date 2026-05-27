import type { MetadataRoute } from 'next';

/**
 * Generates /sitemap.xml at build/request time. Lists only the public,
 * crawlable surfaces — anything behind auth (dashboard, onboarding,
 * settings, per-org pages) is intentionally omitted since search engines
 * can't reach those.
 *
 * `lastModified` is set to the deploy time so search engines re-crawl after
 * each release. `priority` reflects how central each page is to the
 * marketing funnel.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://orgprism.vercel.app';
  const now = new Date();

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${base}/changelog`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/status`, lastModified: now, changeFrequency: 'always', priority: 0.6 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/security`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/dpa`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ];
}
