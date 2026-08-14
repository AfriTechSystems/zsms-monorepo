#!/usr/bin/env node
/**
 * PreToolUse guard for Supabase MCP calls.
 *
 * Permission rules match on tool name only, so allowing `execute_sql` for
 * routine dev queries would equally allow `DROP TABLE`. This hook restores the
 * distinction: reads and additive DDL proceed, destructive statements and any
 * project other than zsms-dev escalate to the user.
 *
 * Contract: exit 0 with a permissionDecision of "ask" to escalate, or exit 0
 * silently to fall through to the normal permission flow.
 */

const DEV_PROJECT_REF = 'tevblmcebsqqjgzjptgw'; // zsms-dev

/**
 * Destructive or irreversible SQL. Anchored to statement starts where possible
 * to avoid matching the words inside string literals or comments.
 */
const DESTRUCTIVE_PATTERNS = [
  { re: /\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE|FUNCTION|POLICY|INDEX|TRIGGER|TYPE|EXTENSION|VIEW|ROLE)\b/i, why: 'DROP' },
  { re: /\bTRUNCATE\b/i, why: 'TRUNCATE' },
  { re: /\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i, why: 'ALTER TABLE ... DROP' },
  { re: /\bDELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i, why: 'DELETE without WHERE' },
  { re: /\bUPDATE\b[\s\S]*\bSET\b(?![\s\S]*\bWHERE\b)/i, why: 'UPDATE without WHERE' },
  { re: /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i, why: 'disabling RLS' },
  { re: /\bDROP\s+OWNED\b/i, why: 'DROP OWNED' },
  { re: /\bREASSIGN\s+OWNED\b/i, why: 'REASSIGN OWNED' },
];

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

function passThrough() {
  process.exit(0);
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // A malformed payload must not silently widen permissions.
    ask('Guard hook could not parse the tool payload; confirm this call manually.');
    return;
  }

  const toolName = payload.tool_name || '';
  const input = payload.tool_input || {};

  if (!/Supabase/i.test(toolName)) passThrough();

  // 1. Project scope. Only zsms-dev may be touched without confirmation.
  const projectId = input.project_id || input.projectId;
  if (projectId && projectId !== DEV_PROJECT_REF) {
    ask(
      `This targets Supabase project "${projectId}", not zsms-dev (${DEV_PROJECT_REF}). ` +
        `Staging and production changes require explicit approval — see CONVENTIONS.md prohibition 10.`
    );
  }

  // 2. Destructive SQL, in either the query or migration body.
  const sql = [input.query, input.sql, input.migration_sql, input.body]
    .filter((v) => typeof v === 'string')
    .join('\n;\n');

  if (sql) {
    for (const { re, why } of DESTRUCTIVE_PATTERNS) {
      if (re.test(sql)) {
        ask(
          `Destructive SQL detected (${why}). ZSMS forbids hard deletes on students, ` +
            `fee records, payments, and exam results, and every table needs its RLS policy intact. ` +
            `Review the statement before allowing it.`
        );
      }
    }
  }

  passThrough();
});
