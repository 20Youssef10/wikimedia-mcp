import type { Config } from '../config.js';

/**
 * Day-1 Attribution API configuration (report 06 §6.4). The beta API is the
 * primary signal source; v1 must NOT be assumed. Group F tools ship later.
 */
export type AttributionPlan = {
  apiVersion: string;
  fallbacks: readonly string[];
  disclaimer: string;
  signalUrl: (host: string, encodedTitle: string) => string;
};

export function attributionPlan(config: Config): AttributionPlan {
  return {
    apiVersion: config.attribution.apiVersion,
    fallbacks: config.attribution.fallbacks,
    disclaimer: config.attribution.disclaimer,
    signalUrl: (host: string, encodedTitle: string) =>
      `https://${host}/w/rest.php/attribution/${config.attribution.apiVersion}/pages/${encodedTitle}/signals`,
  };
}

/** 404 `rest-no-match` triggers the documented fallback chain. */
export function isBetaMiss(status: number, body: string): boolean {
  return status === 404 && body.includes('rest-no-match');
}
