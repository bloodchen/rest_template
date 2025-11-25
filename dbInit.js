export async function createTables(db) {
    try {
        //users
        if (!await db.tableExists('users')) {
            await db.query(`
        CREATE TABLE IF NOT EXISTS users (
        uid SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        pass TEXT NOT NULL,
        frm INTEGER DEFAULT 0,
        info JSONB DEFAULT '{}',
        sysinfo JSONB DEFAULT '{}',
        level INTEGER DEFAULT 0,
        level_exp INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status INTEGER DEFAULT 1
        );
        ALTER SEQUENCE users_uid_seq RESTART WITH 1000;

        -- 创建索引（加上 IF NOT EXISTS）
        DO $$
        BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_users_uid') THEN
            CREATE INDEX idx_users_uid ON users(uid);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_users_email') THEN
            CREATE INDEX idx_users_email ON users(email);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_users_status') THEN
            CREATE INDEX idx_users_status ON users(status);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_users_from') THEN
            CREATE INDEX idx_users_from ON users(frm);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_users_created_at') THEN
            CREATE INDEX idx_users_created_at ON users(created_at);
        END IF;
        END
        $$;

        -- 创建更新时间触发器函数（安全）
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
        END;
        $$ language 'plpgsql';

        -- 创建触发器（避免重复创建）
        DO $$
        BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at'
        ) THEN
            CREATE TRIGGER update_users_updated_at
            BEFORE UPDATE ON users
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        END IF;
        END
        $$;
      `)
        }



        // payments 表
        if (!await db.tableExists('payments')) {
            await db.query(`
            CREATE TABLE IF NOT EXISTS payments (
            id BIGSERIAL PRIMARY KEY,
            uid BIGINT REFERENCES users(uid),
            email TEXT,
            order_id TEXT UNIQUE,
            amount BIGINT NOT NULL,
            type INT DEFAULT 0,
            meta JSONB DEFAULT '{}',
            sysinfo JSONB DEFAULT '{}',

            -- 生成列，直接从 meta 提取
            pid TEXT GENERATED ALWAYS AS (meta->>'pid') STORED,
            did TEXT GENERATED ALWAYS AS (meta->>'did') STORED,

            created_at TIMESTAMPTZ DEFAULT now()
        );

        -- 单列索引
        CREATE INDEX IF NOT EXISTS idx_payments_pid ON payments (pid);
        CREATE INDEX IF NOT EXISTS idx_payments_did ON payments (did);

        -- 联合索引（常用组合查询）
            CREATE INDEX IF NOT EXISTS idx_payments_pid_did ON payments (pid, did);
        SELECT setval('payments_id_seq', COALESCE((SELECT MAX(id) FROM payments), 1000), true);
        `);
        }


        // orders
        if (!await db.tableExists('orders')) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY,
                    uid BIGINT NOT NULL,
                    product TEXT,
                    meta JSONB,
                    ctime BIGINT
                );
                CREATE INDEX idx_orders_uid ON orders(uid);
                CREATE INDEX idx_orders_product ON orders(product);
                CREATE INDEX idx_orders_ctime ON orders(ctime);
            `);
        }

        // kv (UNLOGGED)
        if (!await db.tableExists('kv')) {
            await db.query(`
                CREATE UNLOGGED TABLE IF NOT EXISTS kv (
                    key TEXT PRIMARY KEY,
                    value JSONB,
                    expire BIGINT
                );
                CREATE INDEX IF NOT EXISTS idx_kv_expire ON kv(expire);
            `);
        }
        console.log('✅ Tables created.');

        // ---- 添加索引 ----


        console.log('✅ Indexes created.');

        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
}