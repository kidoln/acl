import type {
  ClauseNode,
  ComparisonClauseNode,
  IncludesClauseNode,
  RelationArg,
  SelectorParseError,
  SelectorParseResult,
  SelectorScope,
} from './ast';

const PATH_PATTERN = String.raw`[a-zA-Z_][a-zA-Z0-9_.]*`;
const VALUE_PATTERN = String.raw`(?:"[^"]+"|'[^']+'|[a-zA-Z0-9_.:-]+)`;

const comparisonPattern = new RegExp(
  String.raw`^\s*(${PATH_PATTERN})\s*==\s*(${VALUE_PATTERN})\s*$`,
);

const includesPattern = new RegExp(
  String.raw`^\s*(${PATH_PATTERN})\s+includes\s+([a-zA-Z_][a-zA-Z0-9_]*)\(([^)]*)\)\s*$`,
);

function normalizeValue(raw: string): string {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseRelationArgs(raw: string): RelationArg[] | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const parts = trimmed.split(',').map((part) => part.trim());
  const args: RelationArg[] = [];

  for (const part of parts) {
    const segment = part.split(':');
    if (segment.length !== 2) {
      return null;
    }

    const key = segment[0]?.trim();
    const value = segment[1]?.trim();

    if (!key || !value) {
      return null;
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      return null;
    }

    if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
      return null;
    }

    args.push({ key, value });
  }

  return args;
}

function parseClause(rawClause: string): ClauseNode | null {
  const comparisonMatch = rawClause.match(comparisonPattern);
  if (comparisonMatch) {
    const node: ComparisonClauseNode = {
      type: 'comparison',
      left: comparisonMatch[1],
      operator: '==',
      right: normalizeValue(comparisonMatch[2]),
    };
    return node;
  }

  const includesMatch = rawClause.match(includesPattern);
  if (includesMatch) {
    const args = parseRelationArgs(includesMatch[3]);
    if (!args) {
      return null;
    }

    const node: IncludesClauseNode = {
      type: 'includes',
      left: includesMatch[1],
      relation: includesMatch[2],
      args,
    };
    return node;
  }

  return null;
}

function buildError(
  selector: string,
  scope: SelectorScope,
  rawClause: string,
  clauseIndex: number,
): SelectorParseError {
  const offset = selector.indexOf(rawClause);
  return {
    code: 'SELECTOR_PARSE_ERROR',
    message: 'selector clause does not match supported DSL subset',
    scope,
    clause_index: clauseIndex,
    offset: offset >= 0 ? offset : 0,
    clause: rawClause,
  };
}

export function parseSelector(selector: string, scope: SelectorScope): SelectorParseResult {
  const clauses = selector.split(/\s+and\s+/).map((part) => part.trim());
  const astClauses: ClauseNode[] = [];
  const errors: SelectorParseError[] = [];

  clauses.forEach((clause, index) => {
    if (!clause) {
      errors.push({
        code: 'SELECTOR_PARSE_ERROR',
        message: 'empty clause is not allowed',
        scope,
        clause_index: index,
        offset: 0,
        clause,
      });
      return;
    }

    const parsed = parseClause(clause);
    if (!parsed) {
      errors.push(buildError(selector, scope, clause, index));
      return;
    }

    astClauses.push(parsed);
  });

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }

  return {
    ok: true,
    ast: {
      type: 'selector',
      scope,
      source: selector,
      clauses: astClauses,
    },
    errors: [],
  };
}
