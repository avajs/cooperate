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
	theirs: theirId,
}: {
	context: SharedContext;
	ours: string;
	theirs: string;
}): Promise<Synchronized> {
	const ours = context.createLock(ourId);
	const theirs = context.createLock(theirId);

	let release;
	while (true) { // eslint-disable-line no-constant-condition
		try {
			release = await ours.acquireNow(); // eslint-disable-line no-await-in-loop
			break;
		} catch {
			// We must acquire our lock. Try again.
			await delay(Math.random() * 10); // eslint-disable-line no-await-in-loop
		}
	}

	// We have our lock. Wait for them to get theirs.
	while (true) { // eslint-disable-line no-constant-condition
		try {
			const releaseTheirs = await theirs.acquireNow(); // eslint-disable-line no-await-in-loop
			// Release their lock if we managed to acquire it.
			releaseTheirs();
			// They must acquire their lock. Try again.
			await delay(Math.random() * 10); // eslint-disable-line no-await-in-loop
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
