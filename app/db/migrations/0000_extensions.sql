-- Extensions required by the schema (gen_random_uuid). PG13+ has it built in;
-- pgcrypto makes it explicit and portable.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
