import path from 'path';
import {registerSharedWorker, SharedWorker} from 'ava/plugin';
import never from 'never';

import {Data, MessageType, SemaphoreCreationFailed} from './types';

type ReceivedMessage = SharedWorker.Plugin.Experimental.ReceivedMessage<Data>;

const protocol = registerSharedWorker<Data>({
	filename: path.join(__dirname, 'worker.js'),
	supportedProtocols: ['experimental']
});

export class Lock {
	readonly #context: SharedContext;

	constructor(context: SharedContext, public readonly id: string) {
		this.#context = context;
	}

	async acquire(): Promise<() => void> {
		// Allow acquire() to be called before the shared worker is availabe.
		await protocol.available;

		const message = protocol.publish({
			type: MessageType.LOCK,
			contextId: this.#context.id,
			lockId: this.id,
			wait: true
		});

		for await (const reply of message.replies()) {
			if (reply.data.type === MessageType.LOCK_ACQUIRED) {
				return () => {
					reply.reply({type: MessageType.LOCK_RELEASE});
				};
			}
		}

		/* c8 ignore next 2 */
		// The above loop will never actually break if the lock is not acquired.
		return never();
	}

	async acquireNow(): Promise<() => void> {
		// Publish immediately, which will fail if the protocol is not available.
		// "Now" should not mean "wait until we're ready."

		const message = protocol.publish({
			type: MessageType.LOCK,
			contextId: this.#context.id,
			lockId: this.id,
			wait: false
		});

		for await (const reply of message.replies()) {
			if (reply.data.type === MessageType.LOCK_ACQUIRED) {
				return () => {
					reply.reply({type: MessageType.LOCK_RELEASE});
				};
			}

			if (reply.data.type === MessageType.LOCK_FAILED) {
				throw new LockAcquisitionError(this.id);
			}
		}

		/* c8 ignore next 2 */
		// The above loop will never actually break if the lock is not acquired.
		return never();
	}
}

export class LockAcquisitionError extends Error {
	get name() {
		return 'LockAcquisitionError';
	}

	constructor(public readonly lockId: string) {
		super('Could not immediately acquire the lock');
	}
}

export class ManagedSemaphore {
	readonly #context: SharedContext;

	constructor(
		context: SharedContext,
		public readonly id: string,
		public readonly initialValue: number
	) {
		if (initialValue < 0 || !Number.isSafeInteger(initialValue)) {
			throw new RangeError('initialValue must be a non-negative safe integer');
		}

		this.#context = context;
	}

