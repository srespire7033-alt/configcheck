'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          fontFamily: 'system-ui, sans-serif',
          background: '#f9fafb',
          color: '#111827',
        }}>
          <div style={{
            background: 'white',
            borderRadius: '16px',
            padding: '48px',
            maxWidth: '480px',
            textAlign: 'center',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
            border: '1px solid #e5e7eb',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#9888;&#65039;</div>
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>
              Something went wrong
            </h2>
            <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '24px', lineHeight: 1.6 }}>
              An unexpected error occurred. Our team has been notified and is working on a fix.
            </p>
            <button
              onClick={() => reset()}
              style={{
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
