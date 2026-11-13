import { betterAuth } from 'better-auth';
import { expo } from '@better-auth/expo';
import type { Pool } from 'pg';
import type { Bindings } from './types';

export function createAuth(env: Bindings, pool: Pool) {
  const origins = authOrigins(env);
  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: origins,
    plugins: [expo()],
    emailAndPassword: { enabled: false },
    account: { accountLinking: {
      enabled: true, disableImplicitLinking: true, allowDifferentEmails: true,
      allowUnlinkingAll: false, updateUserInfoOnLink: false,
    } },
    session: {
      cookieCache: { enabled: false },
      additionalFields: {
        authVersion: { type: 'number', defaultValue: 1, input: false },
        authProviderId: { type: 'string', defaultValue: '', input: false },
      },
    },
    databaseHooks: { session: { create: { before: async (session, context) => {
      const current = await pool.query<{ auth_version: number; status: string }>(
        'SELECT auth_version, status FROM app_users WHERE user_id = $1', [session.userId]);
      if (current.rows[0] && current.rows[0].status !== 'active') return false;
      // The hook runs after Better Auth has validated the provider response.
      const path = context?.path || '';
      const requestPath = context?.request ? new URL(context.request.url).pathname : '';
      const callbackProvider = /\/callback\/(google|kakao|apple)(?:\/|$)/.exec(path)?.[1]
        || /\/callback\/(google|kakao|apple)(?:\/|$)/.exec(requestPath)?.[1];
      const bodyProvider = path === '/sign-in/social' && context?.body && typeof context.body === 'object'
        ? (context.body as Record<string, unknown>).provider : undefined;
      const provider = callbackProvider || (typeof bodyProvider === 'string' && ['google', 'kakao', 'apple'].includes(bodyProvider) ? bodyProvider : '');
      return { data: { ...session, authVersion: current.rows[0]?.auth_version ?? 1, authProviderId: provider } };
    } } } },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? {
        google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      } : {}),
      ...(env.KAKAO_CLIENT_ID && env.KAKAO_CLIENT_SECRET ? {
        kakao: { clientId: env.KAKAO_CLIENT_ID, clientSecret: env.KAKAO_CLIENT_SECRET },
      } : {}),
    },
  });
}

export function authOrigins(env: Bindings): string[] {
  return [...new Set([env.WEB_ORIGIN, env.MOBILE_APP_ORIGIN || 'itda://',
    ...(env.EXTRA_TRUSTED_ORIGINS || '').split(',').map((value) => value.trim()),
  ].filter(Boolean))];
}
