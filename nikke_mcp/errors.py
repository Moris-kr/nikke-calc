"""Expected service failures with stable, public error codes."""
from contextlib import contextmanager

from mcp.server.mcpserver.exceptions import ToolError
from pydantic import ValidationError


class InvalidSettingsError(ValueError):
    pass


class ServerBusyError(ValueError):
    pass


class EngineProcessError(ValueError):
    pass


@contextmanager
def public_errors():
    """Expose anticipated failures; keep unexpected exceptions masked by the SDK."""
    try:
        yield
    except ServerBusyError as error:
        raise ToolError(f'[SERVER_BUSY] {error}') from error
    except TimeoutError as error:
        raise ToolError(f'[CALCULATION_TIMEOUT] {error}') from error
    except EngineProcessError as error:
        raise ToolError(f'[ENGINE_PROCESS_FAILED] {error}') from error
    except InvalidSettingsError as error:
        raise ToolError(f'[INVALID_SETTINGS] {str(error)[:1500]}') from error
    except ValidationError as error:
        details = '; '.join(f"{'.'.join(map(str, row['loc']))}: {row['msg']}"
                            for row in error.errors(include_input=False, include_url=False))
        raise ToolError(f'[INVALID_SETTINGS] {details[:1500]}') from error
