#!/usr/bin/env node
/**
 * Group D reversal watch — READ-ONLY monthly demand monitor.
 *
 * Queries the official MCP registry, npm and GitHub public APIs for
 * recent-change / EventStreams demand signals, compares them with the
 * thresholds recorded in research/12-group-d-spike.md, and writes
 * a JSON report to handoff/group-d-watch-report.json (next to this script).
 *
 * No dependency beyond Node built-ins + global fetch. No remote writes, no
 * credentials, no authentication tokens. Short timeouts, sequential requests,
 * small pages and an identifying User-Agent keep the watch polite.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'group-d-watch-report.json');

const TIMEOUT_MS = 6000;
const PAUSE_MS = 250;
const USER_AGENT =
  'WikiMCP-GroupD-Watch/1.0 (+https://example.org/wikimedia-mcp; read-only monthly demand watch)';

const REGISTRY_QUERIES = ['recent changes', 'recentchange', 'eventstreams', 'wikimedia stream', 'wikipedia'];
const NPM_PACKAGES = {
  dedicated: '@insnapsprakhar/wikipedia-recent-changes-mcp',
  general: [
    'wikipedia-mcp',
    '@professional-wiki/mediawiki-mcp-server',
    '@cyanheads/wikipedia-mcp-server',
  ],
};

/** Baseline observations from report 12 (all observed 2026-11-21). */
const BASELINE = {
  source: 'research/12-group-d-spike.md',
  observed_at: '2026-11-21',
  registry_exact_query_counts: {
    'recent changes': 0,
    recentchange: 0,
    eventstreams: 0,
    'wikimedia stream': 0,
  },
  dedicated_package_downloads_last_month: 19,
  general_package_downloads_last_month: {
    'wikipedia-mcp': 68555,
    '@professional-wiki/mediawiki-mcp-server': 9485,
    '@cyanheads/wikipedia-mcp-server': 3123,
  },
  relevant_github_issues: 0,
  thresholds: {
    spike_more_active_registry_live_change_entries: 2,
    drop_dedicated_downloads_per_month_below: 50,
    drop_observation_window_days: 28,
  },
};

const LIVE_CHANGE_RE = /eventstreams|recent[\s-]?change|live[\s-]?(wikipedia|change|edit)|edit feed|\bsse\b|server.sent events/i;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** One bounded, read-only GET. Never throws; returns a compact observation. */
async function getJson(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    const text = await response.text();
    let data = null;
    try { data = text.length > 0 ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    return {
      url,
      ok: response.ok,
      status: response.status,
      elapsed_ms: Date.now() - started,
      data,
      error: null,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      elapsed_ms: Date.now() - started,
      data: null,
      error: String(error?.message ?? error),
    };
  }
}

function compactHttp(observation) {
  const { url, ok, status, elapsed_ms: elapsedMs, error } = observation;
  return { url, ok, status, elapsed_ms: elapsedMs, error };
}

function registryEntries(payload) {
  const servers = payload?.servers;
  return Array.isArray(servers) ? servers : [];
}

function entryIdentity(entry) {
  if (typeof entry?.name === 'string') return entry.name;
  if (typeof entry?.id === 'string') return entry.id;
  return JSON.stringify(entry).slice(0, 120);
}

function entryIsActive(entry) {
  const status = entry?.status;
  if (typeof status !== 'string') return true; // unknown status: do not discard a signal
  return status.toLowerCase() === 'active';
}

async function checkRegistry() {
  const observations = [];
  const liveEntries = new Map();
  for (const query of REGISTRY_QUERIES) {
    const url = `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(query)}&limit=100`;
    const observation = await getJson(url);
    const entries = observation.ok ? registryEntries(observation.data) : [];
    let matching = 0;
    for (const entry of entries) {
      const haystack = JSON.stringify(entry);
      if (!LIVE_CHANGE_RE.test(haystack) || !entryIsActive(entry)) continue;
      matching += 1;
      liveEntries.set(entryIdentity(entry), {
        name: entryIdentity(entry),
        description: typeof entry?.description === 'string' ? entry.description.slice(0, 200) : null,
        status: typeof entry?.status === 'string' ? entry.status : null,
      });
    }
    const baseline = BASELINE.registry_exact_query_counts[query];
    observations.push({
      ...compactHttp(observation),
      query,
      raw_count: entries.length,
      live_change_matches: matching,
      baseline_count: baseline ?? null,
      delta_vs_baseline: baseline === undefined ? null : entries.length - baseline,
      note: 'The registry search parameter matches descriptions, not names (report 12 §2.1); this is a coarse signal only.',
    });
    await sleep(PAUSE_MS);
  }
  return {
    observations,
    distinct_active_live_change_entries: liveEntries.size,
    entries: [...liveEntries.values()],
  };
}

