// Account deletion guards: ensure new FK references to auth.users are handled
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { USER_FK_REFERENCES } from "@/app/api/mobile/v1/account/delete/route";

// FK references that CASCADE on delete (don't need manual NULLing)
const CASCADE_ALLOW_LIST = [
  "profiles.id", // CASCADE by design
  "company_memberships.user_id", // CASCADE by design
];

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("account deletion FK guards", () => {
  it("proxy.ts publicRoutes contains /account-deletion", () => {
    const src = read("proxy.ts");
    const block = src.slice(
      src.indexOf("const publicRoutes"),
      src.indexOf("];", src.indexOf("const publicRoutes"))
    );
    expect(block).toContain("/account-deletion");
  });

  it("all FK references to auth.users are in USER_FK_REFERENCES or CASCADE", () => {
    // Scan all migration files for FK references to auth.users
    const migrationsDir = join(process.cwd(), "supabase/migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const foundRefs: Array<{ table: string; column: string; file: string }> =
      [];

    for (const file of files) {
      const sql = read(join("supabase/migrations", file));

      // Strategy: Look for lines with "REFERENCES auth.users" and extract table/column
      // We'll be conservative and only match clear FK constraint patterns

      // Pattern 1: ALTER TABLE table ADD CONSTRAINT ... FOREIGN KEY (column) REFERENCES auth.users
      const alterMatches = Array.from(
        sql.matchAll(
          /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:[\w.]+\.)?(\w+)\s+ADD\s+CONSTRAINT\s+\w+\s+FOREIGN\s+KEY\s*\((\w+)\)\s+REFERENCES\s+auth\.users(?!\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE)/gi
        )
      );

      for (const match of alterMatches) {
        const table = match[1]?.toLowerCase();
        const column = match[2]?.toLowerCase();
        if (
          table &&
          column &&
          !foundRefs.some((r) => r.table === table && r.column === column)
        ) {
          foundRefs.push({ table, column, file });
        }
      }

      // Pattern 2: CREATE TABLE with column REFERENCES auth.users (without CASCADE)
      // First, extract each CREATE TABLE statement
      const createTableMatches = Array.from(
        sql.matchAll(
          /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?(\w+)\s*\(([^;]+)\);/gi
        )
      );

      for (const tableMatch of createTableMatches) {
        const table = tableMatch[1]?.toLowerCase();
        const tableDef = tableMatch[2];

        // Look for column definitions with REFERENCES auth.users
        const colMatches = Array.from(
          tableDef.matchAll(
            /(\w+)\s+\w+(?:\([^)]+\))?\s+[\s\S]*?REFERENCES\s+auth\.users(?!\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE)/gi
          )
        );

        for (const colMatch of colMatches) {
          const column = colMatch[1]?.toLowerCase();
          if (
            table &&
            column &&
            // Filter out non-column matches
            ![
              "primary",
              "unique",
              "not",
              "default",
              "check",
              "constraint",
            ].includes(column) &&
            !foundRefs.some((r) => r.table === table && r.column === column)
          ) {
            foundRefs.push({ table, column, file });
          }
        }
      }
    }

    // Check each found reference
    const missing: Array<{ table: string; column: string; file: string }> = [];

    for (const ref of foundRefs) {
      const key = `${ref.table}.${ref.column}`;

      // Check if it's in CASCADE allow-list
      if (CASCADE_ALLOW_LIST.includes(key)) {
        continue;
      }

      // Check if it's in USER_FK_REFERENCES
      const inList = USER_FK_REFERENCES.some(
        (fk) => fk.table === ref.table && fk.column === ref.column
      );

      if (!inList) {
        missing.push(ref);
      }
    }

    // Report any missing references
    if (missing.length > 0) {
      const details = missing
        .map((m) => `  - ${m.table}.${m.column} (from ${m.file})`)
        .join("\n");
      throw new Error(
        `Found FK references to auth.users not in USER_FK_REFERENCES or CASCADE_ALLOW_LIST:\n${details}\n\nAdd them to USER_FK_REFERENCES in app/api/mobile/v1/account/delete/route.ts`
      );
    }

    // Verify we found at least the known references
    expect(foundRefs.length).toBeGreaterThan(10);
  });

  it("USER_FK_REFERENCES has the expected 13 entries", () => {
    expect(USER_FK_REFERENCES).toHaveLength(13);
  });
});
