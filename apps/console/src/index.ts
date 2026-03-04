import { startConsoleServer } from './server';

export const consoleBootstrapMessage = 'ACL console MVP is ready';

function resolvePort(): number {
  const raw = process.env.ACL_CONSOLE_PORT ?? process.env.PORT;
  const parsed = Number(raw);
  if (raw && Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return 3020;
}

if (require.main === module) {
  startConsoleServer({ port: resolvePort() })
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`${consoleBootstrapMessage} on :${resolvePort()}`);
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}
