import { useState, useEffect } from 'react';

import { paths } from 'src/routes/paths';
import { useRouter, useSearchParams } from 'src/routes/hooks';

import { SplashScreen } from 'src/components/loading-screen';

import { useAuthContext } from '../hooks';

// ----------------------------------------------------------------------

/** Home of each role once signed in. */
export const homeForRole = (role) => paths[role]?.root ?? paths.comingSoon;

/**
 * Where to send a freshly signed-in user: only honour `returnTo` when it points
 * inside that user's own space, otherwise fall back to the role's home so the
 * "Accès réservé" guard is never the first page seen after login.
 */
export function postLoginPath(returnTo, role) {
  const home = homeForRole(role);
  const root = paths[role]?.root;
  if (!returnTo || !root || !returnTo.startsWith('/')) return home;
  return returnTo === root || returnTo.startsWith(`${root}/`) ? returnTo : home;
}

export function GuestGuard({ children }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { loading, authenticated, user } = useAuthContext();

  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (authenticated) {
      router.replace(postLoginPath(searchParams.get('returnTo'), user?.role));
      return;
    }
    setIsChecking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, loading]);

  if (isChecking) {
    return <SplashScreen />;
  }

  return <>{children}</>;
}
