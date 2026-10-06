import { BaseConfiguration, loadEnvironmentFiles } from '@libs/configuration';
import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

loadEnvironmentFiles();

class S3Configuration {
  @IsString()
  @IsNotEmpty()
  S3_BUCKET: string;

  @IsString()
  @IsNotEmpty()
  S3_REGION: string;

  /** Override for an S3-compatible endpoint (s3mock in dev) — unset means "talk to real AWS S3". */
  S3_ENDPOINT?: string;

  /**
   * Both unset (the production default) means "use the AWS SDK's own default credential
   * provider chain" — an ECS task role or EC2 instance profile, not a static key pair baked into
   * an env var. That's the AWS-recommended posture whenever the deployment target can actually
   * hold an IAM role; set both only where it can't (dev against s3mock, or a host with no IAM
   * role attached).
   */
  @IsOptional()
  @IsString()
  S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_ACCESS_KEY?: string;

  /** MinIO/s3mock need path-style URLs (bucket in the path); real AWS S3 defaults to virtual-hosted style. */
  S3_FORCE_PATH_STYLE: boolean;

  /** Base URL returned to callers for an uploaded object — s3mock's own host in dev, a CDN/public bucket URL in prod. */
  S3_PUBLIC_BASE_URL?: string;

  constructor() {
    this.S3_BUCKET = process.env['S3_BUCKET'] ?? '';
    this.S3_REGION = process.env['S3_REGION'] ?? 'us-east-1';
    this.S3_ENDPOINT = process.env['S3_ENDPOINT'];
    this.S3_ACCESS_KEY_ID = process.env['S3_ACCESS_KEY_ID'] || undefined;
    this.S3_SECRET_ACCESS_KEY = process.env['S3_SECRET_ACCESS_KEY'] || undefined;
    this.S3_FORCE_PATH_STYLE = process.env['S3_FORCE_PATH_STYLE'] === 'true';
    this.S3_PUBLIC_BASE_URL = process.env['S3_PUBLIC_BASE_URL'];
  }
}

class Configuration extends BaseConfiguration {
  @ValidateNested()
  @Type(() => S3Configuration)
  S3_CONFIG: S3Configuration = new S3Configuration();
}

// Validated eagerly at module load time
export const CONFIGURATION = new Configuration();
CONFIGURATION.validate();

export type TConfiguration = typeof CONFIGURATION;
