import { Transport } from '@nestjs/microservices';
import { GRPCHealthIndicator, HealthIndicatorFunction, MicroserviceHealthIndicator } from '@nestjs/terminus';
import { GRPC_SERVICES, TCP_SERVICES, type GrpcServiceKey, type TcpServiceName } from '@libs/transports';
import { HEALTH_CHECK_TIMEOUT_MS } from './health.config';

/**
 * Peer checks for the `dependencies` endpoint only (see BaseHealthController for why they never
 * feed liveness or readiness). Both reuse the same host/port registries the real clients use,
 * so a check can't silently target a different address than the actual traffic does.
 */
export function tcpPeerCheck(indicator: MicroserviceHealthIndicator, service: TcpServiceName): HealthIndicatorFunction {
  const { host, port } = TCP_SERVICES[service];
  return () =>
    indicator.pingCheck(`tcp_${service.toLowerCase()}`, {
      transport: Transport.TCP,
      options: { host, port },
      timeout: HEALTH_CHECK_TIMEOUT_MS,
    });
}

/**
 * Calls the standard grpc.health.v1 Health/Check RPC (the same protocol Kubernetes' gRPC probes
 * use) -- so the peer has to actually serve it; see GrpcHealthController. The empty service name
 * asks about the server as a whole, per the gRPC health-checking spec.
 */
export function grpcPeerCheck(indicator: GRPCHealthIndicator, service: GrpcServiceKey): HealthIndicatorFunction {
  const { host, port } = GRPC_SERVICES[service];
  return () =>
    indicator.checkService(`grpc_${service.toLowerCase()}`, '', {
      url: `${host}:${port}`,
      timeout: HEALTH_CHECK_TIMEOUT_MS,
    });
}
