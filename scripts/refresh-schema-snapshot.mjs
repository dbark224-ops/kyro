#!/usr/bin/env node
// Regenerates scripts/schema-snapshot.json from the live Supabase schema.
//
// The snapshot is what `check-db-columns.mjs` validates every `.select(...)`
// against in CI, so CI never needs database credentials. Re-run this whenever a
// migration adds, renames, or drops a column:
//
//   node scripts/refresh-schema-snapshot.mjs
//
// Requires the Supabase CLI, logged in and able to read the project.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "bsmjcthgodaoadkatfwo";
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "schema-snapshot.json",
);

/**
 * Pulls `Tables: { <name>: { Row: { <col>: type } } }` out of the generated
 * Supabase types. Brace-counting rather than a regex, because the Row bodies
 * contain nested object types.
 */
export function parseGeneratedTypes(source) {
  const tables = {};
  const tablesStart = source.indexOf("Tables: {");

  if (tablesStart === -1) {
    throw new Error(
      "Could not find a `Tables: {` block in the generated types.",
    );
  }

  const tableRe = /^ {6}([a-z0-9_]+): \{$/gm;
  tableRe.lastIndex = tablesStart;

  let match;

  while ((match = tableRe.exec(source))) {
    const tableName = match[1];
    const rowStart = source.indexOf("Row: {", match.index);

    if (rowStart === -1) {
      continue;
    }

    let depth = 1;
    let index = rowStart + "Row: {".length;

    while (index < source.length && depth > 0) {
      const char = source[index];

      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;

      index += 1;
    }

    const body = source.slice(rowStart + "Row: {".length, index - 1);
    const columns = [];

    for (const line of body.split("\n")) {
      const column = /^\s{10}([a-z0-9_]+)(\?)?:/.exec(line);

      if (column) {
        columns.push(column[1]);
      }
    }

    if (columns.length > 0) {
      tables[tableName] = columns.sort();
    }
  }

  return tables;
}

function main() {
  // Windows needs shell:true to run supabase.cmd (Node refuses to spawn .cmd
  // directly), and shell:true means the ref must be validated before it is
  // interpolated into a command line.
  if (!/^[a-z0-9]{16,32}$/.test(PROJECT_REF)) {
    throw new Error(
      `Refusing to run with an unexpected project ref: ${PROJECT_REF}`,
    );
  }

  process.stderr.write(`Generating types for project ${PROJECT_REF}...\n`);

  const isWindows = process.platform === "win32";
  const generated = execFileSync(
    isWindows ? "supabase.cmd" : "supabase",
    ["gen", "types", "typescript", "--project-id", PROJECT_REF],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      shell: isWindows,
    },
  );

  const tables = parseGeneratedTypes(generated);
  const names = Object.keys(tables);

  if (names.length === 0) {
    throw new Error(
      "Parsed zero tables - refusing to write an empty snapshot.",
    );
  }

  writeFileSync(
    OUT,
    `${JSON.stringify({ generatedFrom: PROJECT_REF, tables }, null, 2)}\n`,
  );

  const columnCount = names.reduce((sum, name) => sum + tables[name].length, 0);
  process.stderr.write(
    `Wrote ${names.length} tables / ${columnCount} columns to schema-snapshot.json\n`,
  );
}

// pathToFileURL keeps this correct on Windows, where a naive `file://` + path
// concatenation produces two slashes instead of three and never matches.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
