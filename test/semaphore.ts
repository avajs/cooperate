import test from 'ava';
import {SharedContext, SemaphoreCreationError, SemaphoreDownError, Semaphore} from '../source';
import synchronize from './_synchronize';

test('acquire binary semaphore', async t => {
	const semaphore = new SharedContext(t.title).createSemaphore(t.title, 1);

	const first = semaphore.down();
	await t.notThrowsAsync(first);

	const error = await t.throwsAsync<SemaphoreDownError>(semaphore.downNow(), {instanceOf: SemaphoreDownError});
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
	await t.throwsAsync<SemaphoreCreationError>(semaphoreTwo.down(), {instanceOf: SemaphoreCreationError});
	await t.throwsAsync<SemaphoreCreationError>(semaphoreTwo.up(), {instanceOf: SemaphoreCreationError});
});

// Tries to down() the semaphore at increasing amounts. Returns the last amount
// that succeeds. _If_ nothing else is using the semaphore, this is the
// semaphore's available capacity.
async function probe(semaphore: Semaphore) {
	let amount = 0;
	try {
		while (true) {
			await semaphore.downNow(amount);
			await semaphore.up(amount);
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

	await semaphore.down(2).then(() => unblocked.push(1));
	t.is(await probe(semaphore), 1);
	const second = semaphore.down(2).then(() => unblocked.push(2)); // eslint-disable-line promise/prefer-await-to-then
	t.is(await probe(semaphore), 1);
	const third = semaphore.down().then(() => unblocked.push(3)); // eslint-disable-line promise/prefer-await-to-then
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
	await semaphore.downNow();
});

test('can\'t createSemaphore(), down(), or up() by negative numbers', async t => {
	const context = new SharedContext(test.meta.file);
	t.throws(() => context.createSemaphore(t.title, -1), {instanceOf: RangeError});
	const semaphore = context.createSemaphore(t.title, 0);
	await t.throwsAsync(semaphore.down(-1), {instanceOf: RangeError});
	await t.throwsAsync(semaphore.up(-1), {instanceOf: RangeError});
});

test('semaphore value can be non-integral', async t => {
	const context = new SharedContext(test.meta.file);
	const semaphore = context.createSemaphore(t.title, 1.5);
	await semaphore.down(0.5);
	await semaphore.down(0.5);
	await t.throwsAsync(semaphore.downNow(1));
	await t.notThrowsAsync(semaphore.downNow(0.5));
	await semaphore.up(1.5);
	await t.throwsAsync(semaphore.downNow(2));
	await t.notThrowsAsync(semaphore.downNow(1.5));
});

test('attempt to down() semaphore concurrently in different processes', async t => {
	const {context, release, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'down-first',
		theirs: 'down-second'
	});

	const semaphore = context.createSemaphore(t.title, 2);
	// Acquire two units
	await semaphore.down(2);
	// Let them try
	release();
	// Wait for them
	await theirs.acquire();
	// Release one unit
	await semaphore.up();

	t.pass();
});

async function probeTracked(semaphore: Semaphore): Promise<number> {
	let amount = 0;
	try {
		while (true) {
			const release = await semaphore.acquireNow(amount);
			release();
			amount++;
		}
	} catch (error) {
		if (error instanceof SemaphoreDownError) {
			return amount - 1;
		}

		throw error;
	}
}

test('semaphore.acquire() works', async t => {
	const semaphore = new SharedContext(test.meta.file).createSemaphore(t.title, 3);
	const unblocked: number[] = [];

	const one = semaphore.acquire(2);
	// eslint-disable-next-line promise/prefer-await-to-then, @typescript-eslint/no-floating-promises
	one.then(() => unblocked.push(1));
	const releaseOne = await one;
	t.is(await probeTracked(semaphore), 1);
	const two = semaphore.acquire(2);
	// eslint-disable-next-line promise/prefer-await-to-then, @typescript-eslint/no-floating-promises
	two.then(() => unblocked.push(2));
	t.is(await probeTracked(semaphore), 1);
	const three = semaphore.acquire();
	// eslint-disable-next-line promise/prefer-await-to-then, @typescript-eslint/no-floating-promises
	three.then(() => unblocked.push(3));
	t.is(await probeTracked(semaphore), 1);
	releaseOne();
	const releaseTwo = await two;
	t.is(await probeTracked(semaphore), 0);
	releaseTwo();
	await three;
	t.deepEqual(unblocked, [1, 2, 3]);
});

test('semaphore is cleaned up when a test worker exits', async t => {
	const {context, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'unused',
		theirs: 'torn down'
	});
	const semaphore = context.createSemaphore(t.title, 1);

	// Wait for them to exit
	await theirs.acquire();

	// Try to acquire the semaphore
	await t.notThrowsAsync(semaphore.acquireNow());
});
