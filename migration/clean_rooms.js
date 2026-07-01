import sdk from "matrix-js-sdk";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const PRIVATE_HOMESERVER = process.env.PRIVATE_HOMESERVER || "http://localhost:8008";
const ADMIN_USER_ID = "@admin:matrix.wetec-server.com";
const TEMP_ADMIN_PASSWORD = "TempAdminPassword123!";

function resetAdminPassword() {
  try {
    console.log(`Resetting database password for admin: ${ADMIN_USER_ID}...`);
    // 1. Generate bcrypt hash using synapse container python
    const hashCmd = `docker exec matrix-synapse python3 -c "import bcrypt; print(bcrypt.hashpw(b'${TEMP_ADMIN_PASSWORD}', bcrypt.gensalt()).decode('utf-8'))"`;
    const hash = execSync(hashCmd).toString().trim();
    
    // 2. Update in postgres
    const sql = `UPDATE users SET password_hash = '${hash}' WHERE name = '${ADMIN_USER_ID}'`;
    const updateCmd = `docker exec matrix-postgres psql -U synapse -d synapse -c "${sql}"`;
    execSync(updateCmd);
    
    console.log("Admin password successfully reset in Postgres database.");
    return true;
  } catch (err) {
    console.error("Failed to reset admin password in database:", err.message);
    return false;
  }
}

async function clean() {
  if (!resetAdminPassword()) {
    process.exit(1);
  }

  console.log("Logging in as admin to get access token...");
  const tempClient = sdk.createClient({ baseUrl: PRIVATE_HOMESERVER });
  
  let loginRes;
  try {
    loginRes = await tempClient.login("m.login.password", {
      user: ADMIN_USER_ID,
      identifier: {
        type: "m.login.id.user",
        user: ADMIN_USER_ID,
      },
      password: TEMP_ADMIN_PASSWORD,
    });
    console.log("Logged in successfully as admin.");
  } catch (err) {
    console.error("Admin login failed:", err.message);
    process.exit(1);
  }

  const adminToken = loginRes.access_token;

  console.log("Fetching all rooms on the homeserver...");
  const listRes = await fetch(`${PRIVATE_HOMESERVER}/_synapse/admin/v1/rooms`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!listRes.ok) {
    const errorText = await listRes.text();
    console.error("Failed to fetch rooms list:", errorText);
    process.exit(1);
  }

  const listData = await listRes.json();
  const rooms = listData.rooms || [];
  console.log(`Found ${rooms.length} total rooms on the server.`);

  if (rooms.length === 0) {
    console.log("No rooms to delete.");
    process.exit(0);
  }

  console.log("Purging rooms from Synapse...");
  for (const room of rooms) {
    console.log(`Purging room: "${room.name}" (${room.room_id})...`);
    
    const deleteRes = await fetch(`${PRIVATE_HOMESERVER}/_synapse/admin/v1/rooms/${encodeURIComponent(room.room_id)}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        purge: true
      })
    });

    const deleteBody = await deleteRes.json();
    if (deleteRes.ok) {
      console.log(`Successfully purged room: ${room.room_id}`);
    } else {
      console.warn(`Failed to purge room ${room.room_id}:`, deleteBody.error || JSON.stringify(deleteBody));
    }
    
    // Add small delay between deletes to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\nRoom cleanup complete!");
  process.exit(0);
}

clean().catch(err => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
