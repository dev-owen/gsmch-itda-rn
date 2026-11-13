import type { EventInput } from './types';

/** A loaded admin view also contains server metadata. Send only writable fields. */
export function writableEvent(input: EventInput): EventInput {
  return { title: input.title, category: input.category, description: input.description,
    memberDetails: input.memberDetails || '', location: input.location, target: input.target,
    startsAt: input.startsAt, endsAt: input.endsAt, allDay: input.allDay,
    visibility: input.visibility, requiresMemberVerification: input.requiresMemberVerification,
    publicationStatus: input.publicationStatus, lifecycleStatus: input.lifecycleStatus,
    registrationEnabled: input.registrationEnabled, registrationOpensAt: input.registrationOpensAt,
    registrationClosesAt: input.registrationClosesAt, cancellationClosesAt: input.cancellationClosesAt,
    sourcePromotionId: input.sourcePromotionId || null,
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }) };
}
