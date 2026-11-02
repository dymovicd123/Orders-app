#!/usr/bin/env python3
from pathlib import Path
import subprocess

def source(ref,path):
    return subprocess.check_output(['git','show',f'{ref}:{path}'], text=True)

def replace_once(s,a,b,label):
    assert s.count(a)==1,(label,s.count(a))
    return s.replace(a,b)

# Maintain the latest Main App rather than copying a stale Branch2 monolith.
path=Path('src/App.tsx')
main=path.read_text()
old=source('origin/branch2','src/App.tsx')
start=old.index('  const [returnPendingInbox,')
end=old.index('  const [exchangeSelectedOrderId',start)
main=replace_once(main,'  const [exchangeSelectedOrderId',old[start:end]+'  const [exchangeSelectedOrderId','return inbox state')
start=old.index('  const [exchangePendingInbox,')
end=old.index('  const [activityLog',start)
main=replace_once(main,'  const [activityLog',old[start:end]+'  const [activityLog','exchange inbox state')
start=old.index('  // These independent oldest-first queues')
end=old.index('  async function loadReturnHistory(',start)
main=replace_once(main,'  async function loadReturnHistory(',old[start:end]+'  async function loadReturnHistory(','inbox loaders')
for kind in ('Return','Exchange'):
    mark='  async function load'+kind+'History('
    start=main.index(mark)
    end=main.index('  async function ',start+len(mark))
    block=main[start:end]
    needle='      return rows'
    assert block.count(needle)==1,(kind,'return rows')
    block=block.replace(needle,f'      if (!append) void load{kind}PendingInbox()\n'+needle)
    main=main[:start]+block+main[end:]
main=replace_once(main,'returnHistorySummary, returnSelectedOrder','returnHistorySummary, returnPendingInbox, loadReturnPendingInbox, returnSelectedOrder','return props')
main=replace_once(main,'exchangeHistorySummary, exchangeSelectedOrder','exchangeHistorySummary, exchangePendingInbox, loadExchangePendingInbox, exchangeSelectedOrder','exchange props')
path.write_text(main)

# Endpoint filtering is read-only: no mutations, no customer info copies, no writes.
path=Path('worker/domains/activity.ts')
main=path.read_text()
old=source('origin/branch2',str(path))
start=old.index("  // Work #733: a LIVE receipt inbox")
end=old.index("  if (dateFrom)",start)
needle="  if (dateFrom)"
fragment=old[start:end]
fragment=replace_once(fragment,"  const where: string[] = [];\n  const bindings: unknown[] = [];\n",'','strip existing return bindings')
main=replace_once(main,needle,fragment+needle,'return pending SQL')
main=replace_once(main,"ORDER BY r.return_date DESC, r.id DESC LIMIT ? OFFSET ?","ORDER BY r.return_date ${pendingOnly ? 'ASC' : 'DESC'}, r.id ${pendingOnly ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?",'return oldest first')
path.write_text(main)

path=Path('worker/domains/returns-exchanges.ts')
main=path.read_text()
old=source('origin/branch2',str(path))
start=old.index('export async function listExchanges(')
end=old.index("  if (orderId)",start)
fragment=old[old.index("  const pendingOnly =",start):end]
anchor='export async function listExchanges('
i=main.index(anchor)
j=main.index('  if (orderId)',i)
part=main[i:j]
part=replace_once(part,"  const where: string[] = [];","  const pendingOnly = url.searchParams.get('pendingOnly') === '1';\n  const where: string[] = [];","exchange pending param")
part=replace_once(part,"  const bindings: Array<string | number> = [];","  const bindings: Array<string | number> = [];\n"+fragment.split("  const bindings: Array<string | number> = [];\n",1)[1],"exchange pending where")
main=main[:i]+part+main[j:]
main=replace_once(main,"ORDER BY e.exchange_date DESC, e.id DESC LIMIT ? OFFSET ?","ORDER BY e.exchange_date ${pendingOnly ? 'ASC' : 'DESC'}, e.id ${pendingOnly ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?",'exchange oldest first')
path.write_text(main)

# Proven Branch2 view: no History-search dependency for physical receipt inboxes.
for p in (
 'src/features/sections/OrderReturnsSection.tsx',
 'src/features/sections/OrderExchangeSection.tsx',
 'src/features/sections/OrderExchangeSmartSection.tsx',
):
    Path(p).write_text(source('origin/branch2',p))

for p in (
 'scripts/test-work733-smart-exchange-inbox-20261101.mjs',
):
    Path(p).write_text(source('origin/branch2',p))
print('STAGE4_MAIN_SELECTIVE_RECEIPT_INBOX_SOURCE_READY')
