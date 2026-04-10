import { IsBoolean, IsIn, IsNotEmpty, IsString, ValidationError, validateSync } from 'class-validator';

/** Well-known environment names — prevents typos like "prod" vs "production" */
const KNOWN_ENVS = ['development', 'production', 'test', 'staging'] as const;
export type NodeEnv = (typeof KNOWN_ENVS)[number];

export class BaseConfiguration {
  @IsString()
  @IsNotEmpty()
  @IsIn(KNOWN_ENVS, { message: `NODE_ENV must be one of: ${KNOWN_ENVS.join(', ')}` })
  NODE_ENV: NodeEnv;

  readonly IS_DEVELOPMENT: boolean;
  readonly IS_PRODUCTION: boolean;
  readonly IS_TEST: boolean;
  readonly IS_STAGING: boolean;

  @IsString()
  @IsNotEmpty()
  GLOBAL_PREFIX: string;

  constructor() {
    this.NODE_ENV = (process.env['NODE_ENV'] ?? '') as NodeEnv;
    this.IS_DEVELOPMENT = this.NODE_ENV === 'development';
    this.IS_PRODUCTION = this.NODE_ENV === 'production';
    this.IS_STAGING = this.NODE_ENV === 'staging';
    this.IS_TEST = this.NODE_ENV === 'test';
    this.GLOBAL_PREFIX = process.env['GLOBAL_PREFIX'] ?? '';
  }

  validate(): void {
    const errors = validateSync(this);
    if (errors.length === 0) return;

    const messages = this.flattenErrors(errors);

    // Use console.error because NestJS Logger is not available at config-validation time
    console.error(`[Configuration] Validation failed:\n${messages.map((m) => `  ✗ ${m}`).join('\n')}`);

    throw new Error(`Configuration validation failed:\n${messages.map((m) => `  - ${m}`).join('\n')}`);
  }

  private flattenErrors(errors: ValidationError[], parentPath = ''): string[] {
    const messages: string[] = [];
    for (const error of errors) {
      const field = parentPath ? `${parentPath}.${error.property}` : error.property;
      if (error.constraints) {
        messages.push(...Object.values(error.constraints).map((msg) => `[${field}] ${msg}`));
      }
      if (error.children?.length) {
        messages.push(...this.flattenErrors(error.children, field));
      }
    }
    return messages;
  }
}
