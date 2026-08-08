const { workerData } = require("worker_threads");
const { Pool } = require("pg");

const header = new Int32Array(workerData.buffer, 0, 2);
const payload = new Uint8Array(workerData.buffer, 8);

function finish(result) {
  const bytes = Buffer.from(JSON.stringify(result));
  if (bytes.length > payload.length) return finish({ error: "Database result is too large." });
  payload.set(bytes);
  Atomics.store(header, 1, bytes.length);
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0, 1);
}

(async () => {
  const pool = new Pool({ connectionString: workerData.databaseUrl, ssl: { rejectUnauthorized: false } });
  let response;
  try {
    const result = await pool.query(workerData.sql, workerData.params);
    response = { rows: result.rows || [], rowCount: result.rowCount || 0 };
  } catch (error) {
    response = { error: error.message };
  } finally {
    await pool.end();
  }
  finish(response);
})();
