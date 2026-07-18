/**
 * State Machine Configuration for Job Application Stages.
 * 
 * Valid Linear Workflow:
 * Applied -> Screening -> Interview -> Offer -> Hired
 * 
 * Global Rejection:
 * Any stage -> Rejected
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  'Applied': ['Screening', 'Rejected'],
  'Screening': ['Interview', 'Rejected'],
  'Interview': ['Offer', 'Rejected'],
  'Offer': ['Hired', 'Rejected'],
  'Hired': [],     // Terminal state
  'Rejected': []   // Terminal state
};

/**
 * Validates whether an application can transition from its current stage to a new stage.
 * 
 * @param currentStage The current stage of the application
 * @param newStage The proposed stage to transition to
 * @returns boolean indicating if the transition is valid
 */
export const isValidTransition = (currentStage: string, newStage: string): boolean => {
  // If either stage is missing, or stages are the same, it's invalid
  if (!currentStage || !newStage || currentStage === newStage) {
    return false;
  }

  const allowed = VALID_TRANSITIONS[currentStage];
  if (!allowed) {
    return false;
  }

  return allowed.includes(newStage);
};
