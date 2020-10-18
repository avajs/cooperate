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
