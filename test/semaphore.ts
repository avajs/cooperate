import test from 'ava';
import {SharedContext, SemaphoreMismatchError, SemaphoreDownError, Semaphore} from '../source';
import synchronize from './_synchronize';

test('acquire binary semaphore', async t => {
	const semaphore = new SharedContext(t.title).createSemaphore(t.title, 1);

	const first = semaphore.down();
	await t.notThrowsAsync(first);

	const error = await t.throwsAsync<SemaphoreDownError>(semaphore.down({wait: false}), {instanceOf: SemaphoreDownError});
	t.is(error.semaphoreId, semaphore.id);

	const second = semaphore.down();
	await semaphore.up();
	await t.notThrowsAsync(second);

	const third = semaphore.down();
	await semaphore.up();
	await t.notThrowsAsync(third);
});

test('can\'t register mismatched initial values', async t => {
	const context = new SharedContext(t.title);
	const semaphoreOne = context.createSemaphore(t.title, 1);
	await semaphoreOne.down();
	const semaphoreTwo = context.createSemaphore(t.title, 2);
	await t.throwsAsync<SemaphoreMismatchError>(semaphoreTwo.down(), {instanceOf: SemaphoreMismatchError});
});

// Tries to down() the semaphore at increasing amounts. Returns the last amount
// that succeeds. _If_ nothing else is using the semaphore, this is the
// semaphore's available capacity.
async function probe(semaphore: Semaphore) {
	let amount = 0;
	try {
		while (true) {
			await semaphore.down({amount, wait: false});
			await semaphore.up({amount});
			amount++;
		}
	} catch (error) {
		if (error instanceof SemaphoreDownError) {
			return amount - 1;
		}

		throw error;
	}
}

test('acquire counting semaphore', async t => {
	const semaphore = new SharedContext(test.meta.file).createSemaphore(t.title, 3);
	const unblocked: number[] = [];

	await semaphore.down({amount: 2}).then(() => unblocked.push(1));
	t.is(await probe(semaphore), 1);
	const second = semaphore.down({amount: 2}).then(() => unblocked.push(2)); // eslint-disable-line promise/prefer-await-to-then
	t.is(await probe(semaphore), 1);
	const third = semaphore.down({amount: 1}).then(() => unblocked.push(3)); // eslint-disable-line promise/prefer-await-to-then
	t.is(await probe(semaphore), 1);
	await semaphore.up();
	await second;
	t.is(await probe(semaphore), 0);
	await semaphore.up();
	await third;
	t.deepEqual(unblocked, [1, 2, 3]);
});

test('increment semaphore before decrementing', async t => {
	const semaphore = new SharedContext(test.meta.file).createSemaphore(t.title, 0);
	t.is(await probe(semaphore), 0);
	await semaphore.up();
	t.is(await probe(semaphore), 1);
	await semaphore.down({wait: false});
});

test('can\'t down() or up() by negative numbers', async t => {
	const semaphore = new SharedContext(test.meta.file).createSemaphore(t.title, 0);
	await t.throwsAsync(semaphore.down({amount: -1}), {instanceOf: RangeError});
	await t.throwsAsync(semaphore.up({amount: -1}), {instanceOf: RangeError});
});

test('attempt to down() semaphore concurrently in different processes', async t => {
	const {context, release, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'down-first',
		theirs: 'down-second'
	});

	const semaphore = context.createSemaphore(t.title, 2);
	// Acquire two units
	await semaphore.down({amount: 2});
	// Let them try
	release();
	// Wait for them
	await theirs.acquire();
	// Release one unit
	await semaphore.up();

	t.pass();
});
