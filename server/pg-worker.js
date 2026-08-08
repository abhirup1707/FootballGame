const { workerData } = require("worker_threads");
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
const ints = new Int32Array(sab, 0, 4); // [0]=reqReady, [1]=respReady, [2]=queryLen, [3]=resultLen
const bytes = new Uint8Array(sab);
const DATA_OFFSET = 16;

async function loop() {
  while (true) {
    // Wait for a request from the main thread.
    while (Atomics.load(ints, 0) === 0) Atomics.wait(ints, 0, 0);

    const qlen = Atomics.load(ints, 2);
    const queryJson = Buffer.from(bytes).subarray(DATA_OFFSET, DATA_OFFSET + qlen).toString("utf8");

    // ACK the request before running it, so the main thread never writes a
    // new query over bytes we are still reading.
    Atomics.store(ints, 0, 0);
    Atomics.notify(ints, 0);

    let payload;
    let code = 1; // 1 = ok, 2 = error
    try {
      const { sql, params } = JSON.parse(queryJson);
      const result = await pool.query(sql, params);
      payload = JSON.stringify({ rows: result.rows || [], rowCount: result.rowCount || 0 });
    } catch (error) {
      code = 2;
      payload = JSON.stringify({ error: error.message });
    }

    const payloadBuf = Buffer.from(payload, "utf8");
    payloadBuf.copy(bytes, DATA_OFFSET + qlen);
    Atomics.store(ints, 3, payloadBuf.length);

    // Signal the response is ready, then wait for the main thread to consume it.
    Atomics.store(ints, 1, 1);
    Atomics.notify(ints, 1);
    while (Atomics.load(ints, 1) === 1) Atomics.wait(ints, 1, 1);
  }
}

loop().catch((error) => {
  process.stdout.write(JSON.stringify({ error: error.message }));
  process.exit(1);
});
