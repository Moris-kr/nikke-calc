/**
 * The subset of pydantic 2.13 the Python server used, reproduced for an identical external contract:
 * validation (strict models, lax tool arguments), error text, `model_dump` and `model_json_schema`.
 *
 * Only the constructs in ./models.ts, ./boss_code.ts and ./shared_state.ts are supported. The error
 * messages and JSON Schema layout follow pydantic-core 2.46 / pydantic 2.13 byte for byte; the
 * `mcp-parity` script in ../README.md compares them against the last Python server.
 */
import { PyError } from '../../site/src/engine/py.ts';
import { PyFloat, PyInt, isDict, keepOrder, numberOf, orderedKeys, pyLen, pyRepr, pyStrip, pyTypeName, strRepr } from './pyjson.ts';

export const PYDANTIC_DOCS_VERSION = '2.13';

// ---------------------------------------------------------------------------------------------- types

export type Scalar = string | number | boolean;
export type T =
  | { k: 'str'; min?: number; max?: number; pattern?: string }
  | { k: 'int'; ge?: number; le?: number; gt?: number; strict?: boolean }
  | { k: 'float'; ge?: number; le?: number; gt?: number }
  | { k: 'bool' }
  | { k: 'lit'; values: readonly Scalar[] }
  | { k: 'list'; item: T; min?: number; max?: number }
  | { k: 'dict'; key?: T; value?: T; max?: number }
  | { k: 'nullable'; inner: T }
  | { k: 'union'; members: T[] }
  | { k: 'tagged'; disc: string; members: Model[] }
  | { k: 'model'; model: Model }
  | { k: 'any' };

export const str = (c: { min?: number; max?: number; pattern?: string } = {}): T => ({ k: 'str', ...c });
export const int = (c: { ge?: number; le?: number; gt?: number; strict?: boolean } = {}): T => ({ k: 'int', ...c });
export const float = (c: { ge?: number; le?: number; gt?: number } = {}): T => ({ k: 'float', ...c });
export const bool = (): T => ({ k: 'bool' });
export const lit = (...values: Scalar[]): T => ({ k: 'lit', values });
export const list = (item: T, c: { min?: number; max?: number } = {}): T => ({ k: 'list', item, ...c });
export const dict = (value?: T, key?: T, c: { max?: number } = {}): T => ({ k: 'dict', value, key, ...c });
export const nullable = (inner: T): T => ({ k: 'nullable', inner });
export const union = (...members: T[]): T => ({ k: 'union', members });
export const tagged = (disc: string, ...members: Model[]): T => ({ k: 'tagged', disc, members });
export const ref = (model: Model): T => ({ k: 'model', model });
export const any = (): T => ({ k: 'any' });

export interface FieldDef {
  name: string;
  type: T;
  alias?: string;
  /** Present (even as `null`) when the field has a default. */
  default?: unknown;
  factory?: () => unknown;
  description?: string;
  /** pydantic `json_schema_extra`: merged into the field schema only; never validated. */
  extra?: Record<string, unknown> | (() => Record<string, unknown>);
}

export type ModelValidator = (inst: Inst) => void;

export interface ModelOptions {
  strict?: boolean;
  forbid?: boolean;
  description?: string;
  validators?: ModelValidator[];
}

export class Model {
  readonly fields: FieldDef[];
  constructor(readonly name: string, fields: FieldDef[], readonly opts: ModelOptions = {}) {
    this.fields = fields;
  }

  /** Subclass: parent fields first (overrides keep their position), parent validators first. */
  extend(name: string, fields: FieldDef[], opts: ModelOptions = {}): Model {
    const merged = this.fields.map((f) => fields.find((g) => g.name === f.name) ?? f);
    for (const f of fields) if (!this.fields.some((g) => g.name === f.name)) merged.push(f);
    return new Model(name, merged, {
      strict: opts.strict ?? this.opts.strict,
      forbid: opts.forbid ?? this.opts.forbid,
      description: opts.description,
      validators: [...(this.opts.validators ?? []), ...(opts.validators ?? [])],
    });
  }

