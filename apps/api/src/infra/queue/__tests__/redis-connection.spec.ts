import { redisConnectionFromUrl } from '../queue.module';

describe('redisConnectionFromUrl', () => {
  it('plain local Redis', () => {
    expect(redisConnectionFromUrl('redis://localhost:6379')).toEqual({ host: 'localhost', port: 6379 });
  });
  it('keeps the database number so two projects on one Redis do not share queues', () => {
    expect(redisConnectionFromUrl('redis://localhost:6379/5')).toEqual({ host: 'localhost', port: 6379, db: 5 });
  });
  it('password, user, custom port and TLS', () => {
    expect(redisConnectionFromUrl('rediss://app:p%40ss@redis.example:6380/2')).toEqual({
      host: 'redis.example', port: 6380, username: 'app', password: 'p@ss', db: 2, tls: {},
    });
  });
});
