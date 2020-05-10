import delay from 'delay';
import {Lock, SharedContext} from '../source';

type Synchronized = {
	context: SharedContext;
	ours: Lock;
	theirs: Lock;
	release: () => void;
};

export default async function synchronize({
	context,
	ours: ourId,
	theirs: theirId
}: {
	context: SharedContext;
	ours: string;
	theirs: string;
}): Promise<Synchronized> {
	const ours = context.createLock(ourId);
	const theirs = context.createLock(theirId);

	let release;
	while (true) {
		try {
			release = await ours.acquireNow();
			break;
		} catch {
			// We must acquire our lock. Try again.
			await delay(Math.random() * 10);
		}
	}

	// We have our lock. Wait for them to get theirs.
	while (true) {
		try {
			const releaseTheirs = await theirs.acquireNow();
			// Release their lock if we managed to acquire it.
			releaseTheirs();
			// They must acquire their lock. Try again.
			await delay(Math.random() * 10);
		} catch {
			// We don't have their lock, so they must be waiting for ours.
			break;
		}
	}

	// Wait long enough for both locks to be in place. We need to do this because
	// one side may release the lock before the other has failed to acquire it.
	await delay(100);

	return {context, ours, theirs, release};
}
