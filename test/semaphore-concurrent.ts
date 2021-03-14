import test from 'ava';
import {SharedContext, SemaphoreDownError} from '../source';
import synchronize from './_synchronize';

test('attempt to down() semaphore concurrently in different processes', async t => {
	const {context, release, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'down-second',
		theirs: 'down-first'
	});

	const semaphore = context.createSemaphore(t.title, 2);
	// Wait for them
	await theirs.acquire();
	// They hold the resources; try to get them
	await t.throwsAsync(semaphore.downNow(), {instanceOf: SemaphoreDownError});
	const result = semaphore.down();
	// Signal them to release
	release();
	// Get the resources
	await t.notThrowsAsync(result);
});
