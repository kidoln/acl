import { describe, expect, it } from 'vitest';

import { parseSelector } from '../src/parser';

describe('policy dsl parser spike', () => {
  it('parses comparison clause', () => {
    const result = parseSelector('object.type == kb', 'object_selector');

    expect(result.ok).toBe(true);
    expect(result.ast?.clauses[0]).toMatchObject({
      type: 'comparison',
      left: 'object.type',
      right: 'kb',
    });
  });

  it('parses includes and conjunction clauses', () => {
    const result = parseSelector(
      'subject.relations includes member_of(group:g1) and object.type == kb',
      'subject_selector',
    );

    expect(result.ok).toBe(true);
    expect(result.ast?.clauses).toHaveLength(2);
    expect(result.ast?.clauses[0]).toMatchObject({
      type: 'includes',
      left: 'subject.relations',
      relation: 'member_of',
      args: [{ key: 'group', value: 'g1' }],
    });
  });

  it('returns parse error with clause position', () => {
    const result = parseSelector('object.type = kb', 'object_selector');

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('SELECTOR_PARSE_ERROR');
    expect(result.errors[0]?.offset).toBe(0);
  });
});