  field(name: string): FieldDef {
    const f = this.fields.find((x) => x.name === name);
    if (!f) throw new Error(`${this.name}.${name}`);
    return f;
  }

  /** `Model.model_validate(input)`. Throws {@link ValidationError}. */
  validate(input: unknown): Inst {
    const errors: LineError[] = [];
    const out = validateModel(this, input, [], errors);
    if (out === FAIL) throw new ValidationError(this.name, errors);
    return out as Inst;
  }

  /** `Model()` with keyword arguments: same as validate for these strict models. */
  create(values: Record<string, unknown> = {}): Inst {
    return this.validate(values);
  }
}

/** A validated model instance: field values by field name, plus pydantic's `model_fields_set`. */
export class Inst {
  constructor(readonly model: Model, readonly v: Record<string, any>, readonly set: Set<string>) {}
}

// --------------------------------------------------------------------------------------------- errors

export type Loc = Array<string | number>;
export interface LineError {
  type: string;
  loc: Loc;
  msg: string;
  input: unknown;
}

function lineErrorText(e: LineError): string {
  let input = pyRepr(e.input);
  const bytes = Buffer.from(input, 'utf8');
  if (bytes.length > 50) {
    // pydantic-core: first floor_char_boundary(25) bytes … last bytes from ceil_char_boundary(len - 24).
    let head = 25;
    while (head > 0 && (bytes[head]! & 0xc0) === 0x80) head -= 1;
    let tail = bytes.length - 24;
    while (tail < bytes.length && (bytes[tail]! & 0xc0) === 0x80) tail += 1;
    input = `${bytes.subarray(0, head).toString('utf8')}...${bytes.subarray(tail).toString('utf8')}`;
  }
  const loc = e.loc.length ? `${e.loc.map(String).join('.')}\n` : '';
  return `${loc}  ${e.msg} [type=${e.type}, input_value=${input}, input_type=${pyTypeName(e.input)}]\n`
    + `    For further information visit https://errors.pydantic.dev/${PYDANTIC_DOCS_VERSION}/v/${e.type}`;
}

/** pydantic `ValidationError` (a `ValueError` in Python). */
export class ValidationError extends Error {
  constructor(readonly title: string, readonly errors: LineError[]) {
    super('');
    this.message = this.toString();
    this.name = 'ValidationError';
  }

  override toString(): string {
    const n = this.errors.length;
    return `${n} validation error${n === 1 ? '' : 's'} for ${this.title}\n${this.errors.map(lineErrorText).join('\n')}`;
  }
}

/** `ValueError` raised from a model validator (message only, as Python's `str(error)`). */
export function isValueError(error: unknown): error is Error {
  return error instanceof ValidationError || (error instanceof PyError && error.pyType === 'ValueError');
}

const FAIL = Symbol('invalid');
type Out = unknown | typeof FAIL;

function num(x: number): string {
  return Number.isInteger(x) ? String(x) : String(x);
}

function literalExpected(values: readonly Scalar[]): string {
  const reprs = values.map((v) => pyRepr(v));
  return reprs.length === 1 ? reprs[0]! : `${reprs.slice(0, -1).join(', ')} or ${reprs[reprs.length - 1]}`;
}

function push(errors: LineError[], type: string, loc: Loc, msg: string, input: unknown): typeof FAIL {
  errors.push({ type, loc, msg, input });
  return FAIL;
}

function numeric(input: unknown): number | null {
  return numberOf(input);
}

