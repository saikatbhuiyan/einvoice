import { Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  CreateInvoiceDto,
  DeleteInvoiceResponseDto,
  FindAllInvoicesDto,
  FindAllInvoicesResponseDto,
  InvoiceResponseDto,
  UpdateInvoiceDto,
} from '@libs/interfaces/gateway';
import { ApiEnvelopeDto, PaginationMetaDto, ProblemDetailDto } from '@libs/shared/types';

interface SwaggerSetupOptions {
  apiVersion: string;
  globalPrefix: string;
  nodeEnv: string;
  port: number;
}

export function setupSwagger(app: INestApplication, options: SwaggerSetupOptions): string {
  const docsPath = buildDocsPath(options.globalPrefix);
  const serverPath = buildServerPath(options.globalPrefix);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('E-Invoice BFF API')
    .setDescription(
      [
        'Production-facing REST API for E-Invoice web and mobile clients.',
        'Successful responses are wrapped in the standard API envelope.',
        'Errors use RFC 7807-style problem details with correlation IDs for support lookup.',
      ].join(' '),
    )
    .setVersion(options.apiVersion)
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer(serverPath, `${options.nodeEnv} gateway`)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token when an endpoint is protected by authentication.',
      },
      'jwt',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    deepScanRoutes: true,
    ignoreGlobalPrefix: true,
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
    extraModels: [
      ApiEnvelopeDto,
      ProblemDetailDto,
      PaginationMetaDto,
      CreateInvoiceDto,
      UpdateInvoiceDto,
      FindAllInvoicesDto,
      InvoiceResponseDto,
      FindAllInvoicesResponseDto,
      DeleteInvoiceResponseDto,
    ],
  });

  SwaggerModule.setup(docsPath, app, document, {
    customSiteTitle: 'E-Invoice BFF API Docs',
    jsonDocumentUrl: `${docsPath}/openapi.json`,
    yamlDocumentUrl: `${docsPath}/openapi.yaml`,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      docExpansion: 'none',
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      defaultModelsExpandDepth: 2,
      tryItOutEnabled: true,
    },
  });

  Logger.log(`Swagger UI: http://localhost:${options.port}/${docsPath}`, 'Swagger');
  Logger.log(`OpenAPI JSON: http://localhost:${options.port}/${docsPath}/openapi.json`, 'Swagger');

  return docsPath;
}

function buildDocsPath(globalPrefix: string): string {
  const prefix = trimSlashes(globalPrefix);
  return prefix ? `${prefix}/docs` : 'docs';
}

function buildServerPath(globalPrefix: string): string {
  const prefix = trimSlashes(globalPrefix);
  return prefix ? `/${prefix}` : '/';
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
