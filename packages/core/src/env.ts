import { z } from 'zod';

export const environmentSchema = z.enum(['local', 'staging', 'prod']);
export type Environment = z.infer<typeof environmentSchema>;

const booleanFlagSchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .optional()
  .transform((val) => val === true || val === 'true' || val === '1');

const optionalHttpsUrlSchema = z
  .string()
  .trim()
  .optional()
  .transform((val) => (val === '' ? undefined : val))
  .refine(
    (val) => {
      if (val === undefined) return true;
      try {
        const parsed = new URL(val);
        return parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid https:// URL' },
  );

const optionalNonEmptyStringSchema = z
  .string()
  .trim()
  .optional()
  .transform((val) => (val === '' ? undefined : val));

export const envSchema = z
  .object({
    ENVIRONMENT: environmentSchema.default('local'),
    AI_INSIGHTS_ENABLED: booleanFlagSchema,
    DISCORD_WEBHOOK_URL: optionalHttpsUrlSchema,
    GEMINI_API_KEY: optionalNonEmptyStringSchema,
    ACCESS_TEAM_DOMAIN: optionalNonEmptyStringSchema,
    ACCESS_AUD: optionalNonEmptyStringSchema,
  })
  .superRefine((env, ctx) => {
    if (env.ENVIRONMENT !== 'local') {
      if (!env.ACCESS_TEAM_DOMAIN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ACCESS_TEAM_DOMAIN'],
          message: 'ACCESS_TEAM_DOMAIN is required in staging and prod',
        });
      }
      if (!env.ACCESS_AUD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ACCESS_AUD'],
          message: 'ACCESS_AUD is required in staging and prod',
        });
      }
    }
    if (env.AI_INSIGHTS_ENABLED && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when AI_INSIGHTS_ENABLED is true',
      });
    }
  });

export type ValidatedEnv = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, unknown>): ValidatedEnv {
  return envSchema.parse(raw);
}