function constrain(t: { ge?: number; le?: number; gt?: number }, value: number, loc: Loc, input: unknown, errors: LineError[]): Out {
  if (t.le !== undefined && !(value <= t.le)) return push(errors, 'less_than_equal', loc, `Input should be less than or equal to ${num(t.le)}`, input);
  if (t.ge !== undefined && !(value >= t.ge)) return push(errors, 'greater_than_equal', loc, `Input should be greater than or equal to ${num(t.ge)}`, input);
  if (t.gt !== undefined && !(value > t.gt)) return push(errors, 'greater_than', loc, `Input should be greater than ${num(t.gt)}`, input);
  return value;
}

function laxIntFromString(s: string): number | null {
  const text = pyStrip(s);
  if (/^[+-]?\d+(_\d+)*$/.test(text)) return Number(text.replace(/_/g, ''));
  if (/^[+-]?(\d+(_\d+)*)?\.?\d*(_\d+)*([eE][+-]?\d+)?$/.test(text) && /\d/.test(text)) {
    const value = Number(text.replace(/_/g, ''));
    if (Number.isFinite(value) && Number.isInteger(value)) return value;
  }
  return null;
}

const TRUE_WORDS = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE_WORDS = new Set(['0', 'off', 'f', 'false', 'n', 'no']);

function unionLabel(t: T): string {
  if (t.k === 'int') return t.ge !== undefined || t.le !== undefined || t.gt !== undefined ? 'constrained-int' : 'int';
  if (t.k === 'float') return t.ge !== undefined || t.le !== undefined || t.gt !== undefined ? 'constrained-float' : 'float';
  if (t.k === 'str') return t.min !== undefined || t.max !== undefined || t.pattern !== undefined ? 'constrained-str' : 'str';
  if (t.k === 'lit') return `literal[${t.values.map((v) => pyRepr(v)).join(',')}]`;
  if (t.k === 'model') return t.model.name;
  return t.k;
}

// ------------------------------------------------------------------------------------------ validate

