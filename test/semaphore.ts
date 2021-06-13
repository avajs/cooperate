import test, {ExecutionContext} from 'ava';
import {SharedContext, SemaphoreCreationError, SemaphoreDownError, UnmanagedSemaphore, ManagedSemaphore} from '../source';
import synchronize from './_synchronize';

test('acquire binary semaphore', async t => {
	const semaphore = new SharedContext(t.title).createUnmanagedSemaphore(t.title, 1);

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

test('managed semaphore can\'t register mismatched initial values', async t => {
	const context = new SharedContext(t.title);
	const semaphoreOne = context.createSemaphore(t.title, 1);
	await semaphoreOne.acquire(); // Ensures the semaphore has been created

	const semaphoreTwo = context.createSemaphore(t.title, 2);
	const expected = {
		instanceOf: SemaphoreCreationError
	};
	await t.throwsAsync<SemaphoreCreationError>(semaphoreTwo.acquire(), expected);
	await t.throwsAsync<SemaphoreCreationError>(semaphoreTwo.acquireNow(), expected);
});

test('counting semaphore can\'t register mismatched initial values', async t => {
	const context = new SharedContext(t.title);
	const semaphoreOne = context.createUnmanagedSemaphore(t.title, 1);
	await semaphoreOne.down(); // Ensures the semaphore has been created

	const semaphoreTwo = context.createUnmanagedSemaphore(t.title, 2);
	const expected = {
		instanceOf: SemaphoreCreationError
	};
	await t.throwsAsync<SemaphoreCreationError>(semaphoreTwo.down(), expected);
	await t.throwsAsync<SemaphoreCreationError>(semaphoreTwo.downNow(), expected);
	await t.throwsAsync<SemaphoreCreationError>(semaphoreTwo.up(), expected);
});

// Tries to down() the semaphore at increasing amounts. Returns the last amount
// that succeeds. _If_ nothing else is using the semaphore, this is the
// semaphore's available capacity.
async function probeManualRelease(semaphore: UnmanagedSemaphore) {
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

async function probeManagement(semaphore: ManagedSemaphore): Promise<number> {
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

test('acquire unmanaged semaphore', async t => {
	const semaphore = new SharedContext(test.meta.file).createUnmanagedSemaphore(t.title, 3);
	const unblocked: number[] = [];

	await semaphore.down(2).then(() => unblocked.push(1));
	t.is(await probeManualRelease(semaphore), 1);
	const second = semaphore.down(2).then(() => unblocked.push(2)); // eslint-disable-line promise/prefer-await-to-then
	t.is(await probeManualRelease(semaphore), 1);
	const third = semaphore.down().then(() => unblocked.push(3)); // eslint-disable-line promise/prefer-await-to-then
	t.is(await probeManualRelease(semaphore), 1);
	await semaphore.up();
	await second;
	t.is(await probeManualRelease(semaphore), 0);
	await semaphore.up();
	await third;
	t.deepEqual(unblocked, [1, 2, 3]);
});

test('acquire managed semaphore', async t => {
	const semaphore = new SharedContext(test.meta.file).createSemaphore(t.title, 3);
	const unblocked: number[] = [];

	const one = semaphore.acquire(2);
	// eslint-disable-next-line promise/prefer-await-to-then, @typescript-eslint/no-floating-promises
	one.then(() => unblocked.push(1));
	const releaseOne = await one;
	t.is(await probeManagement(semaphore), 1);
	const two = semaphore.acquire(2);
	// eslint-disable-next-line promise/prefer-await-to-then, @typescript-eslint/no-floating-promises
	two.then(() => unblocked.push(2));
	t.is(await probeManagement(semaphore), 1);
	const three = semaphore.acquire();
	// eslint-disable-next-line promise/prefer-await-to-then, @typescript-eslint/no-floating-promises
	three.then(() => unblocked.push(3));
	t.is(await probeManagement(semaphore), 1);
	releaseOne();
	const releaseTwo = await two;
	t.is(await probeManagement(semaphore), 0);
	releaseTwo();
	await three;
	t.deepEqual(unblocked, [1, 2, 3]);
});

test('increment unmanaged semaphore before decrementing', async t => {
	const semaphore = new SharedContext(test.meta.file).createUnmanagedSemaphore(t.title, 0);
	t.is(await probeManualRelease(semaphore), 0);
	await semaphore.up();
	t.is(await probeManualRelease(semaphore), 1);
	await semaphore.downNow();
});

test('unmanaged semaphore amounts can\'t be negative', async t => {
	const context = new SharedContext(test.meta.file);
	t.throws(() => context.createUnmanagedSemaphore(t.title, -1), {instanceOf: RangeError});
	const semaphore = context.createUnmanagedSemaphore(t.title, 0);
	await t.throwsAsync(semaphore.down(-1), {instanceOf: RangeError});
	await t.throwsAsync(semaphore.downNow(-1), {instanceOf: RangeError});
	await t.throwsAsync(semaphore.up(-1), {instanceOf: RangeError});
});

test('managed semaphore amounts can\'t be negative', async t => {
	const context = new SharedContext(test.meta.file);
	t.throws(() => context.createSemaphore(t.title, -1), {instanceOf: RangeError});
	const semaphore = context.createSemaphore(t.title, 1);
	await t.throwsAsync(semaphore.acquire(-1), {instanceOf: RangeError});
	await t.throwsAsync(semaphore.acquireNow(-1), {instanceOf: RangeError});
	t.is(await probeManagement(semaphore), 1);

	{
		const release = await semaphore.acquire();
		t.throws(() => release(-1), {instanceOf: RangeError});
		release();
	}

	{
		const release = await semaphore.acquireNow();
		t.throws(() => release(-1), {instanceOf: RangeError});
		release();
	}
});

test('unmanaged semaphore values must be integers', async t => {
	const context = new SharedContext(test.meta.file);
	t.throws(() => context.createUnmanagedSemaphore(t.title, 1.5), {instanceOf: RangeError});
	const semaphore = context.createUnmanagedSemaphore(t.title, 2);
	await t.throwsAsync(semaphore.down(0.5), {instanceOf: RangeError});
	await t.throwsAsync(semaphore.downNow(0.5), {instanceOf: RangeError});
	await semaphore.down(2);
	await t.throwsAsync(semaphore.up(1.5), {instanceOf: RangeError});
});

test('managed semaphore values must be integers', async t => {
	const context = new SharedContext(test.meta.file);
	t.throws(() => context.createSemaphore(t.title, 1.5), {instanceOf: RangeError});
	const semaphore = context.createSemaphore(t.title, 2);
	await t.throwsAsync(semaphore.acquire(0.75), {instanceOf: RangeError});
	await t.throwsAsync(semaphore.acquireNow(0.75), {instanceOf: RangeError});
	const release1 = await semaphore.acquire(1);
	t.throws(() => release1(0.25), {instanceOf: RangeError});
});

test('attempt to acquire() semaphore concurrently in different processes', async t => {
	const {context, release: releaseLock, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'down-first',
		theirs: 'down-second'
	});

	const semaphore = context.createSemaphore(t.title, 2);
	// Acquire two units
	const release = await semaphore.acquire(2);
	// Let them try
	releaseLock();
	// Wait for them
	await theirs.acquire();
	// Release one unit
	release(1);

	t.pass();
});

test('semaphore is cleaned up when a test worker exits', async t => {
	const {context, theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'unused',
		theirs: 'torn down'
	});
	const semaphore = context.createSemaphore(t.title, 1);

	// Wait for them to acquire the semaphore
	const releaseTheirs = await theirs.acquire();

	// Try to acquire the semaphore
	const releaseSemaphorePromise = semaphore.acquire();

	// Signal them to exit
	releaseTheirs();

	// Check that we succeed in acquiring the semaphore
	await t.notThrowsAsync(releaseSemaphorePromise);
});

type Acquirer = ManagedSemaphore['acquire'];

async function testPartialRelease(t: ExecutionContext, acquire: Acquirer) {
	const semaphore = new SharedContext(test.meta.file).createSemaphore(t.title, 3);
	const release = await acquire.call(semaphore, 3);
	t.is(await probeManagement(semaphore), 0);
	release(1);
	t.is(await probeManagement(semaphore), 1);
	release(2);
	t.is(await probeManagement(semaphore), 3);
}

testPartialRelease.title = (provided: string, acquire: Acquirer) => `${provided || `${acquire.name}()`} acquisitions can be partially released`;

test(testPartialRelease, ManagedSemaphore.prototype.acquire);
test(testPartialRelease, ManagedSemaphore.prototype.acquireNow);

async function overRelease(t: ExecutionContext, acquire: Acquirer) {
	const semaphore = new SharedContext(test.meta.file).createSemaphore(t.title, 4);
	const release = await acquire.call(semaphore, 2);
	t.throws(() => release(3), {
		instanceOf: RangeError
	});
}

overRelease.title = (provided: string, acquire: Acquirer) =>
	`${provided || `${acquire.name}()`} can't release more than the acquired amount`;

test(overRelease, ManagedSemaphore.prototype.acquire);
test(overRelease, ManagedSemaphore.prototype.acquireNow);

async function overReleaseRemaining(t: ExecutionContext, acquire: Acquirer) {
	const semaphore = new SharedContext(test.meta.file).createSemaphore(t.title, 4);
	const release = await acquire.call(semaphore, 3);
	release(2);
	t.throws(() => release(2));
}

overReleaseRemaining.title = (provided: string, acquire: Acquirer) =>
	`${provided || `${acquire.name}()`} can't release more than the remaining amount`;

test(overReleaseRemaining, ManagedSemaphore.prototype.acquire);
test(overReleaseRemaining, ManagedSemaphore.prototype.acquireNow);

test('can always release zero', async t => {
	const semaphore = new SharedContext(test.meta.file).createSemaphore(t.title, 4);
	const release = await semaphore.acquire(1);
	release(1);
	t.notThrows(() => release(0));
});

test.serial('managed and unmanaged semaphores share their ID space', async t => {
	const context = new SharedContext(test.meta.file);
	const managedFirst = context.createSemaphore(t.title, 2);
	await managedFirst.acquire();
	const unmanagedSecond = context.createUnmanagedSemaphore(t.title, 3);
	await t.throwsAsync(unmanagedSecond.down(), {instanceOf: SemaphoreCreationError});

	const unmanagedFirst = context.createUnmanagedSemaphore(t.title.toUpperCase(), 3);
	await unmanagedFirst.down();
	const managedSecond = context.createSemaphore(t.title.toUpperCase(), 2);
	await t.throwsAsync(managedSecond.acquire(), {instanceOf: SemaphoreCreationError});
});
