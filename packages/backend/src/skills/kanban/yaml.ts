import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Enforce canonical status list from design doc
export const STATUSES = [
  'candidate',
  'planned',
  'in_progress',
  'in_review',
  'merging',
  'blocked',
  'done',
] as const;

// Zod Schema for kanban truth validation
const TaskBlockerSchema = z.object({
  kind: z.enum(['decision', 'intervention_needed', 'merge_conflict', 'dependency']),
  ref: z.string().optional(),
  summary: z.string(),
});

const TaskItemSchema = z.object({
  ref: z.string().min(1),
  status: z.enum(STATUSES),
  title: z.string().min(1),
  // Body must contain Acceptance Criteria or be explicit that it doesn't need them
  body: z.string(),
  dependencyTaskList: z.array(z.string()).default([]),
  blockers: z.array(TaskBlockerSchema).optional(),
  testBehavior: z.string().optional(), // For testing
});

export const TodoBoardSchema = z.object({
  version: z.number().default(1),
  goal: z.object({
    goalKey: z.string(),
    title: z.string(),
  }),
  items: z.array(TaskItemSchema),
});

export type TodoBoard = z.infer<typeof TodoBoardSchema>;
export type TaskItem = z.infer<typeof TaskItemSchema>;

/**
 * Validates the raw parsed YAML object against the schema.
 * Throws a detailed error if validation fails.
 */
export function validateBoard(data: unknown): TodoBoard {
  const parsed = TodoBoardSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid todo.yml format: ${issues}`);
  }

  // Cross-validation: Check for duplicate refs
  const refs = new Set<string>();
  for (const item of parsed.data.items) {
    if (refs.has(item.ref)) {
      throw new Error(`Duplicate task ref found: ${item.ref}`);
    }
    refs.add(item.ref);
  }

  // Cross-validation: Ensure dependencies point to existing refs
  for (const item of parsed.data.items) {
    for (const dep of item.dependencyTaskList) {
      if (!refs.has(dep)) {
        throw new Error(`Task '${item.ref}' depends on non-existent task: '${dep}'`);
      }
    }
  }

  // Simple cycle detection
  const checkCycles = (ref: string, visited = new Set<string>(), path: string[] = []) => {
    if (visited.has(ref)) {
      throw new Error(`Dependency cycle detected: ${path.join(' -> ')} -> ${ref}`);
    }
    visited.add(ref);
    path.push(ref);

    const task = parsed.data.items.find((i) => i.ref === ref);
    if (task) {
      for (const dep of task.dependencyTaskList) {
        checkCycles(dep, new Set(visited), [...path]);
      }
    }
  };

  for (const item of parsed.data.items) {
    checkCycles(item.ref);
  }

  // Acceptance Criteria check for engineering tasks.
  // We relax this rule slightly if it's a 'candidate' to allow rough drafts,
  // but it's required for 'planned' onwards.
  for (const item of parsed.data.items) {
    if (item.status !== 'candidate' && item.status !== 'done') {
      const lowerBody = item.body.toLowerCase();
      if (!lowerBody.includes('acceptance criteria') && !lowerBody.includes('acceptance contract')) {
        console.warn(`[WARN] Task '${item.ref}' (${item.status}) is missing 'Acceptance Criteria' in body. Task granularity might be unclear.`);
      }
    }
  }

  return parsed.data;
}

/**
 * Read and validate a YAML file.
 */
export function readYaml(filePath: string): TodoBoard {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const raw = parse(content);
    return validateBoard(raw);
  } catch (error) {
    throw new Error(`Failed to read/parse YAML at ${filePath}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Stringify and write the validated board state back to YAML.
 */
export function stringifyYaml(board: TodoBoard): string {
  // Ensure we validate before outputting just to be safe
  validateBoard(board);
  return stringify(board, { indent: 2 });
}
