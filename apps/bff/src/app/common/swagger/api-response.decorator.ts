import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiHeader, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiEnvelopeDto, ProblemDetailDto } from '@libs/shared/types';

const correlationIdExample = '01HWN0N6VNJY4A4Y9K2Q48ZY6Q';

const problemTitles: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};

interface ApiEnvelopeResponseOptions {
  status: HttpStatus;
  description: string;
  model: Type<unknown>;
  message?: string;
  dataExample?: unknown;
  isArray?: boolean;
}

export function ApiCorrelationIdHeader() {
  return ApiHeader({
    name: 'x-correlation-id',
    required: false,
    description:
      'Optional request correlation ID. The same value is returned in success envelopes and problem details.',
    schema: {
      type: 'string',
      example: correlationIdExample,
    },
  });
}

export function ApiEnvelopeResponse(options: ApiEnvelopeResponseOptions) {
  const dataSchema = options.isArray
    ? {
        type: 'array',
        items: { $ref: getSchemaPath(options.model) },
      }
    : { $ref: getSchemaPath(options.model) };

  const example =
    options.dataExample === undefined
      ? undefined
      : {
          success: {
            summary: 'Successful response',
            value: {
              success: true,
              statusCode: options.status,
              message: options.message ?? problemTitles[options.status] ?? 'OK',
              correlationId: correlationIdExample,
              timestamp: '2026-04-28T10:30:00.000Z',
              duration: '12.4ms',
              data: options.dataExample,
            },
          },
        };

  return applyDecorators(
    ApiExtraModels(ApiEnvelopeDto, options.model),
    ApiResponse({
      status: options.status,
      description: options.description,
      content: {
        'application/json': {
          schema: {
            allOf: [
              { $ref: getSchemaPath(ApiEnvelopeDto) },
              {
                type: 'object',
                required: ['success', 'statusCode', 'message', 'correlationId', 'timestamp', 'data'],
                properties: {
                  statusCode: { type: 'number', example: options.status },
                  message: { type: 'string', example: options.message ?? problemTitles[options.status] ?? 'OK' },
                  data: dataSchema,
                },
              },
            ],
          },
          examples: example,
        },
      },
    }),
  );
}

export function ApiProblemResponses(...statuses: HttpStatus[]) {
  return applyDecorators(
    ApiExtraModels(ProblemDetailDto),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: problemTitles[status] ?? `HTTP ${status}`,
        content: {
          'application/problem+json': {
            schema: { $ref: getSchemaPath(ProblemDetailDto) },
            examples: {
              problem: {
                summary: problemTitles[status] ?? `HTTP ${status}`,
                value: problemExample(status),
              },
            },
          },
        },
      }),
    ),
  );
}

function problemExample(status: HttpStatus): ProblemDetailDto {
  if (status === HttpStatus.UNPROCESSABLE_ENTITY) {
    return {
      type: 'https://httpstatuses.io/422',
      title: 'Unprocessable Entity',
      status,
      detail: 'One or more fields failed validation.',
      instance: '/api/v1/invoices',
      errors: {
        '/body/client.email': ['email must be an email'],
      },
      traceId: correlationIdExample,
    };
  }

  return {
    type: `https://httpstatuses.io/${status}`,
    title: problemTitles[status] ?? `HTTP ${status}`,
    status,
    detail: defaultProblemDetail(status),
    instance: '/api/v1/invoices',
    traceId: correlationIdExample,
  };
}

function defaultProblemDetail(status: HttpStatus): string {
  const details: Record<number, string> = {
    [HttpStatus.NOT_FOUND]: 'The requested resource was not found.',
    [HttpStatus.CONFLICT]: 'The request conflicts with the current resource state.',
    [HttpStatus.BAD_GATEWAY]: 'A downstream service returned an invalid response.',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'A downstream service is temporarily unavailable.',
  };

  return details[status] ?? 'The request could not be completed.';
}
