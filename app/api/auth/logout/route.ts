import type { NextRequest } from 'next/server';
import { audit } from '@/lib/server/audit';
import { getSessionUser } from '@/lib/server/auth';
import { errorResponse, json, verifyCsrf } from '@/lib/server/http';
import { createUserClient } from '@/lib/server/supabase';

export async function POST(req: NextRequest) {
  try {
    verifyCsrf(req);
    const user = await getSessionUser();
    const supabase = await createUserClient();
    await supabase.auth.signOut();
    if (user) await audit(user.id, 'auth.logout', 'users', user.id);
    return json({ redirectTo: '/login' });
  } catch (e) {
    return errorResponse(e);
  }
}
