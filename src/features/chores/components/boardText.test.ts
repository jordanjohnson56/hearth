import { describe, expect, it } from 'vitest';
import { latenessText, pointsText } from './boardText.js';

describe('board wording', () => {
  it.each([
    [1, '1 day late'],
    [3, '3 days late'],
  ])('says an overdue chore %i days late is "%s"', (daysLate, text) => {
    expect(latenessText({ id: 1, name: 'Feed the dog', points: 2, state: 'overdue', daysLate })).toBe(text);
  });

  it('says nothing about lateness for a chore due today', () => {
    expect(latenessText({ id: 1, name: 'Feed the dog', points: 2, state: 'due-today' })).toBeUndefined();
  });

  it.each([
    [1, '1 pt'],
    [5, '5 pts'],
  ])('writes %i points as "%s"', (points, text) => {
    expect(pointsText(points)).toBe(text);
  });
});
