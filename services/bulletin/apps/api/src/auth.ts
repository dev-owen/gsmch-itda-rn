import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getOAuthState } from 'better-auth/api';
import { expo } from '@better-auth/expo';
import type { Pool } from 'pg';
import type { Bindings } from './types';
import { automaticAdminRegistration, registerGoogleAdmin } from './admin-registration.js';
import { assertLoginPolicy, LoginPolicyError } from './login-policy.js';

export function createAuth(env: Bindings, pool: Pool) {
  const origins = authOrigins(env);
  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: origins,
    plugins: [expo()],
    hooks: { before: createAuthMiddleware(async (context) => {
      if (context.path !== '/sign-in/social' && context.path !== '/link-social') return;
      try {
        assertLoginPolicy({ ...context.body, expoOrigin: context.headers?.get('expo-origin') }, env);
      } catch (error) {
        if (!(error instanceof LoginPolicyError)) throw error;
        throw new APIError(error.status === 400 ? 'BAD_REQUEST' : 'FORBIDDEN', { code: error.code, message: error.message });
      }
    }) },
    user: { validateUserInfo: async ({ source }, context) => {
      if (source.method !== 'oauth') return;
      // parseState has already verified OAuth state before this identity gate runs,
      // including account-link callbacks which do not create a new session.
      const state = await getOAuthState();
      try {
        assertLoginPolicy({
          provider: source.oauth?.providerId,
          callbackURL: state?.callbackURL ?? context.body?.callbackURL,
          errorCallbackURL: state ? state.errorURL : context.body?.errorCallbackURL,
          newUserCallbackURL: state ? state.newUserURL : context.body?.newUserCallbackURL,
        }, env);
      } catch (error) {
        if (!(error instanceof LoginPolicyError)) throw error;
        return { error: error.code, errorDescription: error.message };
      }
    } },
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
      const authVersion = current.rows[0]?.auth_version ?? 1;
      if (provider === 'google' && automaticAdminRegistration(env)
        && !await registerGoogleAdmin(pool, session.userId, authVersion)) return false;
      return { data: { ...session, authVersion, authProviderId: provider } };
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
