// Tables that belong to the main pacord.db (app-level config, never reset).
export const MAIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS connect_profiles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  transport      TEXT NOT NULL,
  host           TEXT NOT NULL,
  port           INTEGER NOT NULL,
  engine         TEXT NOT NULL,
  ax_level       TEXT NOT NULL DEFAULT 'L2',
  radio_port     INTEGER,
  remote         TEXT NOT NULL,
  my_call        TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  auth_user      TEXT,
  auth_pass      TEXT,
  connect_script TEXT NOT NULL DEFAULT '[]',
  response_timeout_ms INTEGER NOT NULL DEFAULT 30000,
  admin_port     INTEGER DEFAULT 8086,
  is_default     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Tables that belong to a per-profile database (user data, isolated per server).
export const PROFILE_SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  msg_id       TEXT PRIMARY KEY,
  from_call    TEXT NOT NULL,
  to_call      TEXT NOT NULL,
  body         TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  reply_id     TEXT,
  edit_ts      INTEGER,
  delivered_ts INTEGER,
  received_ts  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_peer ON messages (from_call, to_call);
CREATE INDEX IF NOT EXISTS idx_messages_peer2 ON messages (to_call, from_call);

CREATE TABLE IF NOT EXISTS message_reactions (
  msg_id   TEXT NOT NULL,
  emoji    TEXT NOT NULL,
  callsign TEXT NOT NULL,
  ts       INTEGER NOT NULL,
  PRIMARY KEY (msg_id, emoji, callsign)
);

CREATE TABLE IF NOT EXISTS posts (
  cid          INTEGER NOT NULL,
  ts           INTEGER NOT NULL,
  from_call    TEXT NOT NULL,
  body         TEXT NOT NULL,
  reply_ts     INTEGER,
  reply_from   TEXT,
  at_calls     TEXT,
  edit_ts      INTEGER,
  delivered_ts INTEGER,
  received_ts  INTEGER,
  PRIMARY KEY (cid, ts)
);
CREATE INDEX IF NOT EXISTS idx_posts_cid ON posts (cid, ts);

CREATE TABLE IF NOT EXISTS post_reactions (
  cid      INTEGER NOT NULL,
  ts       INTEGER NOT NULL,
  emoji    TEXT NOT NULL,
  callsign TEXT NOT NULL,
  ets      INTEGER NOT NULL,
  PRIMARY KEY (cid, ts, emoji, callsign)
);

CREATE TABLE IF NOT EXISTS channels (
  cid         INTEGER PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  subscribed  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hams (
  callsign TEXT PRIMARY KEY,
  name     TEXT NOT NULL DEFAULT '',
  ts       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS avatars (
  callsign    TEXT PRIMARY KEY,
  data_base64 TEXT NOT NULL,
  mime        TEXT NOT NULL,
  ts          INTEGER NOT NULL
);
`;

export const DEFAULT_CHANNELS: Array<{ cid: number; name: string; description: string }> = [
  { cid: 0, name: "packet-network", description: "All things packet network related - links, routing, NETROM, QUALITY, INP3 etc." },
  { cid: 1, name: "packet-general", description: "Anything Packet Radio goes here!" },
  { cid: 2, name: "ham-radio-general", description: "Anything Ham Radio" },
  { cid: 3, name: "ask-devs", description: "Found a bug or got a feature request? Ask here!" },
  { cid: 4, name: "bath-and-district-arc", description: "Bath and District ARC Club Chat" },
  { cid: 5, name: "lounge", description: "Anything and everything in here!" },
  { cid: 6, name: "test-channel-ignore", description: "Used for anything that needs testing - generally best ignored!" },
  { cid: 7, name: "new-packet-radio", description: "Everything related to New Packet Radio" },
  { cid: 9, name: "bracknell-arc", description: "Bracknell Amateur Radio Club Chat" },
  { cid: 10, name: "small-victories", description: "Achieved something good? Whether radio related or not, share it here!" },
  { cid: 11, name: "wps-development", description: "Channel for everything related to the development of the WPS, the backend service powering WhatsPac." },
  { cid: 12, name: "network-monitoring", description: "Channel for everything related to the new packet network monitoring capability" },
  { cid: 100, name: "announcements", description: "General news and announcements relevant to the community" },
];
