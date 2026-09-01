import fs from 'node:fs'

const http = fs.readFileSync('worker/core/http.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

check(http.includes("code: 'd1_daily_read_limit'"), 'D1 daily read limit must have a stable public code')
check(http.includes("code: 'd1_daily_write_limit'"), 'D1 daily write limit must have a stable public code')
check(http.includes("exceeded d1's free tier daily row read limit"), 'Cloudflare daily read-limit text must be recognized')
check(http.includes("exceeded d1's free tier daily row write limit"), 'Cloudflare daily write-limit text must be recognized')
check(http.includes('Существующие данные не повреждены'), 'Read-limit response must not tell staff to call an administrator')
check(!/d1_daily_(?:read|write)_limit[\s\S]{0,500}сообщите администратору/i.test(http), 'Capacity errors must not fall back to call-admin wording')

console.log('D1 capacity autonomy regression: OK')
