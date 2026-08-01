export async function cleanupExpiredSessions(d1: D1Database) {
  const sessions = await d1
    .prepare("DELETE FROM account_sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();

  return {
    expiredSessions: sessions.meta.changes,
  };
}
