const BASE = process.env.STAGE01_PROD_BASE || 'https://orders-app.orders-clothes.workers.dev';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { json = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'Accept': json ? 'application/json' : 'text/html,*/*' },
    });
    const body = json ? await response.json() : await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${path}: ${typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

console.log(`Stage01 Production post-deploy smoke: ${BASE}`);

const html = await request('/', { json: false });
check(html.includes('<title>orders-app</title>'), 'Production shell title is not orders-app');
check(!html.includes('Система заказов 2'), 'Branch2 visual marker leaked into Production');

const corePaths = [
  '/api/admin-mode/status',
  '/api/auth/me',
  '/api/dashboard',
  '/api/reference-data',
  '/api/workshop/counts',
  '/api/inventory/attention?details=0&limit=5',
  '/api/catalog',
  '/api/returns',
  '/api/exchanges',
];

for (const path of corePaths) {
  const payload = await request(path);
  check(payload && (Array.isArray(payload) || typeof payload === 'object'), `Invalid JSON payload for ${path}`);
  console.log(`200 ${path}`);
}

const orders = await request('/api/orders?limit=20&includePaymentCount=0');
check(orders?.ok === true, 'Orders list did not return ok=true');
check(Array.isArray(orders.orders) && orders.orders.length > 0, 'Orders list is empty');

let sample = null;
for (const order of orders.orders) {
  for (const item of Array.isArray(order?.items) ? order.items : []) {
    const name = String(item?.productName || '').trim();
    if (Array.from(name).length >= 3) {
      sample = { orderId: Number(order.id), productName: name };
      break;
    }
  }
  if (sample) break;
}
check(sample && Number.isFinite(sample.orderId) && sample.orderId > 0, 'Could not select a live item-name search sample');

const search = await request(`/api/orders?q=${encodeURIComponent(sample.productName)}&limit=20&includePaymentCount=0`);
check(search?.ok === true, 'Orders search did not return ok=true');
check(Array.isArray(search.orders) && search.orders.length > 0, `Item-name search returned no orders for "${sample.productName}"`);
const matchedByItemName = search.orders.some(order =>
  (Array.isArray(order?.items) ? order.items : []).some(item =>
    String(item?.productName || '').trim() === sample.productName
  )
);
check(matchedByItemName, `Item-name search did not return an order carrying product "${sample.productName}"`);
console.log(`R14 live item-name search OK: "${sample.productName}"`);

const detail = await request(`/api/orders/${sample.orderId}`);
check(detail?.ok === true, 'Order detail did not return ok=true');
check(Number(detail?.order?.id) === sample.orderId, 'Order detail returned the wrong order');
check(Array.isArray(detail?.order?.items), 'Order detail items are not an array');
console.log(`Order detail readback OK: #${sample.orderId}`);

console.log('STAGE01 PRODUCTION POST-DEPLOY READ-ONLY SMOKE PASSED');
