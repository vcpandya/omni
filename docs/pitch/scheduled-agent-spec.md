# Scheduled Agent — Omni Pitch Stats Refresh

**Status**: spec authored 2026-04-24, **not yet submitted** (claude.ai `/schedule` API returned 401 on this session).

## How to submit

Re-authenticate and retry:

```bash
# In Claude Code:
/login              # refresh claude.ai OAuth
/schedule           # and paste the spec below, or re-ask Claude to create it
```

Or create directly via the web UI: https://claude.ai/code/routines → **New routine** → paste the prompt below.

## Routine configuration

| Field | Value |
|------|-------|
| Name | `Omni pitch stats refresh` |
| Cron | `0 9 * * 1` (Mondays 09:00 UTC) |
| Environment | `env_013sijNnpWeVZgM4qyLe67vV` (SPJain) |
| Model | `claude-sonnet-4-6` |
| Repo | `https://github.com/vcpandya/omni` |
| Allowed tools | `Bash, Read, Write, Edit, Glob, Grep` |

**Prerequisite**: connect GitHub so the remote agent can clone + push. Run `/web-setup` in Claude Code, or install the Claude GitHub App at https://claude.ai/code/onboarding?magic=github-app-setup.

## Agent prompt (paste into routine)

````markdown
You are a scheduled audit agent for **Omni**, an enterprise-hardened fork of OpenClaw
(repo: github.com/vcpandya/omni). You run weekly to keep marketing/pitch numbers
honest: if any claimed stat drifted from source, open a PR; otherwise exit silently.

## Run these source-of-truth checks (ALL of them, then decide)

### 1. OWASP risks mapped
```bash
OWASP_ACTUAL=$(grep -cE '^\s+id:\s*"(LLM|AG)' src/wizard/owasp-mapping.ts)
echo "OWASP actual: $OWASP_ACTUAL"
```
Expected claim today: **20** (10 LLM + 10 AG). Referenced in:
- `docs/pitch/omni-overview.html` — proof-strip cell `20 / 20`
- `ui/src/ui/views/wizard.ts` — `stats` array in `renderWizardWelcome`
- `CHANGES.md` — LLM01–LLM10 + AG01–AG10 text

### 2. Compliance profiles
```bash
PROFILE_ACTUAL=$(grep -cE '^\s+id:\s*"[a-z-]+",' src/wizard/compliance-profiles.ts)
```
Expected: **5** (zero-trust, soc2-hardened, hipaa, standard, development).

### 3. Security test count
```bash
TEST_ACTUAL=$(npx vitest run src/security/ --reporter=default 2>&1 \
  | grep -oE 'Tests[^|]+[0-9]+ passed' | grep -oE '[0-9]+' | tail -1)
```
Expected: **320**. Only update if drift ≥ 20 (< 300 or ≥ 340).

### 4. Provider distinct count (flag-only, do NOT auto-update)
```bash
PROV_ACTUAL=$(grep -oE '^\s+value:\s*"[a-z][a-z0-9-]+"' src/commands/auth-choice-options.ts \
  | sed -E 's/.*"([a-z][a-z0-9]*)(-.*)?"/\1/' | sort -u | wc -l)
```
Current claim is "30+". If `$PROV_ACTUAL < 25`, flag in PR body; do NOT change the string.

### 5. Upstream drift (advisory only — never cherry-pick)
```bash
SINCE=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
     || date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)
for d in src/security src/wizard src/agents; do
  echo "=== upstream commits touching $d (last 7d) ==="
  curl -s "https://api.github.com/repos/openclaw/openclaw/commits?per_page=20&path=$d&since=$SINCE" \
    | grep -oE '"message": "[^"]+' | head -5
done
```
For the PR body only. Never merge upstream code automatically.

## Decide + act

### Before any edit or commit
```bash
if [ -n "$(git status --porcelain)" ]; then
  echo 'ABORT: working tree dirty — another agent may be editing. Exiting.'
  exit 0
fi
```

### If NO drift
Log `No drift — all pitch stats match source.` and exit. No branch, no commit.

### If drift detected
1. `git checkout -b chore/pitch-stats-refresh-$(date -u +%Y-%m-%d)`
2. Edit the three files to reflect actual numbers. Preserve surrounding formatting.
3. `npx oxfmt --write <paths>` (ignore errors if oxfmt not available)
4. Stage ONLY files you edited (`git add <paths>` — never `-A`)
5. `git commit -m "chore: refresh pitch stats ($(date -u +%Y-%m-%d))"`
6. `git push -u origin HEAD`
7. `gh pr create --title "chore: refresh pitch stats ($(date -u +%Y-%m-%d))" --body "…"`
   with drift table, provider advisory, and upstream notes.

## Guardrails — DO NOT touch
- `package.json` (especially `version`)
- `CHANGELOG.md`, `appcast.xml`
- Anything under `.github/workflows/release*`
- `scripts/committer`, `scripts/release-check.ts`
- Any file matching `release*` / `RELEASING*`

Never `git push --force`. Never use `--no-verify`.

## Final output
Print one of:
- `NO DRIFT`
- `DRIFT: <n> fixes, PR #<num>` + full PR URL
````
