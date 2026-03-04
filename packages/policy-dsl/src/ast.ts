export type SelectorScope = 'subject_selector' | 'object_selector';

export interface SelectorAst {
  type: 'selector';
  scope: SelectorScope;
  source: string;
  clauses: ClauseNode[];
}

export type ClauseNode = ComparisonClauseNode | IncludesClauseNode;

export interface ComparisonClauseNode {
  type: 'comparison';
  left: string;
  operator: '==';
  right: string;
}

export interface IncludesClauseNode {
  type: 'includes';
  left: string;
  relation: string;
  args: RelationArg[];
}

export interface RelationArg {
  key: string;
  value: string;
}

export interface SelectorParseError {
  code: 'SELECTOR_PARSE_ERROR';
  message: string;
  scope: SelectorScope;
  clause_index: number;
  offset: number;
  clause: string;
}

export interface SelectorParseResult {
  ok: boolean;
  ast?: SelectorAst;
  errors: SelectorParseError[];
}
