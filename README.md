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
const initialValue = 3; // Must be non-negative.
const semaphore = context.createSemaphore('my-semaphore', initialValue);
```

Within the same context, semaphores with the same ID must be created with the same initial value. Semaphores created with a different value are unusable. Their methods will reject with a `SemaphoreCreationError`.

Semaphores have two methods: `acquire()` and `acquireNow()`. Use `acquire()` to decrement the semaphore's value. If the semaphore's value would become negative, instead `acquire()` waits until the semaphore's value is high enough.

```js
const semaphore = context.createSemaphore('my-semaphore', 3);
const release = await semaphore.acquire();
```

`acquire()` returns a function, `release()`, which increments the semaphore's value by the same amount as was acquired.

The semaphore is _managed_: if you don't call `release()`, it'll be run automatically when the test worker exits. Any pending `acquire()` calls will also be removed from the queue at this time.

`acquireNow()` works like `acquire()`, except that if the semaphore can't be decremented immediately, `acquireNow()` rejects with a `SemaphoreDownError` rather than wait.

Semaphores are _weighted_. `acquire()` and `acquireNow()` accept a non-negative amount, defaulting to `1`, by which to decrement or increment the value:

```js
await semaphore.acquire(0);
await semaphore.acquireNow(2);
```

You can also pass an amount to `release()` to release just part of the acquisition at a time:

```js
const release = await semaphore.acquire(3); // Decrements the semaphore by 3
release(1); // Increments the semaphore by 1
release(); // Increments the semaphore by the remaining 2
```

`acquire()` calls resolve in FIFO order. If the current value is `1`, and a call tries to acquire `2`, subsequent `acquire()` calls have to wait, even if they want to acquire just `1`.

`acquireNow()` skips the queue and decrements immediately if possible.

#### Lower-level, unmanaged semaphores

You can create a lower-level, _unmanaged_ semaphore which doesn't have any auto-release behavior. Instead you need to increment the semaphore in code.

```js
const initialValue = 3; // Must be non-negative.
const semaphore = context.createUnmanagedSemaphore('my-semaphore', initialValue);
```

These semaphores have three methods. `down()` and `downNow()` decrement the value and `up()` increments:

```js
await semaphore.down(0);
await semaphore.downNow(2);
await semaphore.up(); // `amount` defaults to 1
```

Like `acquire()` and `acquireNow()`, `down()` waits for the semaphore's value to be at least the requested amount, while `downNow()` rejects with `SemaphoreDownError` if the value cannot be decremented immediately.

These unmanaged semaphores do not release the "acquired" amount when a test worker exits.
