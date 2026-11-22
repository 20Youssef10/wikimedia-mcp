import { z } from 'zod';

/**
 * Phase 3 §4 Group C input schemas. Advertised verbatim in tools/list via the
 * SDK's `z.toJSONSchema()`; each is strict with the frozen defaults/bounds.
 */
const analyticsProject = (max: number, description: string) => z.string()
  .min(2)
  .max(max)
  .describe(description);

const access = z.enum(['all-access', 'desktop', 'mobile-app', 'mobile-web'])
  .default('all-access')
  .describe('Access method.');

const compactDate = (description: string) => z.string()
  .regex(/^[0-9]{8}([0-9]{2})?$/, 'must be YYYYMMDD or YYYYMMDDHH')
  .describe(description);

export const getPageviewsSchema = z.object({
  project: analyticsProject(64, "Analytics dotted project code or a Phase 1 project alias, e.g. 'en.wikipedia', 'enwiki', 'commonswiki'.").default('en.wikipedia'),
  article: z.string().min(1).max(512).describe('Page title; spaces or underscores accepted. Encoded and validated locally before use.'),
  start: compactDate('Inclusive start. YYYYMMDD for daily/weekly/monthly; YYYYMMDDHH for hourly.'),
  end: compactDate('Inclusive end, same shape as start. Must be <= yesterday UTC.'),
  granularity: z.enum(['hourly', 'daily', 'weekly', 'monthly']).default('daily').describe('Aggregation period. Determines the required timestamp shape and range cap (section 4.4).'),
  access,
  agent: z.enum(['user', 'spider', 'automated']).default('user').describe("Traffic class. 'user' is the default human pageview class."),
}).strict();

export const getMostReadSchema = z.object({
  project: analyticsProject(64, 'Analytics dotted project code or a Phase 1 alias.').default('en.wikipedia'),
  date: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'must be YYYY-MM-DD').describe("Completed UTC date, YYYY-MM-DD. 'today' and future dates are rejected (section 4.4)."),
  access,
  limit: z.number().int().min(1).max(100).default(10).describe('Maximum articles returned; hard cap 100.'),
}).strict();

export const getUniqueDevicesSchema = z.object({
  project: analyticsProject(64, 'Analytics dotted project code or a Phase 1 alias.').default('en.wikipedia'),
  access_site: z.enum(['all-sites', 'desktop-site', 'mobile-site']).default('all-sites').describe("Mapped to the upstream 'access-site' parameter."),
  granularity: z.enum(['daily', 'monthly']).default('monthly').describe('Unique devices is available only at daily or monthly granularity.'),
  start: z.string().regex(/^[0-9]{8}$/, 'must be YYYYMMDD').describe('Inclusive start YYYYMMDD; must be the 1st when granularity is monthly.'),
  end: z.string().regex(/^[0-9]{8}$/, 'must be YYYYMMDD').describe('Inclusive end YYYYMMDD; must be the 1st when granularity is monthly and <= yesterday UTC.'),
}).strict();

export type GetPageviewsInput = z.infer<typeof getPageviewsSchema>;
export type GetMostReadInput = z.infer<typeof getMostReadSchema>;
export type GetUniqueDevicesInput = z.infer<typeof getUniqueDevicesSchema>;

export const GROUP_C_SCHEMAS = {
  get_pageviews: getPageviewsSchema,
  get_most_read: getMostReadSchema,
  get_unique_devices: getUniqueDevicesSchema,
} as const;

export const GROUP_C_TOOL_NAMES = Object.keys(GROUP_C_SCHEMAS) as Array<keyof typeof GROUP_C_SCHEMAS>;

export const GROUP_C_DESCRIPTIONS = {
  get_pageviews: 'Daily/hourly/weekly/monthly page views for one article on one project over a bounded, completed UTC date range. Empty data is a success with results: []. Dates must be explicit completed periods (no "today").',
  get_most_read: 'The most-read articles of one completed UTC day on one project, in rank order. Returns title (underscores replaced by spaces), views, rank and an allowlisted article URL. Empty data is a success with articles: [].',
  get_unique_devices: 'Project-wide estimated unique-device counts for a bounded completed period, with devices/offset/underestimate and a reach-estimate meaning string. This is NOT a per-article metric and NOT pageviews; daily/monthly and all-sites/desktop-site/mobile-site only.',
} as const;
