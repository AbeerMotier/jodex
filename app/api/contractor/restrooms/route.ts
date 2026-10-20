import { authed } from '@/lib/server/http';
import { contractorRestrooms } from '@/lib/server/contractor';

/** للعرض فقط: لا توجد أي نقطة نهاية معدِّلة لدور المقاول */
export const GET = authed(['contractor'], async ({ user, now }) => contractorRestrooms(user, now));
