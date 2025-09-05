import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

interface StatePayload {
  userId: string;
  createdAt: number;
}

@Injectable()
export class StateService {
  private readonly logger = new Logger(StateService.name);
  private readonly stateStore = new Map<string, StatePayload>();
  private readonly stateTtlMs = 5 * 60 * 1000;

  generateState(userId: string): string {
    const state = crypto.randomBytes(20).toString('hex');
    this.stateStore.set(state, { userId, createdAt: Date.now() });
    return state;
  }

  verifyStateAndGetUserId(state: string): string | null {
    this.cleanupExpiredStates();

    const payload = this.stateStore.get(state);
    if (!payload) {
      this.logger.warn(`State verification failed: state not found.`);
      return null;
    }

    this.stateStore.delete(state);

    const { userId, createdAt } = payload;
    if (Date.now() - createdAt > this.stateTtlMs) {
      this.logger.warn(
        `State verification failed for user ${userId}: state expired.`
      );
      return null;
    }

    return userId;
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, payload] of this.stateStore.entries()) {
      if (now - payload.createdAt > this.stateTtlMs) {
        this.stateStore.delete(state);
      }
    }
  }
}
