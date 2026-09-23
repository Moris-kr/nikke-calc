/**
 * The Python server's JSON-RPC envelope validation on the 2025-era HTTP transport
 * (`jsonrpc_message_adapter.validate_python`): which kind of message a body is, or the exact
 * "Validation error: …" text it answered with.
 */
import { Model, any, dict, int, lit, nullable, ref, str, union, validateModelUnion, type ValidationError } from './pydantic.ts';

const requestId = () => union(int({ strict: true }), str());

const JSONRPCRequest = new Model('JSONRPCRequest', [
  { name: 'jsonrpc', type: lit('2.0') },
  { name: 'id', type: requestId() },
  { name: 'method', type: str() },
  { name: 'params', type: nullable(dict()), default: null },
]);
const JSONRPCNotification = new Model('JSONRPCNotification', [
  { name: 'jsonrpc', type: lit('2.0') },
  { name: 'method', type: str() },
  { name: 'params', type: nullable(dict()), default: null },
]);
const JSONRPCResponse = new Model('JSONRPCResponse', [
  { name: 'jsonrpc', type: lit('2.0') },
  { name: 'id', type: requestId() },
  { name: 'result', type: dict() },
]);
const ErrorData = new Model('ErrorData', [
  { name: 'code', type: int() },
  { name: 'message', type: str() },
  { name: 'data', type: any(), default: null },
]);
const JSONRPCError = new Model('JSONRPCError', [
  { name: 'jsonrpc', type: lit('2.0') },
  { name: 'id', type: nullable(requestId()) },
  { name: 'error', type: ref(ErrorData) },
]);

const MEMBERS = [JSONRPCRequest, JSONRPCNotification, JSONRPCResponse, JSONRPCError];
const TITLE = 'union[JSONRPCRequest,JSONRPCNotification,JSONRPCResponse,JSONRPCError]';

export type EnvelopeKind = 'request' | 'notification' | 'response' | 'error';

function validates(model: Model, body: unknown): boolean {
  try {
    model.validate(body);
    return true;
  } catch {
    return false;
  }
}

/** `JSONRPCRequest.model_validate(body)` succeeds (the 2026-07-28 HTTP entry's request check). */
export const isJsonRpcRequest = (body: unknown): boolean => validates(JSONRPCRequest, body);
/** `JSONRPCNotification.model_validate(body)` succeeds. */
export const isJsonRpcNotification = (body: unknown): boolean => validates(JSONRPCNotification, body);

/**
 * Classify like pydantic's smart union: a body that is a valid request also validates as a notification
 * (extra keys are ignored), and the member with more matched fields wins.
 */
export function classifyEnvelope(body: unknown): EnvelopeKind | ValidationError {
  const outcome = validateModelUnion(TITLE, MEMBERS, body);
  if (!('matched' in outcome)) return outcome;
  const names = outcome.matched.map((m) => m.name);
  if (names.includes('JSONRPCRequest')) return 'request';
  if (names.includes('JSONRPCResponse')) return 'response';
  if (names.includes('JSONRPCError')) return 'error';
  return 'notification';
}
