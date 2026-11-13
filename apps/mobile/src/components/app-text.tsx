import { Children } from 'react';
import { StyleSheet, Text as NativeText, TextInput as NativeTextInput, type TextProps, type TextInputProps } from 'react-native';
import { symbolFont, useTypography } from '@/theme/typography';

// Tiempos covers Latin. Explicit Hangul/Han runs keep Korean in a matching serif
// on native platforms, where fontFamily cannot express a CSS fallback list.
const koreanRuns = /([\p{Script=Hangul}\p{Script=Han}]+)/u;
const isKoreanRun = /^[\p{Script=Hangul}\p{Script=Han}]+$/u;
const isSymbol = /^[\s✦↗▦☷◉‹›]+$/u;

export function AppText({ children, style, ...props }: TextProps) {
  const fonts = useTypography();
  const customFamily = StyleSheet.flatten(style)?.fontFamily;
  const content = customFamily ? children : Children.map(children, child => {
    if (typeof child !== 'string') return child;
    if (child && isSymbol.test(child)) return <NativeText style={{ fontFamily: symbolFont }}>{child}</NativeText>;
    return child.split(koreanRuns).map((run, index) => isKoreanRun.test(run)
      ? <NativeText key={index} style={{ fontFamily: fonts.korean }}>{run}</NativeText> : run);
  });
  return <NativeText {...props} style={[{ fontFamily: fonts.latin }, style]}>{content}</NativeText>;
}

export function AppTextInput({ style, ...props }: TextInputProps) {
  const fonts = useTypography();
  return <NativeTextInput {...props} style={[{ fontFamily: fonts.korean }, style]} />;
}
