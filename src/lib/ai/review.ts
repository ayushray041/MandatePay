type ConfidenceMethod = 'not_calibrated' | 'deterministic_rule';

export function attachHumanReviewMetadata<T extends object>(
  result: T,
  confidenceMethod: ConfidenceMethod = 'not_calibrated',
) {
  return {
    ...result,
    confidenceScore: null,
    confidenceMethod,
    requiresHumanReview: true,
  };
}
