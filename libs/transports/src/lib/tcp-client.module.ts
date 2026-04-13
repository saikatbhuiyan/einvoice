import { DynamicModule, Module } from '@nestjs/common';
import { ClientsModule, ClientProvider } from '@nestjs/microservices';
import { TcpServiceName, createTcpClientConfig } from './tcp.config';

@Module({})
export class TcpClientModule {
  static forServices(services: TcpServiceName[]): DynamicModule {
    const clientConfigs = services.map((s) => createTcpClientConfig(s) as unknown as ClientProvider);

    return {
      module: TcpClientModule,
      imports: [ClientsModule.register(clientConfigs as any)],
      exports: [ClientsModule],
    };
  }
}