function validate(t: T, input: unknown, strict: boolean, loc: Loc, errors: LineError[]): Out {
  switch (t.k) {
    case 'str': {
      if (typeof input !== 'string') return push(errors, 'string_type', loc, 'Input should be a valid string', input);
      const n = pyLen(input);
      if (t.min !== undefined && n < t.min) {
        return push(errors, 'string_too_short', loc, `String should have at least ${t.min} character${t.min === 1 ? '' : 's'}`, input);
      }
      if (t.max !== undefined && n > t.max) {
        return push(errors, 'string_too_long', loc, `String should have at most ${t.max} character${t.max === 1 ? '' : 's'}`, input);
      }
      if (t.pattern !== undefined && !new RegExp(t.pattern, 'u').test(input)) {
        return push(errors, 'string_pattern_mismatch', loc, `String should match pattern '${t.pattern}'`, input);
      }
      return input;
    }
    case 'int': {
      if (t.strict) strict = true;
      let value: number;
      const float = input instanceof PyFloat ? input.value : typeof input === 'number' && !Number.isInteger(input) ? input : null;
      if (float === null && (typeof input === 'number' || input instanceof PyInt)) value = numberOf(input)!;
      else if (!strict && float !== null) {
        if (!Number.isFinite(float)) return push(errors, 'finite_number', loc, 'Input should be a finite number', input);
        if (!Number.isInteger(float)) {
          return push(errors, 'int_from_float', loc, 'Input should be a valid integer, got a number with a fractional part', input);
        }
        value = float;
      } else if (!strict && typeof input === 'boolean') value = input ? 1 : 0;
      else if (!strict && typeof input === 'string') {
        const parsed = laxIntFromString(input);
        if (parsed === null) return push(errors, 'int_parsing', loc, 'Input should be a valid integer, unable to parse string as an integer', input);
        value = parsed;
      } else return push(errors, 'int_type', loc, 'Input should be a valid integer', input);
      return constrain(t, value, loc, input, errors);
    }
    case 'float': {
      const value = numeric(input);
      if (value === null) return push(errors, 'float_type', loc, 'Input should be a valid number', input);
      if (!Number.isFinite(value)) return push(errors, 'finite_number', loc, 'Input should be a finite number', input);
      return constrain(t, value, loc, input, errors);
    }
    case 'bool': {
      if (typeof input === 'boolean') return input;
      if (!strict) {
        const value = numeric(input);
        if (typeof input === 'number' && Number.isInteger(input)) {
          if (input === 0 || input === 1) return input === 1;
          return push(errors, 'bool_parsing', loc, 'Input should be a valid boolean, unable to interpret input', input);
        }
        if (value !== null && (value === 0 || value === 1)) return value === 1;
        if (typeof input === 'string') {
          const word = input.toLowerCase();
          if (TRUE_WORDS.has(word)) return true;
          if (FALSE_WORDS.has(word)) return false;
          return push(errors, 'bool_parsing', loc, 'Input should be a valid boolean, unable to interpret input', input);
        }
      }
      return push(errors, 'bool_type', loc, 'Input should be a valid boolean', input);
    }
    case 'lit': {
      for (const expected of t.values) {
        if (typeof expected === 'string') {
          if (input === expected) return expected;
        } else {
          // Python equality: Literal[1] also matches True and 1.0.
          const value = typeof input === 'boolean' ? (input ? 1 : 0) : numeric(input);
          if (value === expected) return expected;
        }
      }
      return push(errors, 'literal_error', loc, `Input should be ${literalExpected(t.values)}`, input);
    }
    case 'list': {
      if (!Array.isArray(input)) return push(errors, 'list_type', loc, 'Input should be a valid list', input);
      if (t.max !== undefined && input.length > t.max) {
        return push(errors, 'too_long', loc,
          `List should have at most ${t.max} item${t.max === 1 ? '' : 's'} after validation, not ${input.length}`, input);
      }
      const before = errors.length;
      const out = input.map((item, index) => validate(t.item, item, strict, [...loc, index], errors));
      if (errors.length > before) return FAIL;
      if (t.min !== undefined && out.length < t.min) {
        return push(errors, 'too_short', loc,
          `List should have at least ${t.min} item${t.min === 1 ? '' : 's'} after validation, not ${out.length}`, input);
      }
      return out;
    }
    case 'dict': {
      if (!isDict(input)) return push(errors, 'dict_type', loc, 'Input should be a valid dictionary', input);
      if (t.value === undefined && t.key === undefined) return input;
      const entries = orderedKeys(input).map((k): [string, unknown] => [k, input[k]]);
      if (t.max !== undefined && entries.length > t.max) {
        return push(errors, 'too_long', loc,
          `Dictionary should have at most ${t.max} item${t.max === 1 ? '' : 's'} after validation, not ${entries.length}`, input);
      }
      const before = errors.length;
      const out: Record<string, unknown> = {};
      for (const [key, value] of entries) {
        const k = t.key ? validate(t.key, key, strict, [...loc, key, '[key]'], errors) : key;
        const v = t.value ? validate(t.value, value, strict, [...loc, key], errors) : value;
        if (k !== FAIL && v !== FAIL) out[k as string] = v;
      }
      return errors.length > before ? FAIL : keepOrder(out, Object.keys(out).length === entries.length ? entries.map(([k]) => k) : Object.keys(out));
    }
    case 'nullable':
      return input === null ? null : validate(t.inner, input, strict, loc, errors);
    case 'union': {
      const attempts: LineError[][] = [];
      for (const member of t.members) {
        const sub: LineError[] = [];
        const out = validate(member, input, strict, [...loc, unionLabel(member)], sub);
        if (out !== FAIL) return out;
        attempts.push(sub);
      }
      for (const sub of attempts) errors.push(...sub);
      return FAIL;
    }
    case 'tagged': {
      const discriminator = strRepr(t.disc);
      if (!isDict(input)) {
        return push(errors, 'model_attributes_type', loc, 'Input should be a valid dictionary or object to extract fields from', input);
      }
      if (!Object.hasOwn(input, t.disc)) return push(errors, 'union_tag_not_found', loc, `Unable to extract tag using discriminator ${discriminator}`, input);
      const tag = input[t.disc];
      const tags = t.members.map((m) => (m.field(t.disc).type as unknown as { values: Scalar[] }).values[0]!);
      const index = tags.findIndex((x) => x === tag);
      if (index < 0) {
        return push(errors, 'union_tag_invalid', loc,
          `Input tag '${typeof tag === 'string' ? tag : pyRepr(tag)}' found using ${discriminator} does not match any of the expected tags: ${tags.map((x) => pyRepr(x)).join(', ')}`,
          input);
      }
      return validateModel(t.members[index]!, input, [...loc, String(tag)], errors);
    }
    case 'model':
      return validateModel(t.model, input, loc, errors);
    case 'any':
      return input;
  }
}

