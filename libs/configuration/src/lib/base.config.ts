import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  ValidationError,
  validateSync,
} from 'class-validator';
import { Logger } from '@nestjs/common';

export class BaseConfiguration {
  private readonly logger = new Logger(BaseConfiguration.name);

  @IsString()
  @IsNotEmpty()
  NODE_ENV: string;

  @IsBoolean()
  @IsNotEmpty()
  IS_DEVELOPMENT: boolean;

  @IsBoolean()
  @IsNotEmpty()
  IS_PRODUCTION: boolean;

  @IsBoolean()
  @IsNotEmpty()
  IS_TEST: boolean;

  @IsString()
  @IsNotEmpty()
  GLOBAL_PREFIX: string;

  constructor() {
    this.NODE_ENV = process.env['NODE_ENV'] ?? '';
    this.IS_DEVELOPMENT = this.NODE_ENV === 'development';
    this.IS_PRODUCTION = this.NODE_ENV === 'production';
    this.IS_TEST = this.NODE_ENV === 'test';
    this.GLOBAL_PREFIX = process.env['GLOBAL_PREFIX'] ?? '';
  }

  validate() {
    const errors = validateSync(this);
    if (errors.length > 0) {
      const messages = this.flattenErrors(errors);
      const message = messages.join('; ');

      this.logger.error(
        `Configuration validation failed:\n${messages.map((m) => `  - ${m}`).join('\n')}`,
      );

      throw new Error(`Configuration validation failed: ${message}`);
    }
  }

  private flattenErrors(errors: ValidationError[], parentPath = ''): string[] {
    const messages: string[] = [];
    for (const error of errors) {
      const field = parentPath
        ? `${parentPath}.${error.property}`
        : error.property;
      if (error.constraints) {
        messages.push(
          ...Object.values(error.constraints).map((msg) => `[${field}] ${msg}`),
        );
      }
      if (error.children && error.children.length > 0) {
        messages.push(...this.flattenErrors(error.children, field));
      }
    }
    return messages;
  }
}
