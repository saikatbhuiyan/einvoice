import { ClientProviderOptions, MicroserviceOptions, Transport } from '@nestjs/microservices';

/**
 * Builds standard TCP Server configurations for bootstrapping Microservices via NestFactory.
 * Using 0.0.0.0 by default is a best practice for containerized (e.g. Docker/k8s) deployments.
 */
export function buildTcpMicroserviceOptions(port: number, host = '0.0.0.0'): MicroserviceOptions {
  return {
    transport: Transport.TCP,
    options: {
      host,
      port,
    },
  };
}

/**
 * Builds TCP Client registrations for injecting via ClientsModule inside controllers/gateways.
 */
export function buildTcpClientOptions(name: string, port: number, host = '127.0.0.1'): ClientProviderOptions {
  return {
    name,
    transport: Transport.TCP,
    options: {
      host,
      port,
    },
  };
}
