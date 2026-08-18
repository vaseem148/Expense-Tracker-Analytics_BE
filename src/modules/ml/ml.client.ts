import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface MlHealth {
  status: string;
  models: Record<string, string>;
  version: string;
}

/**
 * Thin HTTP client for the Python data-science service.
 * Every call is time-boxed and failure-tolerant: if the DS service is down,
 * the caller falls back to the TypeScript engine rather than erroring, so the
 * product degrades in accuracy but never in availability.
 */
@Injectable()
export class MlClient {
  private readonly logger = new Logger(MlClient.name);
  private readonly http: AxiosInstance;
  private available: boolean | null = null;
  private lastCheck = 0;

  constructor() {
    this.http = axios.create({
      baseURL: process.env.ML_SERVICE_URL ?? 'http://localhost:8000',
      timeout: parseInt(process.env.ML_SERVICE_TIMEOUT ?? '4000', 10),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Cached liveness check so a dead service is not probed on every request. */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null && Date.now() - this.lastCheck < 30_000) return this.available;
    try {
      await this.http.get('/health');
      this.available = true;
    } catch {
      this.available = false;
    }
    this.lastCheck = Date.now();
    return this.available;
  }

  async health(): Promise<MlHealth | null> {
    return this.post<MlHealth>('/health', undefined, 'GET');
  }

  async call<T>(path: string, body: unknown): Promise<T | null> {
    return this.post<T>(path, body);
  }

  private async post<T>(path: string, body?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<T | null> {
    try {
      const res =
        method === 'GET' ? await this.http.get<T>(path) : await this.http.post<T>(path, body);
      this.available = true;
      return res.data;
    } catch (err) {
      this.available = false;
      this.lastCheck = Date.now();
      this.logger.warn(`ML service ${path} unavailable: ${(err as Error).message}`);
      return null;
    }
  }
}
