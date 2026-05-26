import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

interface HealthCheckResult {
  service: string;
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  checks: {
    mongo: { status: 'up' | 'down'; readyState: number; dbName: string };
    memory: { status: 'up' | 'down'; heapUsedMB: number; heapTotalMB: number; rssMB: number };
  };
}

@Injectable()
export class AppService {
  constructor(@InjectConnection() private readonly mongoConnection: Connection) {}

  getData(): { message: string } {
    return { message: 'Hello API' };
  }

  async getHealth(): Promise<HealthCheckResult> {
    const mongoHealth = await this.checkMongo();
    const memoryHealth = this.checkMemory();

    const overallStatus: HealthCheckResult['status'] =
      mongoHealth.status === 'up' && memoryHealth.status === 'up' ? 'ok' : 'degraded';

    return {
      service: 'invoice',
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: {
        mongo: mongoHealth,
        memory: memoryHealth,
      },
    };
  }

  private async checkMongo() {
    try {
      const admin = this.mongoConnection.db.admin();
      const pingResult = await admin.ping();
      return {
        status: (pingResult.ok === 1 ? 'up' : 'down') as 'up' | 'down',
        readyState: this.mongoConnection.readyState,
        dbName: this.mongoConnection.db.databaseName,
      };
    } catch {
      return {
        status: 'down' as const,
        readyState: this.mongoConnection.readyState,
        dbName: this.mongoConnection.db?.databaseName ?? 'unknown',
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
