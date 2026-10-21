import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
const yaml=fs.readFileSync('.github/workflows/cloudflare-deploy-monitor.yml','utf8')
const branch2Only=String.raw`              # A native Branch2 build can stay "running" indefinitely. Do not
              # mistake that for a successful deploy and do not modify main.
              # The fallback below independently checks the exact SHA, Branch2
              # Worker/D1 binding, full release gate and served public frontend.
              if [[ "$GITHUB_REF_NAME" == "branch2" && "$attempt" -ge 20 ]]; then
                echo "fallback_required=true" >> "$GITHUB_OUTPUT"
                echo "Native Cloudflare build for Branch2 stayed $status for over 3 minutes; running the existing guarded Branch2-only direct deploy."
                exit 0
              fi
`
assert.equal(yaml.split(branch2Only).length,2,'Expected exactly one guarded branch2-only native timeout fallback')
const immutable=yaml.replace(branch2Only,'')
const bytes=Buffer.from(immutable)
const actual=crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
assert.equal(actual,'748802f1cc8e7f3ec2f08dca9d1f8b1e206102d1',
 'Existing deploy policy for main, fallback, D1 guards or asset verification changed')
for(const token of [
 '"name": "orders-app-branch2"',
 '"database_name": "orders_db_branch2"',
 '40065052-854e-44b8-bcd5-251bdd488301',
 "if grep -Fq 'orders_db_prod' wrangler.jsonc",
 '"[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]',
 'npm run release:check',
 'npm run deploy',
 'scripts/verify-branch2-live-ui.mjs',
]) assert(yaml.includes(token.replaceAll('"[[','[[').replaceAll(']]" ',']] ')), 'Required isolation/release guard missing: '+token)
assert(yaml.includes('timeout-minutes: 25'),'Direct deploy timeout unexpectedly changed')
console.log('BRANCH2_CLOUDFLARE_HUNG_NATIVE_FALLBACK_SCOPE_AND_IMMUTABLE_MAIN_PASSED')
