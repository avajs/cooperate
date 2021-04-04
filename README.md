# @ava/cooperate

Experimental AVA plugin to enable cooperation between test files.

Install this as a development dependency alongside AVA itself:

```console
npm install --save-dev @ava/cooperate
```

Then make sure you've enabled the shared workers experiment:

`ava.config.js`:

```js
export default {
  nonSemVerExperiments: {
    sharedWorkers: true
  }
};
```

## Usage

Cooperation takes place within a shared context:

```js
const {SharedContext} = require('@ava/cooperate');

const context = new SharedContext('my-context');
```

Across all test files, contexts with the same ID (here: `my-context`) are shared.

### Locks

You can create a lock within a context:

```js
const lock = context.createLock('my-lock');
```

A lock needs to be acquired. This is asynchronous:

```js
const release = await lock.acquire();
```

Release the lock when you no longer need it:

```js
release();
```

Locks are released automatically once your tests are done.

Use `acquireNow()` to either acquire the lock, or fail:

```js
const release = await lock.acquireNow();
```

If the lock cannot be acquired this will throw with a `LockAcquisitionError`:

```js
try {
  await lock.acquireNow();
} catch (error) {
  // error instanceof LockAcquisitionError
  // error.name === 'LockAcquisitionError'
  // error.lockId === 'my-lock'
}
```

### Reservations

You can reserve primitive values like big integers, numbers and strings. Once reserved, no other test file can reserve these same values (if they use the correct shared context). Reserved values are released when your tests are done.

```js
const reserved = await context.reserve(1, 2, 3);
// `reserved` will be an array containing those values that could be reserved.
// It could be empty.
```

### Semaphores

You can create a semaphore within a shared context:

```js
const initialValue = 3; // initialValue must be non-negative
const semaphore = context.createSemaphore('my-semaphore', 3);
```

If two test files try to create a semaphore with the same context and id and different initial values, the second attempt will fail and using the semaphore in that file will reject:

```js
// test/runs-first.js
const context = new SharedContext('context');
const semaphore = context.createSemaphore('semaphore', 0);
```

```js
// test/runs-second.js
const context = new SharedContext('context');
const semaphore = context.createSemaphore('semaphore', 1);
try {
  await semaphore.down();
} catch (error) {
  // error instanceof SemaphoreCreationError
  // error.name === 'SemaphoreCreationError'
  // error.semaphoreId === 'semaphore'
  // error.triedInitialValue === 1
  // error.actualInitialValue === 0
}
```

Semaphores have three methods, `down()` and `downNow()` to decrement/acquire and `up()` to increment/release:

```js
await semaphore.down();
await semaphore.up();
```

`down()` blocks until the semaphore is available. `downNow()` instead rejects with a `SemaphoreDownError` if the semaphore is unavailable:

```js
try {
    await semaphore.downNow();
} catch (error) {
    // error instanceof SemaphoreDownError
    // error.name === 'SemaphoreDownError'
    // error.semaphoreId === 'my-semaphore'
    // error.amount === 1
}
```

`@ava/cooperate`'s semaphores are _weighted_. `down()`, `up()`, and `downNow()` accept a non-negative amount, defaulting to 1, by which to modify the semaphore:

```js
await semaphore.down(0);
await semaphore.up(1);
try {
    await semaphore.downNow(2);
} catch (error) {
    // ...
}
```

`down()` callers are woken in FIFO order. If the semaphore has 1 unit available and the first waiter is requesting 2 units, it will block other waiters, even if they are requesting only 1 or 0 units.

`downNow()` skips the queue and takes the requested amount if possible.

Unlike `Lock`, `Semaphore`s do not release the "acquired" amount when a test worker exits. When using a semaphore to model acquisitions from a resource pool, it's good practice to call `up()` in a `finally` block:

```js
await semaphore.down(amount);
try {
    return await doWork();
} finally {
    await semaphore.up(amount);
}
```
