import { join } from 'path';
import { GrpcOptions, Transport } from '@nestjs/microservices';

export enum GrpcServiceName {
  AUTHORIZER = 'AUTHORIZER',
  USER_ACCESS_ROLE_QUERY = 'USER_ACCESS_ROLE_QUERY',
}

interface GrpcServiceDefinition {
  host: string;
  port: number;
  package: string;
  protoFileName: string;
}

// __dirname here resolves at *runtime*, inside whichever app's bundled main.js this code ends up
// in (this whole lib gets bundled into each app's own output, not run as a separate package) — so
// this points at dist/apps/<app>/proto, not this lib's own source tree. Each app's webpack config
// has to actually copy the .proto files there (an Nx `assets` entry); referencing the path alone
// doesn't make webpack bundle a non-JS file into main.js, the same class of gap that bit
// ratelimit.lua earlier — @grpc/proto-loader needs a real file on disk at runtime, not a string.
const PROTO_DIR = join(__dirname, 'proto');

export const GRPC_SERVICES: Record<GrpcServiceName, GrpcServiceDefinition> = {
  [GrpcServiceName.AUTHORIZER]: {
    host: process.env['AUTHORIZER_GRPC_HOST'] ?? 'localhost',
    port: Number(process.env['AUTHORIZER_GRPC_PORT'] ?? 3307),
    package: 'authorizer',
    protoFileName: 'authorizer.proto',
  },
  [GrpcServiceName.USER_ACCESS_ROLE_QUERY]: {
    host: process.env['USER_ACCESS_GRPC_HOST'] ?? 'localhost',
    port: Number(process.env['USER_ACCESS_GRPC_PORT'] ?? 3308),
    package: 'userAccess',
    protoFileName: 'user-access.proto',
  },
};

export type GrpcServiceKey = keyof typeof GrpcServiceName;

export const GRPC_CLIENT_TOKENS = {
  [GrpcServiceName.AUTHORIZER]: 'GRPC_CLIENT_AUTHORIZER',
  [GrpcServiceName.USER_ACCESS_ROLE_QUERY]: 'GRPC_CLIENT_USER_ACCESS_ROLE_QUERY',
} as const satisfies Record<GrpcServiceKey, string>;

export type GrpcClientToken = (typeof GRPC_CLIENT_TOKENS)[GrpcServiceKey];

export function createGrpcServerConfig(service: GrpcServiceKey): GrpcOptions {
  const def = GRPC_SERVICES[service];
  return {
    transport: Transport.GRPC,
    options: {
      package: def.package,
      protoPath: join(PROTO_DIR, def.protoFileName),
      url: `0.0.0.0:${def.port}`,
    },
  };
}

export function createGrpcClientConfig(service: GrpcServiceKey) {
  const def = GRPC_SERVICES[service];
  return {
    name: GRPC_CLIENT_TOKENS[service],
    transport: Transport.GRPC,
    options: {
      package: def.package,
      protoPath: join(PROTO_DIR, def.protoFileName),
      url: `${def.host}:${def.port}`,
    },
  } as const;
}
