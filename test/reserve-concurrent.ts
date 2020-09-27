import test from 'ava';
import {SharedContext} from '../source';
import synchronize from './_synchronize';

test('reservations hold across test workers', async t => {
	const {context, release, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'reserve-last',
		theirs: 'reserve-first'
	});

	// Wait for their lock to be freed.
	await theirs.acquire();
	// Verify we can't reserve 42; they have it.
	t.deepEqual(await context.reserve(42), []);
	// Free them up.
	release();
});

test('reservations are cleared when the test worker exits', async t => {
	const {context, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'reserve-last',
		theirs: 'reserve-first'
	});

	// Wait for their lock to be freed.
	await theirs.acquire();
	// We should now be able to reserve 42.
	t.deepEqual(await context.reserve(42), [42]);
});
