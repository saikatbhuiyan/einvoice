import { BaseConfiguration, loadEnvironmentFiles } from '@libs/configuration';

loadEnvironmentFiles();

class Configuration extends BaseConfiguration {}

// Validated eagerly at module load time
export const CONFIGURATION = new Configuration();
CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
