'use client';

import { createAuthClient } from 'better-auth/react';

// Use the page's own origin so auth works on any host/port/proxy, not just the
// build-time NEXT_PUBLIC_APP_URL (which defaults to localhost:7080 and hangs
// the browser when the app is opened via a different host).
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
