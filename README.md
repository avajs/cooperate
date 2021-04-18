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

You can create a [counting semaphore](https://www.guru99.com/semaphore-in-operating-system.html) within a shared context:

```js
const initialValue = 3; // Must be non-negative. Defaults to 0 if not provided.
const semaphore = context.createSemaphore('my-semaphore', initialValue);
```

Within the same context, semaphores with the same ID must be created with the same initial value. Semaphores created later, with a different value, are unusable. Their methods will reject with a `SemaphoreCreationError`.

These semaphores have two methods: `acquire()` and `acquireNow()`:

TODO: Explain counting behavior (decrements from initial value)
TODO: Should acquireNow() throw a different error? Or find a more generic name?
TODO: Explain release function, with partial increment
TODO: Explain auto-release

#### Lower-level counting semaphores

You can create a lower-level counting semaphore which doesn't have any auto-release behavior. Instead you need to increment the semaphore in code.

```js
const initialValue = 3; // Must be non-negative. Defaults to 0 if not provided.
const semaphore = context.createCountingSemaphore('my-semaphore', initialValue);
```

TODO: Initial-value rules apply. The same semaphore may be instantiated differently
TODO: But the code inherits auto-release behavior from the first creation, instead of in the DOWN message

These semaphores have three methods. `down()` and `downNow()` decrement the value and `up()` increments:

```js
await semaphore.down();
await semaphore.up();
```

Values can never become negative. `down()` waits until the value can be decremented. `downNow()` instead rejects with a `SemaphoreDownError` if the value cannot be decremented immediately.

Semaphores are _weighted_. `down()`, `downNow()` and `up()` accept a non-negative amount, defaulting to `1`, by which to decrement or increment the value:

```js
await semaphore.down(0);
await semaphore.downNow(2);
await semaphore.up(1);
```

`down()` decrements in FIFO order. If the current value is `1`, and the first call tries to decrement with `2`, other calls have to wait until an increment, even if they want to decrement with just `1`.

`downNow()` however skips the queue and decrements if possible.

These `CountingSemaphore`s do not release the "acquired" amount when a test worker exits. When using a semaphore to model acquisitions from a resource pool, it's good practice to call `up()` in a `finally` block:

```js
await semaphore.down(amount);
try {
    return await doWork();
} finally {
    await semaphore.up(amount);
}
```
