import type { Observable } from 'rxjs';

// No codegen (ts-proto etc.) here — these interfaces are hand-written to match
// libs/transports/src/proto/*.proto exactly. Good enough for two small, stable contracts; would
// be worth generating if this grows to more services or the protos start changing often.

export interface GrpcRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
}

export interface RoleQueryServiceClient {
  findAllRoles(request: Record<string, never>): Observable<{ roles: GrpcRole[] }>;
}

export interface GetPermissionsForRolesRequest {
  roles: string[];
}

export interface GetPermissionsForRolesResponse {
  permissions: string[];
}
