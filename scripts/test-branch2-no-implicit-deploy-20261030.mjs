import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const yaml=readFileSync('.github/workflows/cloudflare-deploy-monitor.yml','utf8')
const events=yaml.slice(0,yaml.indexOf('\npermissions:'))
assert.match(events,/on:\s*\n  workflow_dispatch:/)
assert.doesNotMatch(events,/^\s*(push|pull_request|schedule|workflow_run):/m)
assert.match(yaml,/^    if: false$/m)
assert.doesNotMatch(yaml,/(?:npm run deploy|wrangler deploy|npx wrangler|--remote|curl\s.+-X\s+(?:POST|PATCH|PUT|DELETE))/)
console.log('BRANCH2_GITHUB_FALLBACK_DISABLED — no auto trigger, no runnable job, no Cloudflare/D1 writes')
