import test from 'ava';
import {SharedContext, SemaphoreDownError} from '../source/index.js';
import synchronize from './_synchronize.js';

test('attempt to acquire() semaphore concurrently in different processes', async t => {
	const {context, release, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'down-second',
		theirs: 'down-first',
	});

	const semaphore = context.createSemaphore(t.title, 2);
	// Wait for them
	await theirs.acquire();
	// They hold the resources; try to get them
	await t.throwsAsync(semaphore.acquireNow(), {instanceOf: SemaphoreDownError});
	const result = semaphore.acquire();
	// Signal them to release
	release();
	// Get the resources
	await t.notThrowsAsync(result);
});

test('semaphore is cleaned up when a test worker exits', async t => {
	const {context, ours, release: releaseOurs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'torn down',
		theirs: 'unused',
	});
	const semaphore = context.createSemaphore(t.title, 1);

	// Acquire the semaphore
	await semaphore.acquireNow();
	// Over-acquire the semaphore
	void semaphore.acquire();
	void semaphore.acquire();

	// Signal them to try
	releaseOurs();

	// Wait for them to try
	await ours.acquire();

	// Lock & semaphore will be released when we exit
	t.pass();
});
