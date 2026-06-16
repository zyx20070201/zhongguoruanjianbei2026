export interface ToolValidationResult {
  ok: boolean;
  input: Record<string, unknown>;
  errors: string[];
}

const typeOf = (value: unknown) => {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
};

const coerceScalar = (value: unknown, schema: any) => {
  if (schema?.type === 'number' && typeof value === 'string' && value.trim()) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  if (schema?.type === 'boolean' && typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
};

export const validateToolInput = (
  input: Record<string, unknown>,
  schema: Record<string, unknown>
): ToolValidationResult => {
  const objectSchema = schema as any;
  if (!objectSchema || objectSchema.type !== 'object') {
    return { ok: true, input, errors: [] };
  }

  const properties = objectSchema.properties && typeof objectSchema.properties === 'object'
    ? objectSchema.properties as Record<string, any>
    : {};
  const required = Array.isArray(objectSchema.required) ? objectSchema.required.map(String) : [];
  const additionalProperties = objectSchema.additionalProperties !== false;
  const normalized: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const key of required) {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      errors.push(`Missing required field: ${key}`);
    }
  }

  for (const [key, rawValue] of Object.entries(input || {})) {
    const propertySchema = properties[key];
    if (!propertySchema) {
      if (additionalProperties) normalized[key] = rawValue;
      else errors.push(`Unknown field: ${key}`);
      continue;
    }

    const value = coerceScalar(rawValue, propertySchema);
    const expectedType = propertySchema.type;
    if (expectedType && typeOf(value) !== expectedType) {
      errors.push(`Field ${key} expected ${expectedType}, got ${typeOf(value)}`);
      continue;
    }
    if (Array.isArray(propertySchema.enum) && !propertySchema.enum.includes(value)) {
      errors.push(`Field ${key} must be one of: ${propertySchema.enum.join(', ')}`);
      continue;
    }
    if (typeof value === 'number') {
      if (typeof propertySchema.minimum === 'number' && value < propertySchema.minimum) {
        errors.push(`Field ${key} must be >= ${propertySchema.minimum}`);
        continue;
      }
      if (typeof propertySchema.maximum === 'number' && value > propertySchema.maximum) {
        errors.push(`Field ${key} must be <= ${propertySchema.maximum}`);
        continue;
      }
    }
    normalized[key] = value;
  }

  return { ok: errors.length === 0, input: normalized, errors };
};