function validateModel(model: Model, input: unknown, loc: Loc, errors: LineError[]): Out {
  if (input instanceof Inst && input.model === model) return input;
  if (!isDict(input)) {
    return push(errors, 'model_type', loc, `Input should be a valid dictionary or instance of ${model.name}`, input);
  }
  const strict = model.opts.strict ?? false;
  const before = errors.length;
  const values: Record<string, unknown> = {};
  const set = new Set<string>();
  const known = new Set<string>();
  for (const f of model.fields) {
    const key = f.alias ?? f.name;
    known.add(key);
    if (Object.hasOwn(input, key)) {
      const out = validate(f.type, input[key], strict, [...loc, key], errors);
      if (out !== FAIL) values[f.name] = out;
      set.add(f.name);
    } else if (f.factory) {
      values[f.name] = f.factory();
    } else if ('default' in f) {
      values[f.name] = f.default;
    } else {
      push(errors, 'missing', [...loc, key], 'Field required', input);
    }
  }
  if (model.opts.forbid) {
    for (const [key, value] of Object.entries(input)) {
      if (!known.has(key)) push(errors, 'extra_forbidden', [...loc, key], 'Extra inputs are not permitted', value);
    }
  }
  if (errors.length > before) return FAIL;
  const inst = new Inst(model, values, set);
  for (const validator of model.opts.validators ?? []) {
    try {
      validator(inst);
    } catch (error) {
      if (!isValueError(error)) throw error;
      return push(errors, 'value_error', loc, `Value error, ${error instanceof ValidationError ? error.toString() : error.message}`, input);
    }
  }
  return inst;
}

// ------------------------------------------------------------------------------------ tool arguments

/**
 * The MCP SDK's per-tool argument model: lax (not strict), extra arguments ignored, and a string passed
 * for a non-`str` parameter is first tried as JSON (`FuncMetadata.pre_parse_json`).
 */
export class ArgModel {
  readonly model: Model;
  constructor(readonly tool: string, fields: FieldDef[], private readonly parse: (text: string) => unknown) {
    this.model = new Model(`${tool}Arguments`, fields, { strict: false, forbid: false });
  }

  validate(args: Record<string, unknown>): Record<string, any> {
    const data: Record<string, unknown> = { ...args };
    for (const f of this.model.fields) {
      const key = f.alias ?? f.name;
      const value = data[key];
      if (typeof value !== 'string' || f.type.k === 'str' || !Object.hasOwn(data, key)) continue;
      let parsed: unknown;
      try {
        parsed = this.parse(value);
      } catch {
        continue;
      }
      if (typeof parsed === 'string' || typeof parsed === 'boolean' || numberOf(parsed) !== null) continue;
      data[key] = parsed;
    }
    const inst = this.model.validate(data);
    return inst.v;
  }

  schema(): Record<string, unknown> {
    const { type: _type, ...rest } = jsonSchema(this.model);
    return { type: 'object', ...rest };
  }
}

// ---------------------------------------------------------------------------------------------- dump

