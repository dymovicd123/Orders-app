from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Preserve Branch2's environment-specific release check while adding the permanent R4 regression.
replace_once(
    'package.json',
    'node scripts/test-d1-read-budget-r3.mjs && node scripts/test-operational-autonomy-r2.mjs',
    'node scripts/test-d1-read-budget-r3.mjs && node scripts/test-d1-read-budget-r4.mjs && node scripts/test-operational-autonomy-r2.mjs',
    'Branch2 package R4 release chain',
)

# Chain the R4 Worker declaration hash before Branch2's environment-only auth delta.
replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    "const orderEditScopeR1Path = path.join(root, 'scripts/order-edit-scope-r1-worker-manifest.json')\nconst branch2EnvironmentPath = path.join(root, 'scripts/branch2-environment-worker-manifest.json')",
    "const orderEditScopeR1Path = path.join(root, 'scripts/order-edit-scope-r1-worker-manifest.json')\nconst d1ReadBudgetR4Path = path.join(root, 'scripts/d1-read-budget-r4-worker-manifest.json')\nconst branch2EnvironmentPath = path.join(root, 'scripts/branch2-environment-worker-manifest.json')",
    'Branch2 R4 manifest path',
)
replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    "  const orderEditScopeR1Changes = orderEditScopeR1.changes || {}\n  check(fs.existsSync(branch2EnvironmentPath), 'Branch2 environment Worker manifest missing')",
    "  const orderEditScopeR1Changes = orderEditScopeR1.changes || {}\n  check(fs.existsSync(d1ReadBudgetR4Path), 'D1 read-budget R4 Worker manifest missing')\n  const d1ReadBudgetR4 = JSON.parse(fs.readFileSync(d1ReadBudgetR4Path, 'utf8'))\n  check(d1ReadBudgetR4?.version === 1 && d1ReadBudgetR4?.revision === 'd1-read-budget-r4', 'D1 read-budget R4 Worker manifest invalid')\n  const d1ReadBudgetR4Changes = d1ReadBudgetR4.changes || {}\n  check(fs.existsSync(branch2EnvironmentPath), 'Branch2 environment Worker manifest missing')",
    'Branch2 R4 manifest load',
)
replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    "    const branch2EnvironmentChanged = branch2EnvironmentChanges[name]\n    if (branch2EnvironmentChanged) {\n      check(branch2EnvironmentChanged.before === acceptedPostOrderEditScopeR1Hash, `Branch2 environment baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === branch2EnvironmentChanged.after, `Worker declaration changed beyond exact Branch2 environment allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostOrderEditScopeR1Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)\n    }",
    "    const d1ReadBudgetR4Changed = d1ReadBudgetR4Changes[name]\n    let acceptedPostD1ReadBudgetR4Hash = acceptedPostOrderEditScopeR1Hash\n    if (d1ReadBudgetR4Changed) {\n      check(d1ReadBudgetR4Changed.before === acceptedPostOrderEditScopeR1Hash, `D1 read-budget R4 baseline hash mismatch: ${name}`)\n      acceptedPostD1ReadBudgetR4Hash = d1ReadBudgetR4Changed.after\n    }\n    const branch2EnvironmentChanged = branch2EnvironmentChanges[name]\n    if (branch2EnvironmentChanged) {\n      check(branch2EnvironmentChanged.before === acceptedPostD1ReadBudgetR4Hash, `Branch2 environment baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === branch2EnvironmentChanged.after, `Worker declaration changed beyond exact Branch2 environment allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR4Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)\n    }",
    'Branch2 R4 preservation chain',
)

print('Branch2 R4 metadata patched')
