import { Children } from 'react';
import { StyleSheet, Text as NativeText, TextInput as NativeTextInput, type TextProps, type TextInputProps } from 'react-native';
import { symbolFont, useTypography } from '@/theme/typography';

// Body copy uses the platform's familiar sans. Display text can opt into the
// existing serif pairing, with explicit Korean runs on native platforms.
const koreanRuns = /([\p{Script=Hangul}\p{Script=Han}]+)/u;
const isKoreanRun = /^[\p{Script=Hangul}\p{Script=Han}]+$/u;
const isSymbol = /^[\s✦↗▦☷◉‹›]+$/u;

export function AppText({ children, style, tone = 'body', ...props }: TextProps & { tone?: 'body' | 'display' }) {
  const fonts = useTypography();
  const customFamily = StyleSheet.flatten(style)?.fontFamily;
  const content = customFamily || tone === 'body' ? children : Children.map(children, child => {
    if (typeof child !== 'string') return child;
    if (child && isSymbol.test(child)) return <NativeText style={{ fontFamily: symbolFont }}>{child}</NativeText>;
    return child.split(koreanRuns).map((run, index) => isKoreanRun.test(run)
      ? <NativeText key={index} style={{ fontFamily: fonts.korean }}>{run}</NativeText> : run);
  });
  return <NativeText {...props} style={[{ fontFamily: tone === 'display' ? fonts.latin : symbolFont }, style]}>{content}</NativeText>;
}

export function AppTextInput({ style, ...props }: TextInputProps) {
  return <NativeTextInput {...props} style={[{ fontFamily: symbolFont }, style]} />;
}