export interface DumpOptions {
  excludeNone?: boolean;
  excludeUnset?: boolean;
  exclude?: ReadonlySet<string>;
  /** Keep Python number types (float fields as {@link PyFloat}) for byte-size checks. */
  py?: boolean;
}

/** `model.model_dump(...)` with `serialize_by_alias=True`. */
export function dump(inst: Inst, options: DumpOptions = {}): Record<string, any> {
  const out: Record<string, any> = {};
  const nested = { ...options, exclude: undefined };
  for (const f of inst.model.fields) {
    if (options.exclude?.has(f.name)) continue;
    const isSet = inst.set.has(f.name);
    if (options.excludeUnset && !isSet) continue;
    const value = inst.v[f.name];
    if (options.excludeNone && value == null) continue;
    out[f.alias ?? f.name] = dumpValue(f.type, value, nested, isSet);
  }
  return out;
}

function dumpValue(t: T, value: unknown, options: DumpOptions, validated: boolean): unknown {
  if (value instanceof Inst) return dump(value, options);
  if (value === null || value === undefined) return value ?? null;
  switch (t.k) {
    case 'float':
      return options.py && validated && typeof value === 'number' ? new PyFloat(value) : value;
    case 'nullable':
      return dumpValue(t.inner, value, options, validated);
    case 'list':
      return (value as unknown[]).map((v) => dumpValue(t.item, v, options, validated));
    case 'dict': {
      const out: Record<string, unknown> = {};
      const keys = orderedKeys(value as Record<string, unknown>);
      for (const k of keys) {
        const v = (value as Record<string, unknown>)[k];
        out[k] = t.value ? dumpValue(t.value, v, options, validated) : dumpAny(v, options);
      }
      return keepOrder(out, keys);
    }
    case 'union': {
      // int | Literal[...]: values are already Python ints/strings.
      return value;
    }
    case 'any':
      return dumpAny(value, options);
    default:
      return value;
  }
}

function dumpAny(value: unknown, options: DumpOptions): unknown {
  if (value instanceof PyFloat || value instanceof PyInt) return options.py ? value : value.value;
  if (Array.isArray(value)) return value.map((v) => dumpAny(v, options));
  if (isDict(value)) {
    const out: Record<string, unknown> = {};
    const keys = orderedKeys(value);
    for (const k of keys) out[k] = dumpAny(value[k], options);
    return keepOrder(out, keys);
  }
  return value;
}

// -------------------------------------------------------------------------------------- JSON Schema

