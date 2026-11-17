-- normalizeCompanyName now drops a trailing "Technologies", "International", "Group"... (see
-- COMPANY_TRAILING_TOKENS in core/src/normalize.ts); recompute the stored names to match
UPDATE "companies" SET "normalized_name" = regexp_replace("normalized_name", '( (technologies|technology|international|group|holdings|incorporated|limited|plc))+$', '')
WHERE "normalized_name" ~ ' (technologies|technology|international|group|holdings|incorporated|limited|plc)$';--> statement-breakpoint
-- Suggestion ids are normalized names too; a renamed one that would collide is left to age out
UPDATE "suggestions" AS s SET "id" = regexp_replace(s."id", '( (technologies|technology|international|group|holdings|incorporated|limited|plc))+$', '')
WHERE s."id" ~ ' (technologies|technology|international|group|holdings|incorporated|limited|plc)$'
  AND NOT EXISTS (
    SELECT 1 FROM "suggestions" o
    WHERE o."id" <> s."id"
      AND regexp_replace(o."id", '( (technologies|technology|international|group|holdings|incorporated|limited|plc))+$', '')
        = regexp_replace(s."id", '( (technologies|technology|international|group|holdings|incorporated|limited|plc))+$', '')
  );
