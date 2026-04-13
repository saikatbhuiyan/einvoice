import { TcpOptions, Transport } from '@nestjs/microservices';

export enum ServiceName {
  INVOICE = 'INVOICE',
  USER = 'USER',
  NOTIFICATION = 'NOTIFICATION',
  PAYMENT = 'PAYMENT',
}

export const TCP_SERVICES = {
  [ServiceName.INVOICE]: {
    host: process.env['INVOICE_SERVICE_HOST'] ?? 'localhost',
    port: Number(process.env['INVOICE_SERVICE_PORT'] ?? 3301),
  },
  [ServiceName.USER]: {
    host: process.env['USER_SERVICE_HOST'] ?? 'localhost',
    port: Number(process.env['USER_SERVICE_PORT'] ?? 3002),
  },
  [ServiceName.NOTIFICATION]: {
    host: process.env['NOTIFICATION_SERVICE_HOST'] ?? 'localhost',
    port: Number(process.env['NOTIFICATION_SERVICE_PORT'] ?? 3003),
  },
  [ServiceName.PAYMENT]: {
    host: process.env['PAYMENT_SERVICE_HOST'] ?? 'localhost',
    port: Number(process.env['PAYMENT_SERVICE_PORT'] ?? 3004),
  },
} as const;

export type TcpServiceName = keyof typeof ServiceName;

export const TCP_CLIENT_TOKENS = {
  [ServiceName.INVOICE]: 'TCP_CLIENT_INVOICE',
  [ServiceName.USER]: 'TCP_CLIENT_USER',
  [ServiceName.NOTIFICATION]: 'TCP_CLIENT_NOTIFICATION',
  [ServiceName.PAYMENT]: 'TCP_CLIENT_PAYMENT',
} as const satisfies Record<TcpServiceName, string>;

export type TcpClientToken = (typeof TCP_CLIENT_TOKENS)[TcpServiceName];

export function createTcpServerConfig(service: TcpServiceName): TcpOptions {
  const { host, port } = TCP_SERVICES[service];
  return {
    transport: Transport.TCP,
    options: {
      host,
      port,
      retryAttempts: 5,
      retryDelay: 3_000,
    },
  };
}

export function createTcpClientConfig(service: TcpServiceName) {
  const { host, port } = TCP_SERVICES[service];
  return {
    name: TCP_CLIENT_TOKENS[service],
    transport: Transport.TCP,
    options: {
      host,
      port,
      retryAttempts: 5,
      retryDelay: 3_000,
    },
  } as const;
}
