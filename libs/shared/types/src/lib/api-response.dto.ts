import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ApiEnvelope, PaginationMeta, ProblemDetail } from './api-response.types';

export class PaginationMetaDto implements PaginationMeta {
  @ApiProperty({ example: 1, minimum: 1, description: 'Current result page.' })
  page!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 100, description: 'Maximum records returned per page.' })
  limit!: number;

  @ApiProperty({ example: 73, minimum: 0, description: 'Total records matching the query.' })
  total!: number;

  @ApiProperty({ example: 4, minimum: 0, description: 'Total number of available pages.' })
  totalPages!: number;

  @ApiProperty({ example: true, description: 'Whether another page exists after the current page.' })
  hasNextPage!: boolean;

  @ApiProperty({ example: false, description: 'Whether a page exists before the current page.' })
  hasPreviousPage!: boolean;
}

export class CursorPaginationMetaDto {
  @ApiProperty({ example: 20, minimum: 1, maximum: 100, description: 'Maximum records returned per page.' })
  limit!: number;

  @ApiProperty({ example: true, description: 'Whether another page exists after the current result set.' })
  hasNextPage!: boolean;

  @ApiPropertyOptional({
    example: 'eyJfdWlkIjoiNjJmOWQzOGYyYWI3YzAwMWY1MmM5MDEifQ==',
    description: 'Opaque cursor to pass as the `cursor` query parameter for the next page. Absent on the last page.',
  })
  cursor?: string;
}

export class ApiEnvelopeDto<T = unknown, M = unknown> implements ApiEnvelope<T, M> {
  @ApiProperty({ example: true, description: 'Indicates that the request completed successfully.' })
  success!: boolean;

  @ApiProperty({ example: 200, description: 'HTTP status code returned by the endpoint.' })
  statusCode!: number;

  @ApiProperty({ example: 'OK', description: 'Human-readable outcome message.' })
  message!: string;

  @ApiProperty({
    example: '01HWN0N6VNJY4A4Y9K2Q48ZY6Q',
    description: 'Correlation identifier echoed from the x-correlation-id request header.',
  })
  correlationId!: string;

  @ApiProperty({ example: '2026-04-28T10:30:00.000Z', format: 'date-time' })
  timestamp!: string;

  @ApiPropertyOptional({ example: '12.4ms', description: 'Server-side request duration when available.' })
  duration?: string;

  @ApiPropertyOptional({ description: 'Endpoint response payload. Shape depends on the operation.' })
  data?: T;

  @ApiPropertyOptional({ description: 'Optional metadata for list or aggregate responses.' })
  meta?: M;
}

export class ProblemDetailDto implements ProblemDetail {
  @ApiProperty({ example: 'https://httpstatuses.io/422', description: 'Stable problem type URI.' })
  type!: string;

  @ApiProperty({ example: 'Unprocessable Entity', description: 'Short, stable problem title.' })
  title!: string;

  @ApiProperty({ example: 422, description: 'HTTP status code for the problem.' })
  status!: number;

  @ApiPropertyOptional({
    example: 'One or more fields failed validation.',
    description: 'Human-readable detail for this occurrence.',
  })
  detail?: string;

  @ApiPropertyOptional({ example: '/api/v1/invoices', description: 'Request path where the problem occurred.' })
  instance?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
    example: {
      '/body/client.email': ['email must be an email'],
    },
    description: 'Field-level validation errors keyed by JSON pointer.',
  })
  errors?: Record<string, string[]>;

  @ApiPropertyOptional({
    example: '01HWN0N6VNJY4A4Y9K2Q48ZY6Q',
    description: 'Correlation identifier for support and log lookup.',
  })
  traceId?: string;
}
