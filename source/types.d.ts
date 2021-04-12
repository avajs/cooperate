export const enum MessageType {
	LOCK = 10,
	LOCK_ACQUIRED = 11,
	LOCK_FAILED = 12,
	LOCK_RELEASE = 13,
	RESERVE = 20,
	RESERVED_INDEXES = 21,
	SEMAPHORE_CREATION_FAILED = 30,
	SEMAPHORE_DOWN = 31,
	SEMAPHORE_FAILED = 32,
	SEMAPHORE_RELEASE = 33,
	SEMAPHORE_SUCCEEDED = 34,
	SEMAPHORE_UP = 35,
}

export type Lock = {
	type: MessageType.LOCK;
	contextId: string;
	lockId: string;
	wait: boolean;
};

export type Locked = {
	type: MessageType.LOCK_ACQUIRED | MessageType.LOCK_FAILED;
};

export type LockRelease = {
	type: MessageType.LOCK_RELEASE;
};

export type Reservation = {
	type: MessageType.RESERVE;
	contextId: string;
	values: Array<bigint | number | string>;
};

export type ReservedIndexes = {
	type: MessageType.RESERVED_INDEXES;
	indexes: number[];
};

type SemaphoreData = {
	id: string;
	initialValue: number;
};

export type SemaphoreDown = {
	type: MessageType.SEMAPHORE_DOWN;
	contextId: string;
	semaphore: SemaphoreData;
	amount: number;
	wait: boolean;
	track: boolean;
};

export type SemaphoreUp = {
	type: MessageType.SEMAPHORE_UP;
	contextId: string;
	semaphore: SemaphoreData;
	amount: number;
};

export type SemaphoreRelease = {
	type: MessageType.SEMAPHORE_RELEASE;
};

export type SemaphoreResult = {
	type: MessageType.SEMAPHORE_SUCCEEDED | MessageType.SEMAPHORE_FAILED;
};

export type SemaphoreCreationFailed = {
	type: MessageType.SEMAPHORE_CREATION_FAILED;
	initialValue: number;
};

export type Data =
	Lock | Locked | LockRelease |
	Reservation | ReservedIndexes |
	SemaphoreDown | SemaphoreResult | SemaphoreUp | SemaphoreRelease | SemaphoreCreationFailed;
