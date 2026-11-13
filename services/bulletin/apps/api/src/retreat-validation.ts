import { z } from 'zod';

export const genderInput = z.enum(['male', 'female', 'other']);
export const peerGroupInput = z.string().trim().min(1, '또래를 입력해 주세요.').max(30).transform(value => value.normalize('NFC'));
export const phoneNumberInput = z.string().trim().max(40)
  .transform(value => value.replace(/[\s().-]/g, ''))
  .refine(value => /^\+?\d{8,15}$/.test(value), '연락처를 확인해 주세요.');
const optionalText = (limit: number) => z.string().trim().max(limit).nullable().optional().transform(value => value || null);
export const retreatRegistrationInput = z.object({
  participantName: z.string().trim().min(1, '이름을 입력해 주세요.').max(50).transform(value => value.normalize('NFC')),
  peerGroup: peerGroupInput, gender: genderInput, phoneNumber: phoneNumberInput,
  departureOption: z.enum(['main', 'late', 'car', 'other']), departureNote: optionalText(200),
  prayerRequest: optionalText(2000), expectedEventVersion: z.number().int().positive(),
  expectedRegistrationVersion: z.number().int().min(0),
}).strict().superRefine((input, context) => {
  if (['car', 'other'].includes(input.departureOption) && !input.departureNote) {
    context.addIssue({ code: 'custom', path: ['departureNote'], message: '출발 예정 시각을 입력해 주세요.' });
  }
});
export const profilePatchInput = z.object({
  name: z.string().trim().min(1).max(50).transform(value => value.normalize('NFC')).optional(),
  peerGroup: peerGroupInput.nullable().optional(), gender: genderInput.nullable().optional(),
  phoneNumber: phoneNumberInput.nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, '변경할 정보를 입력해 주세요.');
