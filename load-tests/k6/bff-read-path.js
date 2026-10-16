// Load test for bff's authenticated read path: JWT verification → permission resolution over gRPC
// (Authorizer → user-access) → invoice over TCP → Redis/Mongo.
//
// Every virtual user shares one source IP, and bff rate-limits per IP. So past the limit this test
// measures the limiter by design, and asserts the property that matters under overload: the
// gateway sheds excess load with 429s — never 5xx — while the requests it admits stay fast.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BFF_URL || 'http://bff:3300';
const shed = new Counter('requests_shed_429');

export const options = {
  scenarios: {
    // Within the limit: proves latency under steady, admitted load.
    steady: { executor: 'constant-arrival-rate', rate: 1, timeUnit: '1s', duration: '20s', preAllocatedVUs: 5 },
    // Well past the limit: proves graceful load shedding.
    burst: {
      executor: 'ramping-arrival-rate',
      startTime: '20s',
      startRate: 5,
      timeUnit: '1s',
      stages: [
        { target: 50, duration: '15s' },
        { target: 50, duration: '10s' },
      ],
      preAllocatedVUs: 50,
    },
  },
  thresholds: {
    // 429 is an *expected* answer here (see setResponseCallback); anything else failing breaks the run.
    http_req_failed: ['rate<0.01'],
    'http_req_duration{expected_response:true,status:200}': ['p(95)<300'],
    'checks{check:no server errors}': ['rate==1'],
    requests_shed_429: ['count>0'],
  },
};

http.setResponseCallback(http.expectedStatuses(200, 201, 429));

export function setup() {
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({
      username: __ENV.E2E_USERNAME || 'dev.accountant',
      password: __ENV.E2E_PASSWORD || 'DevPassw0rd!',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (res.status !== 201 && res.status !== 200) throw new Error(`login failed: ${res.status} ${res.body}`);
  return { token: res.json('data.accessToken') };
}

export default function ({ token }) {
  const res = http.get(`${BASE}/api/v1/invoices?limit=10`, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 429) shed.add(1);
  check(res, {
    'no server errors': (r) => r.status < 500,
    '429s carry Retry-After': (r) => r.status !== 429 || Number(r.headers['Retry-After']) >= 1,
  });
}
