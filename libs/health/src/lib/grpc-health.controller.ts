import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Public } from '@libs/auth/public.decorator';

/** grpc.health.v1.HealthCheckResponse.ServingStatus -- see libs/transports/src/proto/health.proto. */
const SERVING = 1;

/**
 * Serves the standard grpc.health.v1 Health/Check RPC on every gRPC server that registers it
 * (createGrpcServerConfig() loads health.proto alongside the service's own proto).
 *
 * `@Public()` is required, not optional: RpcPermissionGuard runs for gRPC calls too, and a health
 * probe carries no RpcEnvelope -- without it, every probe is rejected with 16 UNAUTHENTICATED,
 * the same failure the gRPC series hit with RoleGrpcController.findAllRoles.
 *
 * Answers SERVING whenever the process can answer at all. Deeper "is this server's database up"
 * questions belong to its HTTP `ready` endpoint, not this one.
 */
@Controller()
export class GrpcHealthController {
  @Public()
  @GrpcMethod('Health', 'Check')
  check(): { status: number } {
    return { status: SERVING };
  }
}
