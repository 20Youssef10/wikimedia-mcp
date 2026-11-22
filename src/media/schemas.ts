import { z } from 'zod';

/** Phase 3 §5 Group F input schemas (strict, advertised verbatim). */
const filename = z.string().min(1).max(512)
  .describe("Full file title, e.g. 'File:The Earth seen from Apollo 17.jpg'.");
const project = (description: string) => z.string().min(2).max(24).default('commonswiki').describe(description);
const thumbWidth = z.number().int().min(40).max(1200).default(320).describe('Thumbnail width in pixels.');

export const getFileMetadataSchema = z.object({
  filename,
  project: project("Wiki hosting the file; 'commonswiki' by default."),
  thumb_width: thumbWidth,
  include_brand_marks: z.boolean().default(true).describe('Include essential.default_brand_marks[] from the Attribution API.'),
}).strict();

export const getImageInfoSchema = z.object({
  filename,
  project: project('Wiki hosting the file.'),
  thumb_width: thumbWidth,
}).strict();

export type GetFileMetadataInput = z.infer<typeof getFileMetadataSchema>;
export type GetImageInfoInput = z.infer<typeof getImageInfoSchema>;

export const GROUP_F_SCHEMAS = {
  get_file_metadata: getFileMetadataSchema,
  get_image_info: getImageInfoSchema,
} as const;

export const GROUP_F_TOOL_NAMES = Object.keys(GROUP_F_SCHEMAS) as Array<keyof typeof GROUP_F_SCHEMAS>;

export const GROUP_F_DESCRIPTIONS = {
  get_file_metadata: 'One-call, licence-aware metadata for a Commons file: author, credit, brand marks, wiki block, restrictions, per-file licence and technical metadata. Attribution API signals are enriched with Action API extmetadata; site-wide licences are never substituted.',
  get_image_info: 'Compact machine-readable technical and licence view of one file: url, thumb_url, mime, dimensions, per-file licence short name/URL and attribution. Shares the get_file_metadata resolver but returns a smaller projection.',
} as const;
