import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET } from './route';

const MAIN_ADDRESS = '0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894';
const TOKEN_URI = `https://criptomorse-arc.vercel.app/api/agent-card/${MAIN_ADDRESS}`;

function request(address: string) {
  return new NextRequest(`http://localhost/api/agents/${address}`);
}

test('registered address returns the expected on-chain agent', async () => {
  const response = await GET(request(MAIN_ADDRESS), {
    params: Promise.resolve({ address: MAIN_ADDRESS }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    agent: {
      agentId: 4,
      owner: MAIN_ADDRESS,
      tokenURI: TOKEN_URI,
    },
  });
});

test('valid address without an agent returns 200 and agent null', async () => {
  const response = await GET(request('0xfa033D062d6ab8d49D611F5644d46f5380737dDA'), {
    params: Promise.resolve({ address: '0xfa033D062d6ab8d49D611F5644d46f5380737dDA' }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    agent: null,
    message: 'No agent found for this address',
  });
});

test('invalid address remains a 400 without touching the registry', async () => {
  const response = await GET(request('not-an-address'), {
    params: Promise.resolve({ address: 'not-an-address' }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid address' });
});
