export class MobileLoginProviderError extends Error {
  readonly code = 'PLATFORM_LOGIN_PROVIDER_MISMATCH';
  readonly status = 403;

  constructor() {
    super('모바일 앱에서는 카카오로만 로그인할 수 있습니다. Google 로그인은 PC 관리자 웹을 이용해 주세요.');
    this.name = 'MobileLoginProviderError';
  }
}

/** Shared by primary login and every account proof/link entry point. */
export function assertMobileLoginProvider(provider: unknown): asserts provider is 'kakao' {
  if (provider !== 'kakao') throw new MobileLoginProviderError();
}
