import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import type { AuthzModelConfig } from '@acl/shared-types';

import { authzModelSchema } from './schema';

export interface SchemaValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile<AuthzModelConfig>(authzModelSchema);

export function validateAuthzModel(config: unknown): SchemaValidationResult {
  const valid = validate(config);
  return {
    valid: Boolean(valid),
    errors: (validate.errors ?? []) as ErrorObject[],
  };
}

export function assertValidAuthzModel(config: unknown): asserts config is AuthzModelConfig {
  const result = validateAuthzModel(config);
  if (!result.valid) {
    const message = result.errors
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'schema validation failed'}`)
      .join('; ');
    throw new Error(`SCHEMA_VALIDATION_FAILED: ${message}`);
  }
}
