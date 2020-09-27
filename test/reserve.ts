import test from 'ava';
import {SharedContext} from '../source';
import synchronize from './_synchronize';

const context = new SharedContext(test.meta.file);
test.before(async t => {
	t.deepEqual(await context.reserve(42), [42]);
});

test('reserved values cannot be reserved again', async t => {
	t.deepEqual(await context.reserve(42, 6, 7), [6, 7]);
});

test('values are only reserved for a specific context', async t => {
	t.deepEqual(await new SharedContext(t.title).reserve(42, 6, 7), [42, 6, 7]);
});

test('reservations hold across test workers', async t => {
	const {context, release, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'reserve-first',
		theirs: 'reserve-last'
	});

	// Take our reservation.
	t.deepEqual(await context.reserve(42), [42]);
	// Let them try.
	release();
	// Make sure the worker doesn't exit until they're done, since that would free
	// up our reservation.
	await theirs.acquire();
});

test('reservations are cleared when the test worker exits', async t => {
	const {context} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'reserve-first',
		theirs: 'reserve-last'
	});

	// Take our reservation.
	t.deepEqual(await context.reserve(42), [42]);
	// And do nothing. This test worker will exit and that should release the
	// reservation.
});
