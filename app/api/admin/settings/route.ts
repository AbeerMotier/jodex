import { riyadhDate } from '@/lib/domain/time';
import { settingsSaveSchema } from '@/lib/domain/validation';
import { fullAdminRoute, parseJson } from '@/lib/server/http';
import { getSettings, saveSettings } from '@/lib/server/admin/settings';

export const GET = fullAdminRoute(async () => getSettings());

export const PUT = fullAdminRoute(async ({ req, user, now }) => {
  const body = await parseJson(req, settingsSaveSchema);
  const result = await saveSettings(user, body, riyadhDate(now));
  return { ...result, settings: await getSettings() };
});
