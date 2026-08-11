import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

import { listPromptDefinitions } from '@/lib/ai-prompts/catalog';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['app', 'components', 'lib'] as const;
const AI_WRAPPER_FILES = new Set([
  'lib/ai.ts',
  'lib/stream/ai.ts',
  'lib/stream/raw-ai.ts',
]);
const EXTERNAL_MANAGED_CONFIGS: Readonly<Record<string, readonly string[]>> = {
  'app/api/generate-game-card/handler.ts': ['lib/game-card/config.ts'],
};
const SHARED_MANAGED_CONFIG_CALLS = new Set([
  // The fallback call reuses baseConfig with a different modelOverride.
  'lib/review/auto-data-card-review.ts',
]);

const toRepoPath = (filePath: string): string =>
  path.relative(ROOT, filePath).split(path.sep).join('/');

const listTypeScriptFiles = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(entryPath));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(entryPath);
    }
  }
  return files;
};

const sourceFiles = SOURCE_ROOTS.flatMap((directory) =>
  listTypeScriptFiles(path.join(ROOT, directory)),
);

const sourceByPath = new Map(
  sourceFiles.map((filePath) => [toRepoPath(filePath), readFileSync(filePath, 'utf8')]),
);

const countDirectAiCalls = (repoPath: string, source: string): number => {
  const sourceFile = ts.createSourceFile(
    repoPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    repoPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'generateWithAI' || node.expression.text === 'generateWithStreamAI')
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
};

describe('managed AI prompt production coverage', () => {
  test('every direct AI wrapper call declares a managed prompt reference', () => {
    const uncovered: string[] = [];

    for (const [repoPath, source] of sourceByPath) {
      if (AI_WRAPPER_FILES.has(repoPath)) continue;
      const directCallCount = countDirectAiCalls(repoPath, source);
      if (directCallCount === 0) continue;

      const relatedSources = [
        source,
        ...(EXTERNAL_MANAGED_CONFIGS[repoPath] ?? []).map((configPath) => sourceByPath.get(configPath) ?? ''),
      ].join('\n');
      const managedRefCount = relatedSources.match(/\bpromptRef(?:Builder)?\s*:/g)?.length ?? 0;
      if (managedRefCount < directCallCount && !SHARED_MANAGED_CONFIG_CALLS.has(repoPath)) {
        uncovered.push(`${repoPath} (${directCallCount} calls, ${managedRefCount} refs)`);
      }
    }

    expect(uncovered, 'Direct AI call sites without promptRef/promptRefBuilder').toEqual([]);
  });

  test('every active catalog prompt has a production source reference', () => {
    const productionSource = [...sourceByPath.entries()]
      .filter(([repoPath]) => repoPath !== 'lib/ai-prompts/catalog.ts')
      .map(([, source]) => source)
      .join('\n');
    const unreferenced = listPromptDefinitions()
      .filter((definition) => definition.active && !productionSource.includes(definition.id))
      .map((definition) => definition.id);

    expect(unreferenced, 'Active prompt IDs without a production source reference').toEqual([]);
  });

  test('business modules cannot bypass the managed AI wrappers', () => {
    const sdkFunctions = new Set(['generateObject', 'generateText', 'streamObject', 'streamText']);
    const bypasses: string[] = [];

    for (const [repoPath, source] of sourceByPath) {
      if (AI_WRAPPER_FILES.has(repoPath)) continue;
      const sourceFile = ts.createSourceFile(
        repoPath,
        source,
        ts.ScriptTarget.Latest,
        true,
        repoPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      for (const statement of sourceFile.statements) {
        if (
          !ts.isImportDeclaration(statement)
          || !ts.isStringLiteral(statement.moduleSpecifier)
          || statement.moduleSpecifier.text !== 'ai'
        ) continue;
        const namedBindings = statement.importClause?.namedBindings;
        if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
        for (const element of namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (sdkFunctions.has(importedName)) bypasses.push(`${repoPath}:${importedName}`);
        }
      }
    }

    expect(bypasses, 'Business modules importing Vercel AI generation APIs directly').toEqual([]);
  });
});
