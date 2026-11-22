import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonical } from './audit.js';
import { throwWrite } from './errors.js';

export type ActorBinding = { tenant: string; sub: string; client_id_hash: string };
export type TargetBinding = { source: string; namespace: number; title: string };

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function encode(secret: string, payload: object): string {
  const body = Buffer.from(canonical(payload), 'utf8').toString('base64url');
  return `~${body}.${sign(secret, body)}`;
}
function decode<T>(raw: string, secret: string, label: 'confirmation_invalid' | 'capability_invalid'): T {
  if (typeof raw !== 'string' || !raw.startsWith('~')) {
    throwWrite(label, `The ${label === 'confirmation_invalid' ? 'confirmation state' : 'capability token'} is malformed.`);
  }
  const [body, mac, ...extra] = raw.slice(1).split('.');
  if (body === undefined || mac === undefined || extra.length > 0 || !safeEqual(mac, sign(secret, body))) {
    throwWrite(label, `The ${label === 'confirmation_invalid' ? 'confirmation state' : 'capability token'} signature is invalid.`);
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    throwWrite(label, `The ${label === 'confirmation_invalid' ? 'confirmation state' : 'capability token'} is malformed.`);
  }
}

/** Single-use jti ledger with an independently managed deny-list. */
export class JtiLedger {
  private readonly used = new Set<string>();
  private readonly denied = new Set<string>();

  consume(jti: string): boolean {
    if (this.denied.has(jti) || this.used.has(jti)) return false;
    this.used.add(jti);
    return true;
  }
  deny(jti: string): void { this.denied.add(jti); }
  isDenied(jti: string): boolean { return this.denied.has(jti); }
  isUsed(jti: string): boolean { return this.used.has(jti); }
}

export type RequestStatePayload = {
  v: 1;
  actor: ActorBinding;
  tool: string;
  target: TargetBinding;
  params_hash: string;
  base_revision: number | null;
  approvals: string[];
  jti: string;
  iat: number;
  exp: number;
};

/** G3: signed, single-use, actor/tool/target/params-bound MRTR requestState. */
export class RequestStates {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
    readonly ledger: JtiLedger,
    private readonly clock: () => number = Date.now,
  ) {}

  issue(input: Omit<RequestStatePayload, 'v' | 'jti' | 'iat' | 'exp'>): string {
    const now = this.clock();
    return encode(this.secret, {
      ...input, v: 1, jti: randomUUID(), iat: now, exp: now + this.ttlSeconds * 1000,
    } satisfies RequestStatePayload);
  }

  verify(
    raw: string,
    expected: Pick<RequestStatePayload, 'actor' | 'tool' | 'target' | 'params_hash'>,
  ): RequestStatePayload {
    const state = decode<RequestStatePayload>(raw, this.secret, 'confirmation_invalid');
    const now = this.clock();
    if (state.v !== 1 || typeof state.jti !== 'string' || typeof state.exp !== 'number'
        || now > state.exp || now < (state.iat ?? 0)) {
      throwWrite('confirmation_invalid', 'The confirmation state has expired or is invalid.');
    }
    if (canonical(state.actor) !== canonical(expected.actor) || state.tool !== expected.tool
        || canonical(state.target) !== canonical(expected.target) || state.params_hash !== expected.params_hash) {
      throwWrite('confirmation_invalid', 'The confirmation state is bound to different inputs.');
    }
    if (!this.ledger.consume(state.jti)) {
      throwWrite('confirmation_invalid', 'The confirmation state has already been used or revoked.');
    }
    return state;
  }
}

export type CapabilityClaims = {
  v: 1;
  actor: ActorBinding;
  tool: string;
  target: TargetBinding;
  scope: string;
  base_revision: number | null;
  content_hash: string | null;
  exp: number;
  iat: number;
  jti: string;
  nonce: string;
  approvals: string[];
};

/** G4: signed, scoped, expiry-bound capability token, issued after confirmation. */
export class Capabilities {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
    readonly ledger: JtiLedger,
    private readonly clock: () => number = Date.now,
  ) {}

  issue(input: Omit<CapabilityClaims, 'v' | 'jti' | 'iat' | 'exp' | 'nonce'>): string {
    const now = this.clock();
    return encode(this.secret, {
      ...input, v: 1, jti: randomUUID(), nonce: randomUUID(), iat: now, exp: now + this.ttlSeconds * 1000,
    } satisfies CapabilityClaims);
  }

  verify(raw: string, expected: Pick<CapabilityClaims, 'actor' | 'tool' | 'target' | 'scope'>): CapabilityClaims {
    const claims = decode<CapabilityClaims>(raw, this.secret, 'capability_invalid');
    const now = this.clock();
    if (claims.v !== 1 || typeof claims.jti !== 'string' || now > claims.exp || now < (claims.iat ?? 0)) {
      throwWrite('capability_invalid', 'The capability token has expired or is invalid.');
    }
    if (canonical(claims.actor) !== canonical(expected.actor) || claims.tool !== expected.tool
        || canonical(claims.target) !== canonical(expected.target) || claims.scope !== expected.scope) {
      throwWrite('capability_invalid', 'The capability token is scoped to another actor, tool, target or scope.');
    }
    if (this.ledger.isDenied(claims.jti) || !this.ledger.consume(claims.jti)) {
      throwWrite('capability_invalid', 'The capability token was revoked or already used.');
    }
    return claims;
  }
}
