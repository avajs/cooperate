import path from 'path';
import {registerSharedWorker} from 'ava/plugin';
import never from 'never';

import {Data, MessageType, SemaphoreCreationFailed} from './types';

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

export class Semaphore {
	readonly #context: SharedContext;

	constructor(
		context: SharedContext,
		public readonly id: string,
		public readonly initialValue: number,
		public readonly autoRelease: boolean
	) {
		this.#context = context;

		if (initialValue < 0) {
			throw new RangeError('initialValue must be non-negative');
		}
	}

	async down(amount = 1) {
		if (amount < 0) {
			throw new RangeError('amount must be non-negative');
		}

		// Allow down() to be called before the shared worker is availabe.
		await protocol.available;

		return downSemaphore(this, this.#context.id, amount, true);
	}

	async downNow(amount = 1) {
		if (amount < 0) {
			throw new RangeError('amount must be non-negative');
		}

		// Down immediately, which will fail if the protocol is not available.
		// "Now" should not mean "wait until we're ready."

		return downSemaphore(this, this.#context.id, amount, false);
	}

	async up(amount = 1) {
		if (amount < 0) {
			throw new RangeError('amount must be non-negative');
		}

		// Allow up() to be called before the shared worker is availabe.
		await protocol.available;

		const message = protocol.publish({
			type: MessageType.SEMAPHORE_UP,
			contextId: this.#context.id,
			semaphore: this,
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

async function downSemaphore(semaphore: Semaphore, contextId: string, amount: number, wait: boolean): Promise<() => void> {
	const {autoRelease, id, initialValue} = semaphore;
	const message = protocol.publish({
		type: MessageType.SEMAPHORE_DOWN,
		contextId,
		semaphore: {autoRelease, id, initialValue},
		amount,
		wait
	});

	for await (const reply of message.replies()) {
		if (reply.data.type === MessageType.SEMAPHORE_SUCCEEDED) {
			return () => {
				reply.reply({
					type: MessageType.SEMAPHORE_RELEASE
				});
			};
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
		return 'SempahoreCreationError';
	}

	constructor(semaphore: Semaphore, {autoRelease, initialValue}: SemaphoreCreationFailed) {
		super(`Failed to create semaphore: expected initial value ${semaphore.initialValue} (got ${initialValue}) and auto-release ${String(semaphore.autoRelease)} (got ${String(autoRelease)})`);
		this.semaphoreId = semaphore.id;
	}
}

export class SharedContext {
	constructor(public readonly id: string) {}

	createLock(id: string): Lock {
		return new Lock(this, id);
	}

	createSemaphore(id: string, {autoRelease = true, initialValue = 0}: {autoRelease?: boolean; initialValue?: number} = {}): Semaphore {
		return new Semaphore(this, id, initialValue, autoRelease);
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
