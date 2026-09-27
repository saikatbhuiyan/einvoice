import { BaseConfiguration, loadEnvironmentFiles, PostgresConfiguration } from '@libs/configuration';
import { KeycloakAdminConfiguration } from '@libs/auth/keycloak-admin.config';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

loadEnvironmentFiles();

class Configuration extends BaseConfiguration {
  @ValidateNested()
  @Type(() => PostgresConfiguration)
  POSTGRES_CONFIG: PostgresConfiguration = new PostgresConfiguration();

  @ValidateNested()
  @Type(() => KeycloakAdminConfiguration)
  KEYCLOAK_ADMIN_CONFIG: KeycloakAdminConfiguration = new KeycloakAdminConfiguration();
}

// Validated eagerly at module load time
export const CONFIGURATION = new Configuration();
CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
