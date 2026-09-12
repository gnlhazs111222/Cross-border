/**
 * Transport verdict for a product.
 *
 * Three outcomes, and only two of them block publishing:
 * - clear            ordinary goods; `fragile` is an operational note, never a blocker
 * - needs_documents  potentially dangerous (battery, magnetic, liquid, aerosol): blocked until a
 *                    human records the missing paperwork; a manual release is possible
 * - forbidden        factually prohibited (flammable liquid, compressed gas): blocked for good,
 *                    there is deliberately no release path — the fix is correcting the data
 *
 * Undeclared attributes are not treated as "safe": they come back as `declared: false` so the UI can
 * ask for the data instead of silently assuming the best.
 */

export type TransportAttributes = {
  liquid: boolean; battery: boolean; magnetic: boolean; aerosol: boolean; flammable: boolean; fragile: boolean;
};
export type HazmatVerdict = 'clear' | 'needs_documents' | 'forbidden';

export type HazmatAssessment = {
  verdict: HazmatVerdict;
  declared: boolean;
  triggers: string[];
  requirements: string[];
  publishBlocked: boolean;
  manualReleaseAllowed: boolean;
  fragile: boolean;
};

const REQUIREMENTS: Record<string, string[]> = {
  battery: ['UN38.3 test report', 'MSDS', 'Battery declaration'],
  magnetic: ['Magnetic field test report'],
  liquid: ['MSDS'],
  aerosol: ['MSDS', 'Pressure vessel declaration'],
  flammable: ['Flammable liquid is not shippable without a certified dangerous-goods channel'],
};

export function assessHazmat(transport: TransportAttributes | undefined): HazmatAssessment {
  if (!transport) return { verdict: 'clear', declared: false, triggers: [], requirements: [], publishBlocked: false, manualReleaseAllowed: false, fragile: false };
  const triggers = (['flammable', 'aerosol', 'battery', 'magnetic', 'liquid'] as const).filter(attribute => transport[attribute]);
  const fragile = transport.fragile;
  if (!triggers.length) return { verdict: 'clear', declared: true, triggers: [], requirements: [], publishBlocked: false, manualReleaseAllowed: false, fragile };
  // A flammable liquid stays forbidden even when it is also declared as an aerosol or battery product.
  if (transport.flammable) {
    return { verdict: 'forbidden', declared: true, triggers, requirements: REQUIREMENTS.flammable, publishBlocked: true, manualReleaseAllowed: false, fragile };
  }
  const requirements = [...new Set(triggers.flatMap(trigger => REQUIREMENTS[trigger] ?? []))];
  return { verdict: 'needs_documents', declared: true, triggers, requirements, publishBlocked: true, manualReleaseAllowed: true, fragile };
}