async function checkNpm() {
  const observations = [];
  const names = [NPM_PACKAGES.dedicated, ...NPM_PACKAGES.general];
  for (const name of names) {
    const url = `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`;
    const observation = await getJson(url);
    const downloads = observation.ok && typeof observation.data?.downloads === 'number'
      ? observation.data.downloads
      : null;
    const baseline = name === NPM_PACKAGES.dedicated
      ? BASELINE.dedicated_package_downloads_last_month
      : (BASELINE.general_package_downloads_last_month[name] ?? null);
    observations.push({
      ...compactHttp(observation),
      package: name,
      downloads_last_month: downloads,
      baseline_downloads: baseline,
      delta_vs_baseline: downloads === null || baseline === null ? null : downloads - baseline,
    });
    await sleep(PAUSE_MS);
  }
  return observations;
}

async function checkGitHub() {
  const issueQuery = 'wikimedia mcp recent changes in:title,body type:issue';
  const issuesUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(issueQuery)}&per_page=20`;
  const issues = await getJson(issuesUrl);
  await sleep(PAUSE_MS);
  const issueItems = Array.isArray(issues.data?.items) ? issues.data.items : [];
  const issueCandidates = issueItems
    .filter((item) => LIVE_CHANGE_RE.test(`${item.title ?? ''} ${item.body ?? ''}`))
    .map((item) => ({ title: item.title ?? '', url: item.html_url ?? '', state: item.state ?? null }));

  const repoQuery = 'wikimedia mcp recent changes';
  const reposUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(repoQuery)}&sort=stars&per_page=10`;
  const repos = await getJson(reposUrl);
  const repoItems = Array.isArray(repos.data?.items) ? repos.data.items : [];
  const sseRepoCandidates = repoItems
    .filter((item) => LIVE_CHANGE_RE.test(`${item.name ?? ''} ${item.description ?? ''}`))
    .map((item) => ({
      full_name: item.full_name ?? item.name ?? '',
      description: typeof item.description === 'string' ? item.description.slice(0, 200) : null,
      stargazers_count: item.stargazers_count ?? null,
      pushed_at: item.pushed_at ?? null,
      url: item.html_url ?? '',
    }));

  return {
    issues: {
      ...compactHttp(issues),
      query: issueQuery,
      raw_count: issues.ok && typeof issues.data?.total_count === 'number' ? issues.data.total_count : null,
      keyword_candidates: issueCandidates,
      baseline_relevant_count: BASELINE.relevant_github_issues,
      note: 'Search noise was 13 raw / 0 relevant in report 12 §2.4. Keyword candidates require human relevance review.',
    },
    repositories: {
      ...compactHttp(repos),
      query: repoQuery,
      raw_count: repos.ok && typeof repos.data?.total_count === 'number' ? repos.data.total_count : null,
      live_sse_candidates: sseRepoCandidates,
      note: 'Top-10-by-stars heuristic only; whether a repo "adds a live SSE tool" needs human review.',
    },
  };
}

