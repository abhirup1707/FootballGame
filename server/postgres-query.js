const { Pool } = require("pg");

const input = JSON.parse(process.argv[2]);

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    const result = await pool.query(input.sql, input.params);
    process.stdout.write(JSON.stringify({ rows: result.rows || [], rowCount: result.rowCount || 0 }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
