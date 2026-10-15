import { ROLE_HOME, ROLE_LABEL } from '@/lib/domain/catalog';
import { authed } from '@/lib/server/http';

export const GET = authed(['admin', 'supervisor', 'contractor_monitor'], async ({ user, now }) => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  role: user.role,
  roleLabel: ROLE_LABEL[user.role],
  monitorKind: user.monitorKind,
  home: ROLE_HOME[user.role],
  serverNow: now.toISOString(),
}));
