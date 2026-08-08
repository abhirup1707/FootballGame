const { workerData, parentPort } = require("worker_threads");
const { Pool } = require("pg");

// One long-lived Postgres pool shared by every query from the main thread.
// The main thread blocks on a shared Int32Array (Atomics.wait) while this
// worker executes the query on its own event loop, so the server never
// spawns a new process per statement and never freezes its own event loop.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 10,
});

const sab = workerData.sab;
const status = new Int32Array(sab);
const header = new Int32Array(sab, 0, 4);
const bytes = new Uint8Array(sab);
const DATA_OFFSET = 16;

const IDLE = 0;
const BUSY = 1;
const DONE = 2;
const ERROR = 3;

function encode(value, into, offset) {
  return Buffer.from(value, "utf8").copy(into, offset);
}

async function loop() {
  while (true) {
    Atomics.wait(status, 0, IDLE);
    const qlen = header[2];
    const queryJson = Buffer.from(bytes).subarray(DATA_OFFSET, DATA_OFFSET + qlen).toString("utf8");
    let payload;
    let code = DONE;
    try {
      const { sql, params } = JSON.parse(queryJson);
      const result = await pool.query(sql, params);
      payload = JSON.stringify({ rows: result.rows || [], rowCount: result.rowCount || 0 });
    } catch (error) {
      code = ERROR;
      payload = JSON.stringify({ error: error.message });
    }
    const plen = encode(payload, bytes, DATA_OFFSET + qlen);
    header[3] = plen;
    Atomics.store(status, 0, code);
    Atomics.notify(status, 0);
    // Park until the main thread acknowledges by resetting to IDLE. This
    // prevents the loop from re-reading the same request before the main
    // thread has consumed the result.
    while (Atomics.load(status, 0) !== IDLE) {
      Atomics.wait(status, 0, Atomics.load(status, 0));
    }
  }
}

loop().catch((error) => {
  process.stdout.write(JSON.stringify({ error: error.message }));
  process.exit(1);
});
