import { hostLangFor, isValidLang, normalizeLang } from './lang.js';
import type { ResolveResult } from './types.js';

/**
 * Fixed allowlist of hostnames the resolver may ever produce. No caller-supplied
 * arbitrary host is accepted (report 08 SR-3 / T-01).
 */
const PROJECT_HOSTS: Record<string, string> = {
  wiktionary: 'wiktionary.org',
  wikisource: 'wikisource.org',
  wikibooks: 'wikibooks.org',
  wikiquote: 'wikiquote.org',
  wikivoyage: 'wikivoyage.org',
  wikiversity: 'wikiversity.org',
};

const SPECIAL_HOSTS: Record<string, string> = {
  commons: 'commons.wikimedia.org',
  commonswiki: 'commons.wikimedia.org',
  wikidata: 'www.wikidata.org',
  wikidatawiki: 'www.wikidata.org',
  meta: 'meta.wikimedia.org',
  metawiki: 'meta.wikimedia.org',
  species: 'species.wikimedia.org',
  specieswiki: 'species.wikimedia.org',
  testwiki: 'test.wikipedia.org',
};

const BASE_PROJECTS = new Set([
  'wikipedia',
  ...Object.keys(PROJECT_HOSTS),
  'commons',
  'wikidata',
  'meta',
  'species',
]);

export class ResolverError extends Error {
  constructor(
    readonly kind: 'invalid_language' | 'invalid_project' | 'unsupported_project',
    message: string,
  ) {
    super(message);
    this.name = 'ResolverError';
  }
}

/**
 * Resolve a project/language pair into a validated Wikimedia host and base URLs.
 *
 * Supports base project names, `wiki`/`wp` aliases, Wikimedia-style project
 * codes (`enwiki` → wikipedia:en), and dotted forms (`en.wikipedia`).
 * Where a code encodes a language it overrides the `lang` default.
 *
 * Language variants without their own wiki (`zh-hans`, `pt-br`, ...) are
 * routed to their real base-language host, while the full requested code is
 * retained in `lang` and `source` (reviewer finding M2, second pass).
 */
export function resolveTarget(params: { lang?: string; project?: string }): ResolveResult {
  let lang = normalizeLang(params.lang ?? 'en');
  const rawProject = (params.project ?? 'wikipedia').trim().toLowerCase();

  if (!isValidLang(lang)) {
    throw new ResolverError('invalid_language', `Invalid Wikimedia language code '${lang}'. Use 2-12 lowercase letters with up to three hyphen segments.`);
  }
  if (rawProject.length === 0 || rawProject.length > 24) {
    throw new ResolverError('invalid_project', `Invalid Wikimedia project '${rawProject}'.`);
  }

  let project: string;
  let fixedHost: string | undefined;

  if (rawProject === 'wiki' || rawProject === 'wp') {
    project = 'wikipedia';
  } else if (SPECIAL_HOSTS[rawProject] !== undefined) {
    fixedHost = SPECIAL_HOSTS[rawProject];
    project = rawProject === 'commonswiki'
      ? 'commons'
      : rawProject === 'wikidatawiki'
        ? 'wikidata'
        : rawProject === 'metawiki'
          ? 'meta'
          : rawProject === 'specieswiki'
            ? 'species'
            : rawProject === 'testwiki'
              ? 'testwiki'
              : rawProject;
  } else if (BASE_PROJECTS.has(rawProject)) {
    project = rawProject;
  } else {
    // Wikimedia-style codes: {lang}wiki, {lang}.{project}.
    const codeMatch = /^([a-z]{2,12}(?:-[a-z0-9]{2,12}){0,3})wiki$/.exec(rawProject);
    const dottedMatch = /^([a-z]{2,12}(?:-[a-z0-9]{2,12}){0,3})\.([a-z]+)$/.exec(rawProject);
    if (codeMatch?.[1]) {
      lang = normalizeLang(codeMatch[1]);
      project = 'wikipedia';
    } else if (dottedMatch?.[1] && dottedMatch[2]) {
      const candidateLang = normalizeLang(dottedMatch[1]);
      const candidateProject = dottedMatch[2];
      if (candidateProject === 'wikipedia' && isValidLang(candidateLang)) {
        lang = candidateLang;
        project = 'wikipedia';
      } else if (PROJECT_HOSTS[candidateProject] !== undefined && isValidLang(candidateLang)) {
        lang = candidateLang;
        project = candidateProject;
      } else {
        throw new ResolverError('unsupported_project', `Unsupported Wikimedia project '${rawProject}'.`);
      }
    } else {
      throw new ResolverError('unsupported_project', `Unsupported Wikimedia project '${rawProject}'.`);
    }
  }

  if (!isValidLang(lang)) {
    throw new ResolverError('invalid_language', `Invalid Wikimedia language code '${lang}'.`);
  }

  const hostLang = hostLangFor(lang);
  const host = fixedHost ?? (project === 'wikipedia'
    ? `${hostLang}.wikipedia.org`
    : `${hostLang}.${PROJECT_HOSTS[project] ?? 'wikipedia.org'}`);

  const source = project === 'commons' || project === 'wikidata' || project === 'meta' || project === 'species' || project === 'testwiki'
    ? project
    : `${project}:${lang}`;

  // Titles are URL-encoded with %20 for spaces, never '+'.
  const encodedTitle = (title: string): string => encodeURIComponent(title);

  return {
    source,
    lang,
    project,
    host,
    restBase: `https://${host}/api/rest_v1`,
    actionUrl: `https://${host}/w/api.php`,
    articleUrl: (title: string) => `https://${host}/wiki/${encodedTitle(title)}?wprov=afsw1`,
  };
}

/** Hosts the resolver is allowed to produce; used by egress allowlist checks. */
export function allowedHostsFromResolver(): readonly string[] {
  const hosts = new Set<string>(Object.values(SPECIAL_HOSTS));
  hosts.add('www.wikidata.org');
  for (const domain of Object.values(PROJECT_HOSTS)) hosts.add(domain);
  hosts.add('wikipedia.org');
  return [...hosts];
}
