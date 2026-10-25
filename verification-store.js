'use strict';
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const directory = process.env.VERIFICATION_DATA_DIR || '/app/data';
const file = path.join(directory, 'pending-verifications.json');
const TTL = 30 * 60 * 1000;
let queue = Promise.resolve();
function lock(fn) { const task = queue.then(fn); queue = task.catch(() => {}); return task; }
function key() {
  const secret = process.env.VERIFICATION_ENCRYPTION_KEY;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error('VERIFICATION_ENCRYPTION_KEY must be 64 hexadecimal characters');
  return Buffer.from(secret, 'hex');
}
function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), data:encrypted.toString('base64') };
}
function unseal(blob) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(blob.iv,'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(blob.data,'base64')), decipher.final()]).toString('utf8'));
}
async function read() {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
async function write(data) {
  await fs.mkdir(directory, {recursive:true, mode:0o700});
  const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data), {mode:0o600});
  await fs.rename(tmp, file);
}
const PROCESSING_TIMEOUT = 2 * 60 * 1000;
function prune(records) {
  const now = Date.now();
  for (const [id, rec] of Object.entries(records)) {
    if (rec.state === 'processing' && now - (rec.processingSince || 0) > PROCESSING_TIMEOUT) rec.state = 'pending'; // safe: no external request started
    if (rec.state === 'dispatching' && now - (rec.processingSince || 0) > PROCESSING_TIMEOUT) { rec.state = 'needs_review'; console.error('Verification dispatch interrupted; manual review required:', id); }
    if (rec.expires <= now && rec.state !== 'needs_review' && rec.state !== 'dispatching') delete records[id];
  }
}
async function save(token, payload) {
  return lock(async () => {
    const records = await read(); prune(records);
    if (Object.keys(records).length >= 1000) throw new Error('Pending verification capacity reached');
    records[hash(token)] = {expires:Date.now()+TTL, state:'pending', payload:seal(payload)};
    await write(records);
  });
}
async function claim(token) {
  return lock(async () => {
    const records = await read(); prune(records);
    const id = hash(token), record = records[id];
    if (!record || record.state !== 'pending') { await write(records); return null; }
    const payload = unseal(record.payload);
    record.state = 'processing'; record.processingSince = Date.now();
    await write(records);
    return payload;
  });
}
async function markDispatching(token) {
  return lock(async () => {
    const records=await read(); const rec=records[hash(token)];
    if (!rec || rec.state !== 'processing') throw new Error('Verification not claimed');
    rec.state='dispatching'; rec.processingSince=Date.now(); await write(records);
  });
}
async function finish(token, succeeded) {
  return lock(async () => {
    const records = await read();
    const record = records[hash(token)];
    if (record && record.state === 'dispatching') {
      if (succeeded) { record.state = 'completed'; record.payload = null; record.expires = Date.now() + TTL; }
      else { record.state = 'needs_review'; console.error('Verification delivery outcome uncertain; review before retry:', hash(token)); }
      await write(records);
    }
  });
}
async function discard(token) { return lock(async () => { const records = await read(); delete records[hash(token)]; await write(records); }); }
module.exports = {save, claim, markDispatching, finish, discard};
