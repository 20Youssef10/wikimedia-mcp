import { loadConfig } from './config.js';
import { Logger } from './observability/logging.js';
import { WikimediaClient } from './upstream/client.js';
import { startStdioTransport } from './transport/stdio.js';
import { startHttpTransport } from './transport/streamable-http.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);
  const client = new WikimediaClient(config);

  if (config.transport === 'stdio') {
    startStdioTransport(config, client, logger);
    return;
  }

  const handle = startHttpTransport(config, client, logger);
  await new Promise<void>((resolve) => {
    handle.server.listen(config.httpPort, config.httpHost, () => resolve());
  });
  logger.info('streamable-http transport ready', {
    host: config.httpHost,
    port: config.httpPort,
    path: config.httpPath,
  });

  const shutdown = async (): Promise<void> => {
    await handle.close();
    client.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`wikimedia-mcp failed to start: ${message}\n`);
  process.exit(1);
});
