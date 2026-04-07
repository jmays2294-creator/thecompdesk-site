/**
 * benefit-rate-engine.mjs — NY Workers' Comp Benefit Rate Lookup
 *
 * Given a date of injury, returns the statutory weekly maximum and minimum
 * compensation rates applicable under WCL §15(6)(a) and WCL §204.
 * No DOM dependencies — runs in both browser (ES module) and Node.js.
 */

import { getMaxForDate, getMinForDate } from './ny-rate-table.mjs';

/**
 * Look up the statutory weekly rates for a given date of injury.
 *
 * @param {string} doi - "YYYY-MM-DD" date of injury
 * @returns {{
 *   maxRate: number|null,
 *   maxRateLabel: string,
 *   minRate: number|null,
 *   minRateLabel: string,
 *   minNote: string,
 *   isIndexedMin: boolean,
 *   warnings: string[]
 * }}
 */
export function getRatesForDOI(doi) {
  const warnings = [];

  if (!doi) {
    return {
      maxRate: null, maxRateLabel: '',
      minRate: null, minRateLabel: '', minNote: '',
      isIndexedMin: false, warnings: ['Date of injury is required.'],
    };
  }

  const today = new Date();
  const doiDate = new Date(doi + 'T12:00:00');

  if (isNaN(doiDate.getTime())) {
    return {
      maxRate: null, maxRateLabel: '',
      minRate: null, minRateLabel: '', minNote: '',
      isIndexedMin: false, warnings: ['Invalid date of injury.'],
    };
  }

  if (doiDate > today) {
    warnings.push('Date of injury cannot be in the future.');
    return {
      maxRate: null, maxRateLabel: '',
      minRate: null, minRateLabel: '', minNote: '',
      isIndexedMin: false, warnings,
    };
  }

  // Warn if DOI is more than 10 years ago (stale claim territory)
  const tenYearsAgo = new Date(today);
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  if (doiDate < tenYearsAgo) {
    warnings.push(
      'This date of injury is more than 10 years ago. Verify the date is correct ' +
      'and that your claim is still open.'
    );
  }

  const maxRec = getMaxForDate(doi);
  const minRec = getMinForDate(doi);

  return {
    maxRate:      maxRec ? maxRec.max : null,
    maxRateLabel: maxRec ? maxRec.l   : '',
    minRate:      (minRec && minRec.min != null) ? minRec.min : null,
    minRateLabel: minRec ? minRec.l : '',
    minNote:      minRec ? (minRec.n || '') : '',
    isIndexedMin: !!(minRec && minRec.min == null),
    warnings,
  };
}
