// Cross-device proof: a `callback_updated` emitted on the eventBus is delivered
// as an SSE frame to a connected Host session, and ONLY to sessions of the same
// restaurant (tenant isolation). This is the mechanism that makes "handle a
// callback on one device, others update" work. No DB — exercises the real
// events.router relay + eventBus wiring.
//
// Run: npm run test:callback-sse

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-callback-sse';

import assert from 'assert';
import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { eventBus } from '../../lib/eventBus';
import eventsRouter from './events.router';

function tokenFor(restaurantId: string): string {
  return jwt.sign(
    { userId: `u-${restaurantId}`, restaurantId, role: 'HOST', email: 'h@x', firstName: 'H', lastName: 'One' },
    config.jwtSecret,
  );
}

async function main() {
  const app = express();
  app.use('/api/integrations/events', eventsRouter);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  let received = '';
  const token = tokenFor('R1');

  const req = http.get(`http://127.0.0.1:${port}/api/integrations/events?token=${token}`, (res) => {
    assert.strictEqual(res.statusCode, 200, 'SSE endpoint should accept a valid token');
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => { received += chunk; });
  });

  // Give the server a moment to register the relay listeners, then emit:
  //  - one callback_updated for R1 (this client) — must be delivered
  //  - one for R2 (another restaurant)          — must NOT be delivered
  await new Promise((r) => setTimeout(r, 300));
  eventBus.emit('callback_updated', { restaurantId: 'R1', callback: { id: 'cb-R1', queueStatus: 'CALLBACK_COMPLETED' } });
  eventBus.emit('callback_updated', { restaurantId: 'R2', callback: { id: 'cb-R2', queueStatus: 'CALLBACK_COMPLETED' } });

  await new Promise((r) => setTimeout(r, 300));

  req.destroy();
  server.close();

  let passed = 0;
  const P = (label: string, cond: boolean) => { assert.ok(cond, label); passed++; console.log(`PASS | ${label}`); };

  P('client received a callback_updated SSE frame', /event:\s*callback_updated/.test(received));
  P('frame carries this restaurant\'s callback (cb-R1)', received.includes('cb-R1'));
  P('tenant isolation: other restaurant\'s callback (cb-R2) is NOT delivered', !received.includes('cb-R2'));

  console.log(`\n${passed}/3 callback-SSE cross-device tests passed`);
  process.exit(0);
}

main().catch((err) => { console.error('FAIL', err); process.exit(1); });
