export type Gender = 'male' | 'female' | 'other';
export type DepartureOption = 'main' | 'late' | 'car' | 'other';
export type RetreatAnswers = {
  peerGroup: string; gender: Gender; phoneNumber: string;
  departureOption: DepartureOption; departureNote: string | null; prayerRequest: string | null;
};
export type RetreatRegistrationInput = RetreatAnswers & {
  participantName: string; expectedEventVersion: number; expectedRegistrationVersion: number;
};
