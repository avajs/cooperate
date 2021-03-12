import path from 'path';
import {registerSharedWorker} from 'ava/plugin';
import never from 'never';

import {Data, MessageType} from './types';

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
		// Allow reserve() to be called before the shared worker is availabe.
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

export class Semaphore {
	readonly #context: SharedContext;

	constructor(
		context: SharedContext,
		public readonly id: string,
		public readonly initialValue: number
	) {
		this.#context = context;
	}

	async down({wait = true, amount = 1} = {}) {
		if (wait) {
			await protocol.available;
		}

		const {id, initialValue} = this;
		const message = protocol.publish({
			type: MessageType.SEMAPHORE_DOWN,
			contextId: this.#context.id,
			semaphore: {id, initialValue},
			wait,
			amount
		});

		for await (const reply of message.replies()) {
			if (reply.data.type === MessageType.SEMAPHORE_DECREASED) {
				return;
			}

			if (reply.data.type === MessageType.SEMAPHORE_FAILED) {
				throw new SemaphoreDownError(this.id, amount);
			}

			if (reply.data.type === MessageType.SEMAPHORE_MISMATCH) {
				throw new SemaphoreMismatchError(this.id, this.initialValue, reply.data.initialValue);
			}
		}
	}

	async up({amount = 1} = {}) {
		await protocol.available;

		const {id, initialValue} = this;
		protocol.publish({
			type: MessageType.SEMAPHORE_UP,
			contextId: this.#context.id,
			semaphore: {id, initialValue},
			amount
		});
	}
}

export class SemaphoreDownError extends Error {
	get name() {
		return 'SemaphoreDownError';
	}

	constructor(public readonly semaphoreId: string, public readonly amount: number) {
		super('Could not immediately acquire the requested amount');
	}
}

export class SemaphoreMismatchError extends Error {
	get name() {
		return 'SempahoreMismatchError';
	}

	constructor(
		public readonly semaphoreId: string,
		public readonly triedInitialValue: number,
		public readonly actualInitialValue: number
	) {
		super('Failed to create semaphore due to mismatched initial values');
	}
}

export class SharedContext {
	constructor(public readonly id: string) {}

	createLock(id: string): Lock {
		return new Lock(this, id);
	}

	createSemaphore(id: string, value: number): Semaphore {
		return new Semaphore(this, id, value);
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
