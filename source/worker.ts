import {SharedWorker} from 'ava/plugin';
import never from 'never';

import {
	Data,
	Lock,
	MessageType,
	Reservation,
	SemaphoreDown,
	SemaphoreUp
} from './types';

type ReceivedMessage = SharedWorker.Experimental.ReceivedMessage<Data>;

const factory: SharedWorker.Factory = async ({negotiateProtocol}) => {
	const protocol = negotiateProtocol<Data>(['experimental']).ready();

	for await (const message of protocol.subscribe()) {
		const {data} = message;
		if (data.type === MessageType.LOCK) {
			void acquireLock(message, data);
		} else if (data.type === MessageType.RESERVE) {
			reserve(message, data);
		} else if (data.type === MessageType.SEMAPHORE_DOWN) {
			void downSemaphore(message, data);
		} else if (data.type === MessageType.SEMAPHORE_UP) {
			upSemaphore(message, data);
		}
	}
};

export default factory;

type Context = {
	locks: Map<string, {holderId: string; waiting: Array<{ holderId: string; notify: () => void }>}>;
	semaphores: Map<string, Semaphore>;
	reservedValues: Set<bigint | number | string>;
};

const sharedContexts = new Map<string, Context>();

function getContext(id: string): Context {
	const context = sharedContexts.get(id) ?? {
		locks: new Map(),
		semaphores: new Map(),
		reservedValues: new Set()
	};
	sharedContexts.set(id, context);
	return context;
}

async function acquireLock(message: ReceivedMessage, {contextId, lockId, wait}: Lock): Promise<void> {
	const context = getContext(contextId);

	const release = message.testWorker.teardown(() => {
		const current = context.locks.get(lockId);
		/* c8 ignore next 3 */
		if (current === undefined) { // This won't actually happen at runtime.
			return;
		}

		if (current.holderId !== message.id) {
			// We do not have the lock. Ensure we won't acquire it later.
			const waiting = current.waiting.filter(({holderId}) => holderId !== message.id);
			context.locks.set(lockId, {
				...current,
				waiting
			});
			return;
		}

		if (current.waiting.length === 0) {
			// We have the lock, but nobody else wants it. Delete it.
			context.locks.delete(lockId);
			return;
		}

		// Transfer the lock to the next in line.
		const [next, ...waiting] = current.waiting;
		context.locks.set(lockId, {
			holderId: next.holderId,
			waiting
		});

		next.notify();
	});

	if (!context.locks.has(lockId)) {
		context.locks.set(lockId, {
			holderId: message.id,
			waiting: []
		});

		for await (const {data} of message.reply({type: MessageType.LOCK_ACQUIRED}).replies()) {
			if (data.type === MessageType.LOCK_RELEASE) {
				release();
				break;
			}
		}

		return;
	}

	if (!wait) {
		release();
		message.reply({type: MessageType.LOCK_FAILED});
		return;
	}

	const current = context.locks.get(lockId) /* c8 ignore next */ ?? never();
	current.waiting.push({
		holderId: message.id,
		async notify() {
			for await (const {data} of message.reply({type: MessageType.LOCK_ACQUIRED}).replies()) {
				if (data.type === MessageType.LOCK_RELEASE) {
					release();
					break;
				}
			}
		}
	});
}

function reserve(message: ReceivedMessage, {contextId, values}: Reservation): void {
	const context = getContext(contextId);

	const indexes = values.map((value, index) => {
		if (context.reservedValues.has(value)) {
			return -1;
		}

		context.reservedValues.add(value);
		return index;
	}).filter(index => index >= 0);

	message.testWorker.teardown(() => {
		for (const index of indexes) {
			context.reservedValues.delete(values[index]);
		}
	});

	message.reply({type: MessageType.RESERVED_INDEXES, indexes});
}

// A weighted semaphore.
// Waiting threads are woken in FIFO order (the semaphore is "fair").
// tryDown() ignores waiting threads (it may "barge").
class Semaphore {
	public value: number;
	public queue: Array<{amount: number; resolve: () => void}>;

	constructor(public readonly initialValue: number) {
		this.value = initialValue;
		this.queue = []; // Likely O(n) dequeue, but probably not a bottleneck
	}

	async down(amount = 1): Promise<void> {
		if (this.queue.length > 0 || !this.tryDown(amount)) {
			return new Promise(resolve => {
				this.queue.push({amount, resolve});
			});
		}
	}

	tryDown(amount = 1): boolean {
		if (this.value >= amount) {
			this.value -= amount;
			return true;
		}

		return false;
	}

	increase(amount = 1) {
		this.value += amount;

		while (this.queue.length > 0 && this.tryDown(this.queue[0].amount)) {
			(this.queue.shift() ?? never('just checked queue is nonempty')).resolve();
		}
	}
}

async function downSemaphore(
	message: ReceivedMessage,
	{contextId, semaphore: {id, initialValue}, amount, wait}: SemaphoreDown
): Promise<void> {
	const context = getContext(contextId);
	const semaphore = context.semaphores.get(id) ?? new Semaphore(initialValue);
	context.semaphores.set(id, semaphore);

	if (semaphore.initialValue !== initialValue) {
		message.reply({
			type: MessageType.SEMAPHORE_CREATION_FAILED,
			initialValue: semaphore.initialValue
		});
		return;
	}

	if (wait) {
		await semaphore.down(amount);
		message.reply({
			type: MessageType.SEMAPHORE_SUCCEEDED
		});
		return;
	}

	if (semaphore.tryDown(amount)) {
		message.reply({
			type: MessageType.SEMAPHORE_SUCCEEDED
		});
	} else {
		message.reply({
			type: MessageType.SEMAPHORE_FAILED
		});
	}
}

function upSemaphore(
	message: ReceivedMessage,
	{contextId, semaphore: {id, initialValue}, amount}: SemaphoreUp
) {
	const context = getContext(contextId);
	const semaphore = context.semaphores.get(id) ?? new Semaphore(initialValue);
	context.semaphores.set(id, semaphore);

	if (semaphore.initialValue !== initialValue) {
		message.reply({
			type: MessageType.SEMAPHORE_CREATION_FAILED,
			initialValue: semaphore.initialValue
		});
		return;
	}

	semaphore.increase(amount);

	message.reply({
		type: MessageType.SEMAPHORE_SUCCEEDED
	});
}
