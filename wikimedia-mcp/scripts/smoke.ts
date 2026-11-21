/**
 * Real smoke test (report 09 §2.3 step 4 / task verification):
 * start the server over stdio, call server/discover + tools/list, then
 * get_summary for "Earth" against the live Wikimedia REST API.
 */
import { RawStdioClient } from '../tests/helpers/raw-stdio.js';

const client = new RawStdioClient();

const discover = (await client.request('server/discover', {}, 1)).body;
console.log('--- server/discover ---');
console.log(JSON.stringify(discover, null, 2));

const tools = (await client.request('tools/list', {}, 2)).body;
const listed = (tools['result'] as Record<string, unknown>)?.['tools'] as Array<Record<string, unknown>> | undefined;
console.log('--- tools/list names ---');
console.log(JSON.stringify(listed?.map((tool) => tool['name'])));

const summary = (await client.request('tools/call', {
  name: 'get_summary',
  arguments: { title: 'Earth' },
}, 3)).body;
console.log('--- tools/call get_summary Earth ---');
console.log(JSON.stringify(summary, null, 2));

client.close();
process.exit(0);
