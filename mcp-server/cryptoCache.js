import sqlite3 from "sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "decrypted_cache.db");

let db = null;

export function initDatabase() {
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        return reject(err);
      }
      
      db.run(`
        CREATE TABLE IF NOT EXISTS decrypted_messages (
          event_id TEXT PRIMARY KEY,
          room_id TEXT,
          sender TEXT,
          body TEXT,
          msgtype TEXT,
          timestamp INTEGER,
          decrypted_at INTEGER
        )
      `, (err) => {
        if (err) {
          return reject(err);
        }
        resolve(db);
      });
    });
  });
}

export function saveMessageToCache(event, customRoomId = null) {
  return new Promise(async (resolve, reject) => {
    try {
      await initDatabase();

      const eventId = event.getId();
      const roomId = customRoomId || event.getRoomId();
      const sender = event.getSender();
      const content = event.getContent();
      const body = content ? content.body : null;
      const msgtype = content ? content.msgtype : null;
      const timestamp = event.getTs();
      const decryptedAt = Date.now();

      if (!eventId || !body) {
        return resolve();
      }

      db.run(`
        INSERT OR IGNORE INTO decrypted_messages (
          event_id, room_id, sender, body, msgtype, timestamp, decrypted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [eventId, roomId, sender, body, msgtype, timestamp, decryptedAt], (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function getCachedMessage(eventId) {
  return new Promise(async (resolve, reject) => {
    try {
      await initDatabase();

      db.get(`
        SELECT body, msgtype FROM decrypted_messages WHERE event_id = ?
      `, [eventId], (err, row) => {
        if (err) {
          return reject(err);
        }
        resolve(row || null);
      });
    } catch (err) {
      reject(err);
    }
  });
}