function title(name: string): string {
  // Python `name.title().replace('_', ' ')`.
  let out = '';
  let previousCased = false;
  for (const ch of name) {
    const cased = ch.toLowerCase() !== ch.toUpperCase();
    out += cased ? (previousCased ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    previousCased = cased;
  }
  return out.replace(/_/g, ' ');
}

function typeSchema(t: T, defs: Map<string, Record<string, unknown>>): Record<string, unknown> {
  switch (t.k) {
    case 'str':
      return { type: 'string', ...(t.min !== undefined && { minLength: t.min }), ...(t.max !== undefined && { maxLength: t.max }),
        ...(t.pattern !== undefined && { pattern: t.pattern }) };
    case 'int':
    case 'float':
      return { type: t.k === 'int' ? 'integer' : 'number', ...(t.ge !== undefined && { minimum: t.ge }),
        ...(t.le !== undefined && { maximum: t.le }), ...(t.gt !== undefined && { exclusiveMinimum: t.gt }) };
    case 'bool':
      return { type: 'boolean' };
    case 'lit': {
      const type = typeof t.values[0] === 'string' ? 'string' : 'integer';
      return t.values.length === 1 ? { const: t.values[0], type } : { enum: [...t.values], type };
    }
    case 'list':
      return { items: typeSchema(t.item, defs), ...(t.min !== undefined && { minItems: t.min }),
        ...(t.max !== undefined && { maxItems: t.max }), type: 'array' };
    case 'dict': {
      if (t.value === undefined && t.key === undefined) return { additionalProperties: true, type: 'object' };
      const out: Record<string, unknown> = { additionalProperties: t.value ? typeSchema(t.value, defs) : true };
      if (t.key && t.key.k === 'lit') out['propertyNames'] = { enum: [...t.key.values] };
      if (t.max !== undefined) out['maxProperties'] = t.max;
      out['type'] = 'object';
      return out;
    }
    case 'nullable':
      return { anyOf: [typeSchema(t.inner, defs), { type: 'null' }] };
    case 'union':
      return { anyOf: t.members.map((m) => typeSchema(m, defs)) };
    case 'tagged': {
      const mapping: Record<string, string> = {};
      for (const m of t.members) {
        mapping[String((m.field(t.disc).type as unknown as { values: Scalar[] }).values[0])] = `#/$defs/${m.name}`;
        register(m, defs);
      }
      return { discriminator: { mapping, propertyName: t.disc }, oneOf: t.members.map((m) => ({ $ref: `#/$defs/${m.name}` })) };
    }
    case 'model':
      register(t.model, defs);
      return { $ref: `#/$defs/${t.model.name}` };
    case 'any':
      return {};
  }
}

function isModelField(t: T): boolean {
  return t.k === 'model' || (t.k === 'nullable' && t.inner.k === 'model');
}

function fieldSchema(f: FieldDef, defs: Map<string, Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...typeSchema(f.type, defs) };
  if (!isModelField(f.type)) out['title'] = title(f.alias ?? f.name);
  if ('default' in f && !f.factory) out['default'] = f.default;
  if (f.description !== undefined) out['description'] = f.description;
  if (f.extra) Object.assign(out, typeof f.extra === 'function' ? f.extra() : f.extra);
  return out;
}

function modelBody(model: Model, defs: Map<string, Record<string, unknown>>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of model.fields) {
    const key = f.alias ?? f.name;
    properties[key] = fieldSchema(f, defs);
    if (!('default' in f) && !f.factory) required.push(key);
  }
  return {
    ...(model.opts.forbid && { additionalProperties: false }),
    ...(model.opts.description !== undefined && { description: model.opts.description }),
    properties,
    ...(required.length && { required }),
    title: model.name,
    type: 'object',
  };
}

function register(model: Model, defs: Map<string, Record<string, unknown>>): void {
  if (defs.has(model.name)) return;
  defs.set(model.name, {});
  defs.set(model.name, modelBody(model, defs));
}

/** pydantic `GenerateJsonSchema.sort`: keys sorted except under `properties` and `default`. */
function sortSchema(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => sortSchema(v, parentKey));
  if (!isDict(value)) return value;
  if (parentKey === 'default') return value;
  const keys = parentKey === 'properties' ? Object.keys(value) : Object.keys(value).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = sortSchema(value[key], key);
  return out;
}

/** `Model.model_json_schema()`. */
export function jsonSchema(model: Model): Record<string, unknown> {
  const defs = new Map<string, Record<string, unknown>>();
  const body = modelBody(model, defs);
  defs.delete(model.name);
  const out: Record<string, unknown> = { ...body };
  if (defs.size) out['$defs'] = Object.fromEntries(defs);
  return sortSchema(out) as Record<string, unknown>;
}

/**
 * `TypeAdapter(A | B | …).validate_python(input)` for a union of (lax) models: the members that
 * validate, in declaration order, or the combined error (each member's errors under its name).
 */
export function validateModelUnion(title: string, members: readonly Model[], input: unknown): { matched: Model[] } | ValidationError {
  const matched: Model[] = [];
  const errors: LineError[] = [];
  for (const model of members) {
    const sub: LineError[] = [];
    if (validateModel(model, input, [model.name], sub) !== FAIL) matched.push(model);
    else errors.push(...sub);
  }
  return matched.length ? { matched } : new ValidationError(title, errors);
}
