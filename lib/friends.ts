import { and, countDistinct, desc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { friendships, players, roomInvites, rooms, users } from "@/db/schema";

/** How many friend requests one account may have waiting for an answer. */
export const MAX_PENDING_REQUESTS = 50;
/** How many table invitations the landing page will show at once. */
const INVITE_LIMIT = 10;

export type FriendSummary = {
  friendshipId: string;
  userId: string;
  username: string;
  displayName: string;
  /** Finished games on this friend's account. */
  games: number;
  /** Finished games the two of you were both at. */
  together: number;
};

export type FriendRequest = {
  friendshipId: string;
  userId: string;
  username: string;
  displayName: string;
  createdAt: string;
};

export type RoomInviteSummary = {
  id: string;
  code: string;
  from: string;
  players: number;
  createdAt: string;
};

export type FriendsPayload = {
  friends: FriendSummary[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  invites: RoomInviteSummary[];
};

/**
 * The unique key for a pair of accounts, independent of who asked first.
 *
 * Sorting the two ids is what makes A→B and B→A collide on one row, so a
 * request sent in both directions cannot become two disagreeing friendships.
 */
export function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Finished games per account, for the accounts asked about. */
async function countFinishedGames(userIds: string[]) {
  if (!userIds.length) return new Map<string, number>();
  const rows = await getDb()
    .select({ userId: players.userId, games: countDistinct(players.roomId) })
    .from(players)
    .innerJoin(rooms, eq(rooms.id, players.roomId))
    .where(and(inArray(players.userId, userIds), eq(rooms.status, "finished")))
    .groupBy(players.userId);
  return new Map(rows.map((row) => [row.userId ?? "", row.games]));
}

/** Finished games each of those accounts played at the same table as `userId`. */
async function countSharedGames(userId: string, userIds: string[]) {
  if (!userIds.length) return new Map<string, number>();
  const mine = alias(players, "mine");
  const rows = await getDb()
    .select({ userId: players.userId, together: countDistinct(players.roomId) })
    .from(players)
    .innerJoin(mine, eq(mine.roomId, players.roomId))
    .innerJoin(rooms, eq(rooms.id, players.roomId))
    .where(
      and(
        eq(mine.userId, userId),
        inArray(players.userId, userIds),
        eq(rooms.status, "finished"),
      ),
    )
    .groupBy(players.userId);
  return new Map(rows.map((row) => [row.userId ?? "", row.together]));
}

/**
 * Table invitations still worth acting on.
 *
 * Only rooms that are still `waiting` can be joined, so an invitation to a room
 * that has since started — or finished — is simply not returned. The rows are
 * dropped later by the scheduled cleanup rather than at read time, so a read
 * stays a read.
 */
async function loadInvites(userId: string): Promise<RoomInviteSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: roomInvites.id,
      code: rooms.code,
      roomId: rooms.id,
      from: users.displayName,
      createdAt: roomInvites.createdAt,
    })
    .from(roomInvites)
    .innerJoin(rooms, eq(rooms.id, roomInvites.roomId))
    .innerJoin(users, eq(users.id, roomInvites.fromUserId))
    .where(and(eq(roomInvites.toUserId, userId), eq(rooms.status, "waiting")))
    .orderBy(desc(roomInvites.createdAt))
    .limit(INVITE_LIMIT);
  if (!rows.length) return [];

  const seated = await db
    .select({ roomId: players.roomId, count: countDistinct(players.id) })
    .from(players)
    .where(
      inArray(
        players.roomId,
        rows.map((row) => row.roomId),
      ),
    )
    .groupBy(players.roomId);
  const counts = new Map(seated.map((row) => [row.roomId, row.count]));

  return rows.map(({ roomId, ...invite }) => ({
    ...invite,
    players: counts.get(roomId) ?? 0,
  }));
}

/** Everything the friends panel and the invitation banner need, in one read. */
export async function loadFriendsPayload(userId: string): Promise<FriendsPayload> {
  const db = getDb();
  const [links, invites] = await Promise.all([
    db
      .select()
      .from(friendships)
      .where(
        or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)),
      )
      .orderBy(desc(friendships.createdAt)),
    loadInvites(userId),
  ]);
  if (!links.length) {
    return { friends: [], incoming: [], outgoing: [], invites };
  }

  const otherId = (link: typeof links[number]) =>
    link.requesterId === userId ? link.addresseeId : link.requesterId;
  const accepted = links.filter((link) => link.status === "accepted");
  const [people, games, together] = await Promise.all([
    db
      .select({ id: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, links.map(otherId))),
    countFinishedGames(accepted.map(otherId)),
    countSharedGames(userId, accepted.map(otherId)),
  ]);
  const byId = new Map(people.map((person) => [person.id, person]));

  const friends: FriendSummary[] = [];
  const incoming: FriendRequest[] = [];
  const outgoing: FriendRequest[] = [];
  for (const link of links) {
    const person = byId.get(otherId(link));
    if (!person) continue;
    const base = {
      friendshipId: link.id,
      userId: person.id,
      username: person.username,
      displayName: person.displayName,
    };
    if (link.status === "accepted") {
      friends.push({
        ...base,
        games: games.get(person.id) ?? 0,
        together: together.get(person.id) ?? 0,
      });
    } else if (link.addresseeId === userId) {
      incoming.push({ ...base, createdAt: link.createdAt });
    } else {
      outgoing.push({ ...base, createdAt: link.createdAt });
    }
  }
  friends.sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-Hant"));

  return { friends, incoming, outgoing, invites };
}

/** The accepted friendship between two accounts, if there is one. */
export async function findAcceptedFriendship(userId: string, otherId: string) {
  const [link] = await getDb()
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.pairKey, pairKey(userId, otherId)),
        eq(friendships.status, "accepted"),
      ),
    )
    .limit(1);
  return link ?? null;
}