function evaluate(registry, npmObservations, github) {
  const evaluations = [];
  const dedicated = npmObservations.find((item) => item.package === NPM_PACKAGES.dedicated);
  const dedicatedDownloads = dedicated?.downloads_last_month ?? null;
  const registryLiveCount = registry.distinct_active_live_change_entries;
  const issueRawCount = github.issues.raw_count;
  const issueNoSignal = issueRawCount === 0 && github.issues.keyword_candidates.length === 0;
  const registryNoSignal = registry.observations
    .filter((item) => item.query !== 'wikipedia')
    .every((item) => item.raw_count === 0);

  evaluations.push({
    id: 'SPIKE_MORE_ON_EVENTSTREAMS',
    trigger: '>=2 active registry entries advertise EventStreams/live-change tools (report 12 §6 trigger 1)',
    automatic: true,
    status: registryLiveCount >= BASELINE.thresholds.spike_more_active_registry_live_change_entries
      ? 'TRIGGERED' : 'NOT_TRIGGERED',
    observed: { distinct_active_live_change_entries: registryLiveCount },
  });

  const dropDownloadsCondition = dedicatedDownloads !== null
    && dedicatedDownloads < BASELINE.thresholds.drop_dedicated_downloads_per_month_below;
  const dropDemandCondition = registryNoSignal && issueNoSignal;
  evaluations.push({
    id: 'DROP_BOUNDED_TOOL_CANDIDATE',
    trigger: 'dedicated package <50 downloads/month AND no registry entry/GitHub issue/downstream ask, within 4 weeks of shipping (report 12 §6 trigger 2)',
    automatic: 'partial',
    status: dropDownloadsCondition && dropDemandCondition
      ? 'CANDIDATE_REQUIRES_4_WEEK_WINDOW_AND_HUMAN_CONFIRMATION' : 'NOT_TRIGGERED',
    observed: {
      dedicated_downloads_last_month: dedicatedDownloads,
      registry_no_signal_exact_queries: registryNoSignal,
      github_issue_no_signal: issueNoSignal,
    },
    caveat: 'The 4-week post-ship window and "downstream user asks" cannot be determined from public APIs; operator must confirm.',
  });

  evaluations.push({
    id: 'TOP10_WIKIMEDIA_REPO_ADDS_LIVE_SSE',
    trigger: 'a top-10 Wikimedia MCP repo adds a live SSE tool (report 12 §6 trigger 1)',
    automatic: 'heuristic',
    status: github.repositories.live_sse_candidates.length > 0 ? 'REQUIRES_HUMAN_REVIEW' : 'NO_SIGNAL',
    observed: { candidates: github.repositories.live_sse_candidates },
  });

  return evaluations;
}

function overallStatus(evaluations, warnings) {
  if (warnings.length > 0) return 'INCOMPLETE_CHECK_NETWORK_OR_API_ERRORS';
  if (evaluations.some((item) => item.status === 'TRIGGERED')) return 'REVERSAL_TRIGGERED';
  if (evaluations.some((item) => item.status.startsWith('CANDIDATE_'))) return 'DROP_CANDIDATE_REQUIRES_HUMAN_CONFIRMATION';
  if (evaluations.some((item) => item.status === 'REQUIRES_HUMAN_REVIEW')) return 'REQUIRES_HUMAN_REVIEW';
  return 'STEADY';
}

async function main() {
  const warnings = [];
  const registry = await checkRegistry();
  const npmObservations = await checkNpm();
  const github = await checkGitHub();

  for (const item of [...registry.observations, ...npmObservations, github.issues, github.repositories]) {
    if (!item.ok) warnings.push(`${item.url} -> status ${item.status}, error ${item.error ?? 'non-2xx'}`);
  }
  if (github.issues.status === 403 || github.repositories.status === 403) {
    warnings.push('GitHub API rate limit likely reached (unauthenticated limit is 60 requests/hour); do not re-run immediately.');
  }

  const evaluations = evaluate(registry, npmObservations, github);
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    run_kind: 'monthly-read-only-demand-watch',
    automated: true,
    writes_performed: 'local report file only; all HTTP calls were GET',
    baseline: BASELINE,
    observations: { registry, npm: npmObservations, github },
    evaluations,
    manual_review_items: [
      'Concrete user/issue requiring sub-minute push rather than polling (report 12 §6 trigger 1).',
      'Cost/ToS change: Wikimedia tightens Action API rate limits or publishes an affordable Enterprise Realtime tier (report 12 §6 trigger 3).',
      'Architecture change: MCP adds a first-class resumable streaming primitive (report 12 §6 trigger 4).',
      'Relevance of keyword candidates in GitHub issues/repositories; registry search matches descriptions, not names.',
      'Whether the 4-week post-ship window has elapsed and whether any downstream user asked for the feature.',
    ],
    overall_status: overallStatus(evaluations, warnings),
    warnings,
    notes: [
      'This is a monitoring artefact, not a decision. Do not change code or gate status from an automated signal alone.',
      'Baseline numbers are from report 12, observed 2026-11-21; general-purpose package downloads are not proof of recent-change demand.',
    ],
  };

  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Group D watch report written: ${OUT}`);
  console.log(`overall_status=${report.overall_status} registry_live_entries=${registry.distinct_active_live_change_entries} dedicated_downloads=${npmObservations.find((i) => i.package === NPM_PACKAGES.dedicated)?.downloads_last_month ?? 'n/a'} warnings=${warnings.length}`);
}

main().catch((error) => {
  console.error(`Group D watch failed: ${String(error?.message ?? error)}`);
  process.exitCode = 1;
});
