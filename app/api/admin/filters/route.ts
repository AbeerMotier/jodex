import { authed } from '@/lib/server/http';
import { filterOptions } from '@/lib/server/admin/filters';

export const GET = authed(['admin'], async () => filterOptions());
