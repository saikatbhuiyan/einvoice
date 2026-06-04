import { Injectable, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { READ_DB } from '@libs/constants';

interface MongoHealthCheck {
  status: 'up' | 'down';
  readyState: number;
  dbName: string;
}

interface HealthCheckResult {
  service: string;
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  checks: {
    mongo: MongoHealthCheck;
    mongoRead?: MongoHealthCheck;
    memory: { status: 'up' | 'down'; heapUsedMB: number; heapTotalMB: number; rssMB: number };
  };
}

@Injectable()
export class AppService {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    @Optional() @InjectConnection(READ_DB) private readonly mongoReadConnection?: Connection,
  ) {}

  getData(): { message: string } {
    return { message: 'Hello API' };
  }

  async getHealth(): Promise<HealthCheckResult> {
    const mongoHealth = await this.checkMongo();
    const mongoReadHealth = await this.checkMongo(this.mongoReadConnection);
    const memoryHealth = this.checkMemory();

    const overallStatus: HealthCheckResult['status'] =
      mongoHealth.status === 'up' &&
      memoryHealth.status === 'up' &&
      (!mongoReadHealth || mongoReadHealth.status === 'up')
        ? 'ok'
        : mongoHealth.status === 'down'
          ? 'down'
          : 'degraded';

    return {
      service: 'invoice',
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: {
        mongo: mongoHealth,
        ...(mongoReadHealth ? { mongoRead: mongoReadHealth } : {}),
        memory: memoryHealth,
      },
    };
  }

  private async checkMongo(connection?: Connection): Promise<MongoHealthCheck | undefined> {
    if (!connection) return undefined;

    try {
      const admin = connection.db.admin();
      const pingResult = await admin.ping();
      return {
        status: (pingResult.ok === 1 ? 'up' : 'down') as 'up' | 'down',
        readyState: connection.readyState,
        dbName: connection.db.databaseName,
      };
    } catch {
      return {
        status: 'down' as const,
        readyState: connection.readyState,
        dbName: connection.db?.databaseName ?? 'unknown',
      };
    }
  }

  private checkMemory() {
    const MB = 1024 * 1024;
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / MB);
    const heapTotalMB = Math.round(usage.heapTotal / MB);
    const rssMB = Math.round(usage.rss / MB);

    // Flag as degraded if heap usage exceeds 1.5 GB (adjust per environment)
    const status: 'up' | 'down' = heapUsedMB > 1_500 ? 'down' : 'up';

    return { status, heapUsedMB, heapTotalMB, rssMB };
  }
}
