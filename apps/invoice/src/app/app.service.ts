import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class AppService {
  constructor(@InjectConnection() private readonly mongoConnection: Connection) {}

  getData(): { message: string } {
    return { message: 'Hello API' };
  }

  async getHealth() {
    const admin = this.mongoConnection.db.admin();
    const pingResult = await admin.ping();

    return {
      service: 'invoice',
      status: 'ok',
      timestamp: new Date().toISOString(),
      mongo: {
        status: pingResult.ok === 1 ? 'up' : 'down',
        readyState: this.mongoConnection.readyState,
        dbName: this.mongoConnection.db.databaseName,
      },
    };
  }
}
