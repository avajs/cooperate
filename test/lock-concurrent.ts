import test from 'ava';
import {SharedContext} from '../source/index.js';
import synchronize from './_synchronize.js';

test('attempt to acquire locks concurrently in different processes', async t => {
	const {theirs} = await synchronize({
		context: new SharedContext(t.title),
		ours: 'acquire',
		theirs: 'release',
	});

	await t.notThrowsAsync(theirs.acquire());
});
