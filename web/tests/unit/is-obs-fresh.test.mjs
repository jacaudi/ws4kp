// The fork keeps old observations on screen rather than adopting upstream's 75-minute cutoff
// (see utils/is-obs-fresh.mjs). Reverting that file to upstream's would blank three displays
// whenever the NWS API lags, so pin the decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import isObsFresh from '../../server/scripts/modules/utils/is-obs-fresh.mjs';

test('an hours-old observation is still shown', () => {
	assert.equal(isObsFresh(new Date(Date.now() - 6 * 3600_000).toISOString()), true);
});
