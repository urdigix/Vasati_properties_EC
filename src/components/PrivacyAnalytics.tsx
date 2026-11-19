'use client';

import React, { useEffect, useState } from 'react';
import Script from 'next/script';
import { getStoredConsent, CookiePreferences } from '@/lib/cookie-consent';

export default function PrivacyAnalytics() {
  const [canLoadAnalytics, setCanLoadAnalytics] = useState(false);

  useEffect(() => {
    // 1. Check Do Not Track (DNT) header in browser
    if (typeof window !== 'undefined' && navigator.doNotTrack === '1') {
      console.info('[PRIVACY_GUARD] Browser Do Not Track (DNT) signal detected. Analytics inhibited.');
      return;
    }

    // 2. Check stored consent
    const stored = getStoredConsent();
    if (stored?.analytics) {
      setCanLoadAnalytics(true);
    }

    // 3. Listen for consent updates
    const handleConsentChange = (e: Event) => {
      const customEvent = e as CustomEvent<CookiePreferences>;
      if (customEvent.detail?.analytics) {
        setCanLoadAnalytics(true);
      } else {
        setCanLoadAnalytics(false);
      }
    };

    window.addEventListener('dpdp-consent-updated', handleConsentChange);
    return () => {
      window.removeEventListener('dpdp-consent-updated', handleConsentChange);
    };
  }, []);

  if (!canLoadAnalytics) {
    // Privacy-by-design: Zero tracking scripts rendered in DOM before consent
    return null;
  }

  const umamiId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const umamiUrl = process.env.NEXT_PUBLIC_UMAMI_URL || 'https://analytics.umami.is/script.js';
  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

  return (
    <>
      {/* 1. Self-hosted Umami Privacy-First Analytics */}
      {umamiId && (
        <Script
          strategy="afterInteractive"
          src={umamiUrl}
          data-website-id={umamiId}
          data-auto-track="true"
        />
      )}

      {/* 2. Self-hosted Plausible Analytics */}
      {plausibleDomain && (
        <Script
          strategy="afterInteractive"
          defer
          data-domain={plausibleDomain}
          src="https://plausible.io/js/script.js"
        />
      )}

    </>
  );
}

