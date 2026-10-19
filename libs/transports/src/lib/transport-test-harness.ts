/**
 * Spec-only helpers for transport tests (real Nest microservices on real sockets). Imported by
 * subpath (`@libs/transports/transport-test-harness`), never from the barrel or app code — same
 * convention as `@libs/telemetry/otel-test-harness`.
 */
import { createServer } from 'net';
import { basename, join } from 'path';

// Under jest there is no bundled dist/apps/<app>/proto, which is where grpc.config.ts's PROTO_DIR
// points at runtime; the source copies live next to this file's directory.
const SOURCE_PROTO_DIR = join(__dirname, '..', 'proto');

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')),
      );
    });
  });
}

export const sourceProtoPath = (fileName: string) => join(SOURCE_PROTO_DIR, fileName);

type GrpcLikeConfig = { options?: { protoPath?: string | string[]; url?: string } };

/** Points a createGrpcServerConfig()/createGrpcClientConfig() result at source protos and a test address. */
export function forTest<T extends GrpcLikeConfig>(config: T, port: number): T {
  const protoPath = config.options?.protoPath ?? [];
  const resolveSource = (path: string) => sourceProtoPath(basename(path));

  return {
    ...config,
    options: {
      ...config.options,
      protoPath: Array.isArray(protoPath) ? protoPath.map(resolveSource) : resolveSource(protoPath),
      url: `127.0.0.1:${port}`,
    },
  };
}
