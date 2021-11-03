import test from 'ava';
import {SharedContext, LockAcquisitionError} from '../source/index.js';
import synchronize from './_synchronize.js';

test('acquire locks', async t => {
	const lock = new SharedContext(test.meta.file).createLock(t.title);

	const first = lock.acquire();
	await t.notThrowsAsync(first);

	const error = await t.throwsAsync<LockAcquisitionError>(lock.acquireNow(), {instanceOf: LockAcquisitionError});
	t.is(error!.lockId, lock.id);

	const second = lock.acquire();
	(await first)();
	await t.notThrowsAsync(second);

	const third = lock.acquire();
	(await second)();
	await t.notThrowsAsync(third);
});

test('attempt to acquire locks concurrently in different processes', async t => {
	const {release} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'release',
		theirs: 'acquire',
	});

	release();
	t.pass();
});
