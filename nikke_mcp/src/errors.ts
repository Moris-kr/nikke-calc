/** Expected service failures with stable, public error codes. (py: nikke_mcp/errors.py) */
import { ValidationError } from './pydantic.ts';
import { pySlice } from './pyjson.ts';

/** An anticipated tool failure: its message reaches the client (`mcp` ToolError). */
export class ToolError extends Error {
  override name = 'ToolError';
}

/** Python `InvalidSettingsError(ValueError)`. */
export class InvalidSettingsError extends Error {
  override name = 'InvalidSettingsError';
}

export class ServerBusyError extends Error {
  override name = 'ServerBusyError';
}

export class EngineProcessError extends Error {
  override name = 'EngineProcessError';
}

/** Python's builtin `TimeoutError`. */
export class CalculationTimeoutError extends Error {
  override name = 'TimeoutError';
}

export function fail(code: string, message: string): never {
  throw new ToolError(`[${code}] ${message}`);
}

/** Expose anticipated failures; keep unexpected exceptions masked by the MCP layer. */
export async function public_errors<R>(body: () => R | Promise<R>): Promise<R> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ServerBusyError) throw new ToolError(`[SERVER_BUSY] ${error.message}`);
    if (error instanceof CalculationTimeoutError) throw new ToolError(`[CALCULATION_TIMEOUT] ${error.message}`);
    if (error instanceof EngineProcessError) throw new ToolError(`[ENGINE_PROCESS_FAILED] ${error.message}`);
    if (error instanceof InvalidSettingsError) throw new ToolError(`[INVALID_SETTINGS] ${pySlice(error.message, 1500)}`);
    if (error instanceof ValidationError) {
      const details = error.errors.map((row) => `${row.loc.map(String).join('.')}: ${row.msg}`).join('; ');
      throw new ToolError(`[INVALID_SETTINGS] ${pySlice(details, 1500)}`);
    }
    throw error;
  }
}