	async acquire(amount = 1) {
		if (amount < 0 || !Number.isSafeInteger(amount)) {
			throw new RangeError('amount must be a non-negative safe integer');
		}

		// Allow acquire() to be called before the shared worker is availabe.
		await protocol.available;

		const reply = await downSemaphore(this, this.#context.id, amount, true);
		return (release = amount) => {
			if (release < 0 || !Number.isSafeInteger(release) || release > amount) {
				throw new RangeError('Amount to release must be a non-negative safe integer and <= remaining amount');
			}

			amount -= release;
			reply.reply({
				type: MessageType.SEMAPHORE_RELEASE,
				amount: release
			});
		};
	}

	async acquireNow(amount = 1) {
		if (amount < 0 || !Number.isSafeInteger(amount)) {
			throw new RangeError('amount must be a non-negative safe integer');
		}

		// Down immediately, which will fail if the protocol is not available.
		// "Now" should not mean "wait until we're ready."

		const reply = await downSemaphore(this, this.#context.id, amount, false);
		return (release = amount) => {
			if (release < 0 || release > amount) {
				throw new RangeError('Amount to release must be >= 0 and <= remaining amount');
			}

			amount -= release;
			reply.reply({
				type: MessageType.SEMAPHORE_RELEASE,
				amount: release
			});
		};
	}
}

export class UnmanagedSemaphore {
	readonly #context: SharedContext;

	constructor(
		context: SharedContext,
		public readonly id: string,
		public readonly initialValue: number
	) {
		if (initialValue < 0 || !Number.isSafeInteger(initialValue)) {
			throw new RangeError('initialValue must be a non-negative safe integer');
		}

		this.#context = context;
	}

	async down(amount = 1) {
		if (amount < 0 || !Number.isSafeInteger(amount)) {
			throw new RangeError('amount must be a non-negative safe integer');
		}

		// Allow down() to be called before the shared worker is availabe.
		await protocol.available;

		await downSemaphore(this, this.#context.id, amount, true);
	}

	async downNow(amount = 1) {
		if (amount < 0 || !Number.isSafeInteger(amount)) {
			throw new RangeError('amount must be a non-negative safe integer');
		}

		// Down immediately, which will fail if the protocol is not available.
		// "Now" should not mean "wait until we're ready."

		await downSemaphore(this, this.#context.id, amount, false);
	}

	async up(amount = 1) {
		if (amount < 0 || !Number.isSafeInteger(amount)) {
			throw new RangeError('amount must be a non-negative safe integer');
		}

		// Allow up() to be called before the shared worker is availabe.
		await protocol.available;

		const {id, initialValue} = this;
		const message = protocol.publish({
			type: MessageType.SEMAPHORE_UP,
			contextId: this.#context.id,
			semaphore: {managed: false, id, initialValue},
			amount
		});

		for await (const reply of message.replies()) {
			if (reply.data.type === MessageType.SEMAPHORE_SUCCEEDED) {
				return;
			}

			if (reply.data.type === MessageType.SEMAPHORE_CREATION_FAILED) {
				throw new SemaphoreCreationError(this, reply.data);
			}
		}

		/* c8 ignore next 2 */
		// The above loop will never actually break if the resources are not acquired.
		return never();
	}
}

type Semaphore = ManagedSemaphore | UnmanagedSemaphore;

async function downSemaphore(semaphore: Semaphore, contextId: string, amount: number, wait: boolean): Promise<ReceivedMessage> {
	const {id, initialValue} = semaphore;
	const message = protocol.publish({
		type: MessageType.SEMAPHORE_DOWN,
		contextId,
		semaphore: {managed: semaphore instanceof ManagedSemaphore, id, initialValue},
		amount,
		wait
	});

	for await (const reply of message.replies()) {
		if (reply.data.type === MessageType.SEMAPHORE_SUCCEEDED) {
			return reply;
		}

		if (reply.data.type === MessageType.SEMAPHORE_FAILED) {
			throw new SemaphoreDownError(id, amount);
		}

		if (reply.data.type === MessageType.SEMAPHORE_CREATION_FAILED) {
			throw new SemaphoreCreationError(semaphore, reply.data);
		}
	}

	/* c8 ignore next 2 */
	// The above loop will never actually break if the resources are not acquired.
	return never();
}

export class SemaphoreDownError extends Error {
	get name() {
		return 'SemaphoreDownError';
	}

	constructor(public readonly semaphoreId: string, public readonly amount: number) {
		super(`Could not immediately decrement with ${amount}`);
	}
}

export class SemaphoreCreationError extends Error {
	readonly semaphoreId: string;

	get name() {
		return 'SemaphoreCreationError';
	}

	constructor(semaphore: Semaphore, {initialValue, managed}: SemaphoreCreationFailed) {
		const initialValueSuffix = `initial value ${semaphore.initialValue} (got ${initialValue})`;
		if (semaphore instanceof ManagedSemaphore) {
			if (managed) {
				super(`Failed to create semaphore: expected ${initialValueSuffix}`);
			} else {
				super(`Failed to create semaphore: expected unmanaged and ${initialValueSuffix}`);
			}
		} else if (managed) {
			super(`Failed to create unmanaged semaphore: expected managed and ${initialValueSuffix}`);
		} else {
			super(`Failed to create unmanaged semaphore: expected ${initialValueSuffix}`);
		}

		this.semaphoreId = semaphore.id;
	}
}

export class SharedContext {
	constructor(public readonly id: string) {}

	createLock(id: string): Lock {
		return new Lock(this, id);
	}

	createSemaphore(id: string, initialValue: number): ManagedSemaphore {
		return new ManagedSemaphore(this, id, initialValue);
	}

	createUnmanagedSemaphore(id: string, initialValue: number): UnmanagedSemaphore {
		return new UnmanagedSemaphore(this, id, initialValue);
	}

	async reserve<T extends bigint | number | string>(...values: T[]): Promise<T[]> {
		// Allow reserve() to be called before the shared worker is availabe.
		await protocol.available;

		const message = protocol.publish({
			type: MessageType.RESERVE,
			contextId: this.id,
			values
		});

		for await (const {data} of message.replies()) {
			if (data.type === MessageType.RESERVED_INDEXES) {
				return data.indexes.map(index => values[index]);
			}
		}

		/* c8 ignore next 2 */
		// The above loop will never actually break if the lock is not acquired.
		return never();
	}
}
