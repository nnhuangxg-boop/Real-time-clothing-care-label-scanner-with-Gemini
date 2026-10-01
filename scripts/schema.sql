CREATE TABLE IF NOT EXISTS browsers(id TEXT PRIMARY KEY,first_seen BIGINT NOT NULL,last_seen BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS calls(id BIGSERIAL PRIMARY KEY,browser TEXT NOT NULL,ip TEXT NOT NULL,source TEXT NOT NULL,model TEXT NOT NULL,language TEXT NOT NULL,started BIGINT NOT NULL,day TEXT NOT NULL,outcome TEXT NOT NULL DEFAULT 'pending',duration_ms INTEGER,http_status INTEGER,input_tokens INTEGER,output_tokens INTEGER,thinking_tokens INTEGER,total_tokens INTEGER,dry TEXT,wash TEXT,label_visible INTEGER);
CREATE INDEX IF NOT EXISTS calls_browser ON calls(browser,source);
CREATE INDEX IF NOT EXISTS calls_day ON calls(day,source,ip);
CREATE TABLE IF NOT EXISTS blocked(id BIGSERIAL PRIMARY KEY,browser TEXT NOT NULL,ip TEXT NOT NULL,day TEXT NOT NULL,reason TEXT NOT NULL,created BIGINT NOT NULL);
