import { isValidTransition } from '../src/services/stateMachine';

describe('State Machine Transitions Unit Tests', () => {
  test('should allow valid sequential transitions', () => {
    expect(isValidTransition('Applied', 'Screening')).toBe(true);
    expect(isValidTransition('Screening', 'Interview')).toBe(true);
    expect(isValidTransition('Interview', 'Offer')).toBe(true);
    expect(isValidTransition('Offer', 'Hired')).toBe(true);
  });

  test('should allow transition to Rejected from any stage', () => {
    expect(isValidTransition('Applied', 'Rejected')).toBe(true);
    expect(isValidTransition('Screening', 'Rejected')).toBe(true);
    expect(isValidTransition('Interview', 'Rejected')).toBe(true);
    expect(isValidTransition('Offer', 'Rejected')).toBe(true);
  });

  test('should reject transitions starting from terminal states (Hired/Rejected)', () => {
    expect(isValidTransition('Hired', 'Screening')).toBe(false);
    expect(isValidTransition('Hired', 'Rejected')).toBe(false);
    expect(isValidTransition('Rejected', 'Applied')).toBe(false);
    expect(isValidTransition('Rejected', 'Screening')).toBe(false);
  });

  test('should reject skipping stages (invalid forward leaps)', () => {
    expect(isValidTransition('Applied', 'Interview')).toBe(false);
    expect(isValidTransition('Applied', 'Offer')).toBe(false);
    expect(isValidTransition('Applied', 'Hired')).toBe(false);
    expect(isValidTransition('Screening', 'Offer')).toBe(false);
    expect(isValidTransition('Screening', 'Hired')).toBe(false);
    expect(isValidTransition('Interview', 'Hired')).toBe(false);
  });

  test('should reject backward transitions', () => {
    expect(isValidTransition('Screening', 'Applied')).toBe(false);
    expect(isValidTransition('Interview', 'Screening')).toBe(false);
    expect(isValidTransition('Offer', 'Interview')).toBe(false);
    expect(isValidTransition('Hired', 'Offer')).toBe(false);
  });

  test('should reject transitions to the same stage or with missing inputs', () => {
    expect(isValidTransition('Applied', 'Applied')).toBe(false);
    expect(isValidTransition('Screening', 'Screening')).toBe(false);
    expect(isValidTransition('', 'Applied')).toBe(false);
    expect(isValidTransition('Applied', '')).toBe(false);
  });
});
