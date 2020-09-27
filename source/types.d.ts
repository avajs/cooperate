export const enum MessageType {
	LOCK = 10,
	LOCK_ACQUIRED = 11,
	LOCK_FAILED = 12,
	LOCK_RELEASE = 13,
	RESERVE = 20,
	RESERVED_INDEXES = 21,
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

export type Data =
	Lock | Locked | LockRelease |
	Reservation | ReservedIndexes;
