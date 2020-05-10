import {SharedWorker} from 'ava/plugin';
import never from 'never';

import {
	Data,
	Lock,
	MessageType,
	Reservation
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
		}
	}
};

export default factory;

type Context = {
	locks: Map<string, {holderId: string; waiting: Array<{ holderId: string; notify: () => void }>}>;
	reservedValues: Set<bigint | number | string>;
};

const sharedContexts = new Map<string, Context>();

function getContext(id: string): Context {
	const context = sharedContexts.get(id) ?? {
		locks: new Map(),
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
