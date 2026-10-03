import { readConfig } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { processNotifications } from '../server/src/notifications.js';
const config = readConfig();
if (!config.databaseUrl) throw new Error('Configure DATABASE_URL.');
const sql = postgres(config.databaseUrl, config.databaseCa);
try {
  console.log(await processNotifications(sql, config));
} finally {
  await sql.close();
}
