import { resetUserPassword } from "./adminApi.js";
import * as dotenv from "dotenv";
dotenv.config({ override: true });

const userId = "@admin:matrix.wetec-server.com";   // change if your admin is different
const newPass = "TempAdminPassword123!";

try {
  await resetUserPassword(
    userId,
    newPass,
    process.env.ADMIN_TOKEN,
    process.env.PRIVATE_HOMESERVER || "http://localhost:8008"
  );
  console.log("✅ Password reset via Admin API succeeded!");
} catch (err) {
  console.error("❌ Failed:", err.message);
}