import { pino } from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  base: {
    service: 'shapi-backend'
  }
});